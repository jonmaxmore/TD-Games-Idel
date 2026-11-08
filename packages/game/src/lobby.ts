// Friend rooms and their matches (SPEC-pvp-rooms), independent of the transport: a Conn is anything that can send text
// and close. The server runs packages/sim authoritatively at TICK_HZ; clients run the same sim from the frames it sends.
// Everything lives in memory for now (one process); M1 moves guests to PostgreSQL and the room registry to Redis.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { battleHash, battleOver, createBattle, decision, stepBattle, type BattleRecord, type BattleState, type Side } from '@five-sects/sim';
import {
  AHEAD_TICKS, CODE_ALPHABET, CODE_LEN, HASH_EVERY, INPUT_DELAY, LATE_TICKS, PROTOCOL_VERSION, PVP_OPTS, ProtocolError, TICK_MS, cleanName, framesToCommands,
  normalizeCode, parseClient, pvpSetup, teamError, type ClientMsg, type ErrorCode, type MatchEnd, type NetCommand, type RejectCode, type Seat, type ServerMsg, type TeamPick,
} from '@five-sects/protocol';

export interface Conn { ip: string; send(text: string): void; close(code: number, reason: string): void }
// A finished match as stored: a BattleRecord replayBattle() re-runs (a forfeit or a flagged desync stops early), plus who played.
export interface MatchRecord extends BattleRecord { id: string; code: string; names: [string, string]; end: MatchEnd; playedAt: string }
export interface MatchStore { save(r: MatchRecord): void; flush?(): Promise<void> }

export interface LobbyOpts {
  tickMs: number; // 50 in play; tests run faster
  startDelayMs: number; // the versus screen before tick 0
  graceMs: number; // a dropped player may reconnect for this long, then forfeits
  roomTtlMs: number; // a room that never starts closes after this
  maxRooms: number; maxPlayers: number;
  helloMs: number; // a socket that has not said hello by then is closed
  idleMs: number; // a guest in no room that sends nothing for this long is sent away
  joinFailsPerMin: number; // wrong room codes the whole server answers per minute (guessing from many addresses)
  store: MatchStore;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}
export const defaultOpts = (store: MatchStore): LobbyOpts => ({
  tickMs: 50, startDelayMs: 2000, graceMs: 20_000, roomTtlMs: 10 * 60_000, maxRooms: 1000, maxPlayers: 5000,
  helloMs: 5000, idleMs: 10 * 60_000, joinFailsPerMin: 600, store,
});

// Match timing and rate limits run on the monotonic clock: a wall-clock step must not stall or rush a match.
const now = () => performance.now();
// A socket that sends this many wrong room codes in a row is closed.
export const MAX_CODE_MISSES = 5;

// A token bucket per key: at most `burst` at once, refilled at `perSec`.
export class Limiter {
  private b = new Map<string, { n: number; at: number }>();
  constructor(private burst: number, private perSec: number, private clock: () => number = now) {}
  private fill(key: string) {
    const t = this.clock(), x = this.b.get(key) ?? { n: this.burst, at: t };
    x.n = Math.min(this.burst, x.n + ((t - x.at) / 1000) * this.perSec);
    x.at = t;
    this.b.set(key, x);
    return x;
  }
  has(key: string): boolean { return this.fill(key).n >= 1; }
  take(key: string): boolean {
    const x = this.fill(key);
    if (x.n < 1) return false;
    x.n -= 1;
    return true;
  }
  sweep(): void { const t = this.clock(); for (const [k, x] of this.b) if (t - x.at > (this.burst / this.perSec) * 1000) this.b.delete(k); }
}

interface Player { id: string; tokenHash: string; name: string; conn: Conn | null; room: Room | null; seat: Side; leftAt: number; lastAt: number; misses: number }
interface Match {
  s: BattleState; seed: number; teams: [TeamPick, TeamPick]; startAt: number; timer: NodeJS.Timeout | null;
  queue: Map<number, { seat: Side; c: NetCommand }[]>; frames: Record<string, NetCommand[]>;
  framesJson: string | null; // the history as a reconnect sends it, until the next frame with commands
  hashes: Map<number, string>; told: [Map<number, string>, Map<number, string>]; flagged: boolean;
  grace: [NodeJS.Timeout | null, NodeJS.Timeout | null]; perTick: [number, number]; perTickAt: number;
  timing: { steps: number; lateMs: number[] }; // how far behind its schedule each tick ran
  slack: number[]; // per accepted command: ticks between arrival and its stamp (negative: arrived late)
}
interface Room { code: string; seats: [Player | null, Player | null]; teams: [TeamPick | null, TeamPick | null]; ready: [boolean, boolean]; match: Match | null; expires: NodeJS.Timeout; createdAt: number; kicked: Set<string> }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const other = (s: Side): Side => (s === 0 ? 1 : 0);
const defaultName = () => `ผู้กล้า${randomInt(1000, 10000)}`;

export class Lobby {
  readonly rooms = new Map<string, Room>();
  private players = new Map<string, Player>(); // by token hash
  private createLimit = new Limiter(5, 5 / 60);
  private joinLimit = new Limiter(10, 10 / 60);
  private readonly cmdLimit: Limiter;
  private guestLimit = new Limiter(10, 10 / 60); // new guest identities per IP
  private reconnectLimit = new Limiter(3, 1); // hellos with a known token, per guest
  private joinFails: Limiter;
  private sweeper: NodeJS.Timeout;
  readonly stats = { matches: 0, desyncs: 0, rejects: {} as Record<string, number>, lateMs: [] as number[], slack: [] as number[] };

  // Message and command rates are per second of match time: a client's traffic is paced by ticks, and tests run faster.
  private readonly speed: number;

  constructor(readonly o: LobbyOpts) {
    this.speed = TICK_MS / o.tickMs;
    this.cmdLimit = new Limiter(10, 6 * this.speed);
    this.joinFails = new Limiter(o.joinFailsPerMin, o.joinFailsPerMin / 60);
    this.sweeper = setInterval(() => this.sweep(), Math.min(60_000, o.idleMs));
    this.sweeper.unref();
  }

  // One connection's handler: parse, then dispatch; a message outside the protocol closes the connection.
  connect(conn: Conn): { message(raw: unknown): void; close(): void } {
    let me: Player | null = null;
    const msgLimit = new Limiter(40, 30 * this.speed);
    const helloTimer = setTimeout(() => { if (!me) conn.close(1008, 'hello timeout'); }, this.o.helloMs);
    helloTimer.unref();
    return {
      message: (raw) => {
        if (!msgLimit.take('m')) { this.send(conn, { t: 'error', code: 'rate_limited' }); conn.close(1008, 'rate'); return; }
        let m: ClientMsg;
        try { m = parseClient(raw); } catch (e) {
          if (!(e instanceof ProtocolError)) throw e;
          this.send(conn, { t: 'error', code: 'bad_message' });
          conn.close(1008, 'bad message');
          return;
        }
        if (m.t === 'hello') { if (!me) { me = this.hello(conn, m); if (me) clearTimeout(helloTimer); } return; }
        if (!me) { this.send(conn, { t: 'error', code: 'need_hello' }); conn.close(1008, 'hello first'); return; }
        if (me.conn !== conn) return; // replaced by a newer connection
        me.lastAt = now();
        this.handle(me, m);
      },
      close: () => { clearTimeout(helloTimer); if (me && me.conn === conn) this.dropped(me); },
    };
  }

  close(): void {
    clearInterval(this.sweeper);
    for (const r of this.rooms.values()) this.closeRoom(r, null);
  }

  private send(conn: Conn | null, m: ServerMsg): void { if (conn) conn.send(JSON.stringify(m)); }
  private toRoom(r: Room, m: ServerMsg | ((seat: Side) => ServerMsg)): void {
    r.seats.forEach((p, i) => { if (p) this.send(p.conn, typeof m === 'function' ? m(i as Side) : m); });
  }
  private log(msg: string, data?: Record<string, unknown>) { this.o.log?.(msg, data); }

  private hello(conn: Conn, m: Extract<ClientMsg, { t: 'hello' }>): Player | null {
    if (m.v !== PROTOCOL_VERSION) { this.send(conn, { t: 'error', code: 'version' }); conn.close(1008, 'version'); return null; }
    let token = m.token, p = token ? this.players.get(sha(token)) : undefined;
    if (p && !this.reconnectLimit.take(p.id)) { this.send(conn, { t: 'error', code: 'rate_limited' }); conn.close(1008, 'rate'); return null; }
    if (!p) {
      if (!this.guestLimit.take(conn.ip)) { this.send(conn, { t: 'error', code: 'rate_limited' }); conn.close(1008, 'rate'); return null; }
      if (this.players.size >= this.o.maxPlayers) { this.send(conn, { t: 'error', code: 'server_full' }); conn.close(1013, 'full'); return null; }
      token = randomBytes(32).toString('base64url');
      p = { id: randomBytes(8).toString('hex'), tokenHash: sha(token), name: '', conn: null, room: null, seat: 0, leftAt: 0, lastAt: 0, misses: 0 };
      this.players.set(p.tokenHash, p);
    }
    if (p.conn && p.conn !== conn) { this.send(p.conn, { t: 'error', code: 'replaced' }); p.conn.close(4000, 'replaced'); }
    p.conn = conn;
    p.lastAt = now();
    p.misses = 0;
    if (!p.room || !p.room.match) p.name = cleanName(m.name) ?? (p.name || defaultName()); // the name is fixed once a match starts
    this.send(conn, { t: 'welcome', v: PROTOCOL_VERSION, token: token!, name: p.name, delay: INPUT_DELAY, tickMs: this.o.tickMs });
    const r = p.room;
    if (r?.match) { // back into a running match: the whole history, then the live frames
      const g = r.match.grace[p.seat];
      if (g) { clearTimeout(g); r.match.grace[p.seat] = null; }
      conn.send(this.startText(r, p.seat));
      this.toRoom(r, { t: 'peer', seat: p.seat, online: true, graceSec: 0 });
      this.log('reconnect', { room: r.code, seat: p.seat });
    } else if (r) this.roomState(r);
    return p;
  }

  private handle(p: Player, m: ClientMsg): void {
    const r = p.room;
    switch (m.t) {
      case 'create': {
        if (r?.match) return this.send(p.conn, { t: 'error', code: 'in_match' });
        if (!this.createLimit.take(p.conn!.ip)) return this.send(p.conn, { t: 'error', code: 'rate_limited' });
        if (this.rooms.size >= this.o.maxRooms) return this.send(p.conn, { t: 'error', code: 'server_full' });
        if (r) this.leave(p);
        const code = this.newCode();
        const room: Room = { code, seats: [p, null], teams: [null, null], ready: [false, false], match: null, createdAt: Date.now(), kicked: new Set(), expires: setTimeout(() => this.closeRoom(room, 'room_closed'), this.o.roomTtlMs) };
        room.expires.unref();
        this.rooms.set(code, room);
        p.room = room; p.seat = 0;
        this.log('create', { room: code });
        return this.roomState(room);
      }
      case 'join': {
        if (r?.match) return this.send(p.conn, { t: 'error', code: 'in_match' });
        if (!this.joinLimit.take(p.conn!.ip)) return this.send(p.conn, { t: 'error', code: 'rate_limited' });
        if (!this.joinFails.has('all')) return this.send(p.conn, { t: 'error', code: 'rate_limited' });
        const code = normalizeCode(m.code), room = code ? this.rooms.get(code) : undefined;
        if (!room) {
          this.joinFails.take('all');
          this.send(p.conn, { t: 'error', code: 'room_not_found' });
          if (++p.misses >= MAX_CODE_MISSES) p.conn!.close(1008, 'wrong codes');
          return;
        }
        p.misses = 0;
        if (room === r) return this.roomState(room);
        if (room.kicked.has(p.id)) return this.send(p.conn, { t: 'error', code: 'kicked' });
        if (room.match || room.seats[1]) return this.send(p.conn, { t: 'error', code: 'room_full' });
        if (r) this.leave(p);
        room.seats[1] = p; p.room = room; p.seat = 1;
        return this.roomState(room);
      }
      case 'team': {
        if (!r) return this.send(p.conn, { t: 'error', code: 'not_in_room' });
        if (r.match) return this.send(p.conn, { t: 'error', code: 'in_match' });
        if (teamError(m.team)) return this.send(p.conn, { t: 'error', code: 'bad_team' });
        r.teams[p.seat] = { leader: m.team.leader, sub: m.team.sub, picks: [...m.team.picks] };
        r.ready = [false, false]; // a ready seat agreed to the friend's team as it was
        return this.roomState(r);
      }
      case 'ready': {
        if (!r) return this.send(p.conn, { t: 'error', code: 'not_in_room' });
        if (r.match) return this.send(p.conn, { t: 'error', code: 'in_match' });
        if (m.on && !r.teams[p.seat]) return this.send(p.conn, { t: 'error', code: 'no_team' });
        r.ready[p.seat] = m.on;
        if (r.ready[0] && r.ready[1] && r.seats[0]?.conn && r.seats[1]?.conn) return this.start(r);
        return this.roomState(r);
      }
      case 'kick': {
        const guest = r?.seats[1];
        if (!r || r.match || p.seat !== 0 || !guest) return;
        r.kicked.add(guest.id);
        this.send(guest.conn, { t: 'error', code: 'kicked' });
        return this.leave(guest);
      }
      case 'leave': return r?.match ? this.forfeit(r, p.seat) : r ? this.leave(p) : undefined;
      case 'cmd': return this.command(p, m.tick, m.c);
      case 'hash': return this.hash(p, m.tick, m.h);
      case 'ping': return this.send(p.conn, { t: 'pong', n: m.n, tick: r?.match?.s.tick ?? 0 });
      case 'hello': return; // only the first one counts
    }
  }

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < CODE_LEN; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  private roomState(r: Room): void {
    // Each seat sees its own picks; the friend's stay hidden until start, so the last to ready cannot counter them.
    const seat = (i: Side, to: Side): Seat | null => {
      const p = r.seats[i], t = r.teams[i];
      return p ? { name: p.name, team: t && (i === to ? t : { leader: t.leader, sub: t.sub }), ready: r.ready[i], online: p.conn != null } : null;
    };
    const left = Math.max(0, Math.ceil((r.createdAt + this.o.roomTtlMs - Date.now()) / 1000));
    this.toRoom(r, (i) => ({ t: 'room', code: r.code, seat: i, seats: [seat(0, i), seat(1, i)], expiresSec: left }));
  }

  // Out of a room before its match: the host leaving closes it, the guest leaving frees the seat.
  private leave(p: Player): void {
    const r = p.room;
    if (!r || r.match) return;
    p.room = null;
    if (p.seat === 0) return this.closeRoom(r, 'room_closed');
    r.seats[1] = null; r.teams[1] = null; r.ready = [false, false];
    this.roomState(r);
  }

  private closeRoom(r: Room, why: ErrorCode | null): void {
    clearTimeout(r.expires);
    if (r.match) { if (r.match.timer) clearTimeout(r.match.timer); for (const g of r.match.grace) if (g) clearTimeout(g); }
    for (const p of r.seats) if (p && p.room === r) { p.room = null; if (why) this.send(p.conn, { t: 'error', code: why }); }
    this.rooms.delete(r.code);
  }

  private dropped(p: Player): void {
    p.conn = null;
    p.leftAt = Date.now();
    const r = p.room;
    if (!r) return;
    if (!r.match) return this.leave(p);
    const seat = p.seat;
    r.match.grace[seat] = setTimeout(() => this.forfeit(r, seat), this.o.graceMs);
    this.toRoom(r, { t: 'peer', seat, online: false, graceSec: Math.ceil(this.o.graceMs / 1000) });
    this.log('dropped', { room: r.code, seat });
  }

  // ---- the match ----
  private start(r: Room): void {
    clearTimeout(r.expires);
    const teams = r.teams as [TeamPick, TeamPick], seed = randomInt(1, 2 ** 31 - 1);
    const s = createBattle(seed, pvpSetup(teams[0]), pvpSetup(teams[1]), PVP_OPTS);
    r.match = {
      s, seed, teams, startAt: now() + this.o.startDelayMs, timer: null, queue: new Map(), frames: {}, framesJson: null, hashes: new Map(), told: [new Map(), new Map()],
      flagged: false, grace: [null, null], perTick: [0, 0], perTickAt: -1, timing: { steps: 0, lateMs: [] }, slack: [],
    };
    this.stats.matches++;
    r.seats.forEach((p, i) => { if (p) p.conn?.send(this.startText(r, i as Side)); });
    this.log('start', { room: r.code, seed });
    this.schedule(r);
  }

  // The start message as text; the frame history inside it is serialised once per change, not once per reconnect.
  private startText(r: Room, seat: Side): string {
    const m = r.match!;
    m.framesJson ??= JSON.stringify(m.frames);
    const head: Omit<Extract<ServerMsg, { t: 'start' }>, 'frames'> = {
      t: 'start', seat, seed: m.seed, teams: m.teams, names: [r.seats[0]!.name, r.seats[1]!.name], inMs: Math.round(Math.max(0, m.startAt - now())), tick: m.s.tick,
    };
    return `${JSON.stringify(head).slice(0, -1)},"frames":${m.framesJson}}`;
  }

  // Tick n runs at startAt + n * tickMs; a late timer catches up (a few ticks at most per wake) instead of drifting.
  private schedule(r: Room): void {
    const m = r.match!;
    m.timer = setTimeout(() => {
      m.timer = null;
      let n = 0;
      try {
        while (r.match === m && !battleOver(m.s) && now() >= m.startAt + m.s.tick * this.o.tickMs && n++ < 5) {
          m.timing.lateMs.push(now() - (m.startAt + m.s.tick * this.o.tickMs));
          this.step(r);
        }
      } catch (e) { // one broken match must not take the process (and every other room) down with it
        this.log('match failed', { room: r.code, err: String(e) });
        return this.closeRoom(r, 'room_closed');
      }
      if (r.match === m && !battleOver(m.s)) this.schedule(r);
    }, Math.max(0, m.startAt + m.s.tick * this.o.tickMs - now()));
  }

  private step(r: Room): void {
    const m = r.match!, s = m.s, tick = s.tick;
    // The sim is the referee: each queued command is tried on a copy with the ones already accepted this tick; any
    // error event (mana, zone, used up, reloading) rejects it, so the frame only ever holds commands that take effect.
    const ok: NetCommand[] = [];
    for (const q of m.queue.get(tick) ?? []) {
      const trial = structuredClone(s), ev = stepBattle(trial, [...ok, q.c]).find((e) => e.e === 'error');
      if (ev) this.reject(r.seats[q.seat], 'sim', tick, ev.msg);
      else ok.push(q.c);
    }
    m.queue.delete(tick);
    if (ok.length > 0) { m.frames[tick] = ok; m.framesJson = null; }
    stepBattle(s, ok);
    m.timing.steps++;
    this.toRoom(r, { t: 'frame', tick, cmds: ok });
    if (s.tick % HASH_EVERY === 0 || battleOver(s)) {
      const h = battleHash(s);
      m.hashes.set(s.tick, h);
      for (const seat of [0, 1] as Side[]) { const c = m.told[seat].get(s.tick); if (c != null) this.compare(r, seat, s.tick, c); }
    }
    if (battleOver(s)) {
      const d = decision(s);
      this.finish(r, { winner: d.winner, type: d.type, step: d.step, tick: s.tick, hash: battleHash(s), castles: [s.castles[0].hp, s.castles[1].hp], flagged: m.flagged });
    }
  }

  private reject(p: Player | null, code: RejectCode, tick: number, msg?: string): void {
    this.stats.rejects[code] = (this.stats.rejects[code] ?? 0) + 1;
    this.send(p?.conn ?? null, msg ? { t: 'reject', code, tick, msg: msg.slice(0, 64) } : { t: 'reject', code, tick });
  }

  private command(p: Player, tick: number, c: NetCommand): void {
    const r = p.room, m = r?.match;
    if (!r || !m || now() < m.startAt || battleOver(m.s)) return this.reject(p, 'not_running', tick);
    if (c.side !== p.seat) return this.reject(p, 'wrong_side', tick);
    if (!this.cmdLimit.take(p.id)) return this.reject(p, 'too_many', tick);
    const next = m.s.tick, slack = tick - next;
    if (slack > AHEAD_TICKS) return this.reject(p, 'too_early', tick);
    if (slack < -LATE_TICKS) return this.reject(p, 'late', tick);
    if (c.t === 'summon' && !m.s.hands[p.seat].includes(c.card)) return this.reject(p, 'not_in_hand', tick);
    const at = Math.max(next, tick), q = m.queue.get(at) ?? [];
    if (q.filter((x) => x.seat === p.seat).length >= 2) return this.reject(p, 'too_many', tick);
    q.push({ seat: p.seat, c });
    m.queue.set(at, q);
    m.slack.push(slack);
  }

  private hash(p: Player, tick: number, h: string): void {
    const m = p.room?.match;
    if (!m || (tick % HASH_EVERY !== 0 && tick !== m.s.tick)) return;
    const mine = m.hashes.get(tick);
    if (mine != null) return this.compare(p.room!, p.seat, tick, h);
    if (tick > m.s.tick && m.told[p.seat].size < 8) m.told[p.seat].set(tick, h);
  }

  // A client whose state differs from the server's is told so; the server's result stands and the match is flagged.
  private compare(r: Room, seat: Side, tick: number, h: string): void {
    const m = r.match!;
    m.told[seat].delete(tick);
    if (m.hashes.get(tick) === h) return;
    if (!m.flagged) this.stats.desyncs++;
    m.flagged = true;
    this.send(r.seats[seat]?.conn ?? null, { t: 'desync', tick });
    this.log('desync', { room: r.code, seat, tick });
  }

  private forfeit(r: Room, seat: Side): void {
    const m = r.match;
    if (!m || battleOver(m.s)) return;
    this.finish(r, { winner: other(seat), type: 'forfeit', step: null, tick: m.s.tick, hash: battleHash(m.s), castles: [m.s.castles[0].hp, m.s.castles[1].hp], flagged: m.flagged });
  }

  private finish(r: Room, end: MatchEnd): void {
    const m = r.match!;
    if (m.timer) clearTimeout(m.timer);
    for (const g of m.grace) if (g) clearTimeout(g);
    m.s.winner ??= end.winner; // a forfeit stops the sim where it stands
    const keep = (xs: number[], add: number[]) => { xs.push(...add); if (xs.length > 20_000) xs.splice(0, xs.length - 20_000); };
    keep(this.stats.lateMs, m.timing.lateMs);
    keep(this.stats.slack, m.slack);
    const rec: MatchRecord = {
      id: randomBytes(8).toString('hex'), code: r.code, names: [r.seats[0]!.name, r.seats[1]!.name], end, playedAt: new Date().toISOString(),
      seed: m.seed, setups: [pvpSetup(m.teams[0]), pvpSetup(m.teams[1])], opts: { ...PVP_OPTS }, commands: framesToCommands(m.frames),
    };
    try { this.o.store.save(rec); } catch (e) { this.log('store failed', { err: String(e) }); }
    this.toRoom(r, { t: 'end', end });
    this.log('end', { room: r.code, ...end });
    for (const p of r.seats) if (p && p.room === r) p.room = null;
    clearTimeout(r.expires);
    this.rooms.delete(r.code);
  }

  // A guest in no room that has sent nothing for idleMs is sent away; one with no connection and no room for 10 minutes
  // is forgotten (a later hello just gets a new token); idle limiter entries too.
  private sweep(): void {
    const t = Date.now(), mono = now();
    for (const [k, p] of this.players) {
      if (p.conn && !p.room && mono - p.lastAt > this.o.idleMs) { this.send(p.conn, { t: 'error', code: 'idle' }); p.conn.close(4002, 'idle'); }
      else if (!p.conn && !p.room && t - p.leftAt > 600_000) this.players.delete(k);
    }
    for (const l of [this.createLimit, this.joinLimit, this.cmdLimit, this.guestLimit, this.reconnectLimit]) l.sweep();
  }
}
