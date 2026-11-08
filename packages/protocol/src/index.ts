// Friend-room PvP wire protocol (SPEC-pvp-rooms): every message between the client and the game server, versioned, and
// checked at the boundary by parseClient / parseServer. A message that is too large, not JSON, of an unknown type, or that
// carries an unknown or malformed field is rejected whole. Shared by packages/client and packages/game.
import {
  autoPicks, battle, battleUnits, isBasic, rankedPool, TICK_HZ, validateDeck, type BattleCommand, type BattleSetup, type DeckError, type ResultType, type Side,
  type TiebreakStep,
} from '@five-sects/sim';

export const PROTOCOL_VERSION = 2;
export const TICK_MS = 1000 / TICK_HZ;
// A client stamps each command for its latest frame + INPUT_DELAY; the server runs it at that tick, or at the next one when
// it came late by at most LATE_TICKS, and refuses one stamped more than AHEAD_TICKS past its own tick.
export const INPUT_DELAY = 3;
export const LATE_TICKS = 10;
export const AHEAD_TICKS = 40;
export const HASH_EVERY = TICK_HZ * 5; // clients send their state hash every 5 s of match time (matchmaking.md §8)
export const RECONNECT_SEC = 20;
export const MAX_CLIENT_BYTES = 1024;
export const MAX_SERVER_BYTES = 256 * 1024;
// Room codes: no 0/O, 1/I/L or U/V lookalikes.
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTWXYZ';
export const CODE_LEN = 6;
export const NAME_MAX = 16;
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

// ---- the shapes ----
export interface TeamPick { leader: string; sub: string; picks: string[] }
// What a client may ask the sim to do; side must be the client's own seat (checked by the server).
export type NetCommand = Extract<BattleCommand, { t: 'summon' } | { t: 'cannon' }>;
export type ClientMsg =
  | { t: 'hello'; v: number; name: string; token?: string }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'team'; team: TeamPick }
  | { t: 'ready'; on: boolean }
  | { t: 'leave' }
  | { t: 'cmd'; tick: number; c: NetCommand }
  | { t: 'hash'; tick: number; h: string }
  | { t: 'ping'; n: number };

export interface Seat { name: string; team: TeamPick | null; ready: boolean; online: boolean }
export type EndType = ResultType | 'forfeit';
export interface MatchEnd { winner: Side | -1; type: EndType; step: TiebreakStep | null; tick: number; hash: string; castles: [number, number]; flagged: boolean }
export type ErrorCode =
  | 'bad_message' | 'version' | 'need_hello' | 'rate_limited' | 'room_not_found' | 'room_full' | 'room_closed' | 'not_in_room'
  | 'bad_team' | 'no_team' | 'in_match' | 'server_full' | 'replaced';
export type RejectCode = 'wrong_side' | 'late' | 'too_early' | 'not_in_hand' | 'too_many' | 'not_running' | 'sim';
export type ServerMsg =
  | { t: 'welcome'; v: number; token: string; name: string; delay: number; tickMs: number }
  | { t: 'room'; code: string; seat: Side; seats: [Seat | null, Seat | null]; expiresSec: number }
  | { t: 'start'; seat: Side; seed: number; teams: [TeamPick, TeamPick]; names: [string, string]; inMs: number; tick: number; frames: Record<string, NetCommand[]> }
  | { t: 'frame'; tick: number; cmds: NetCommand[] }
  | { t: 'reject'; code: RejectCode; tick: number; msg?: string }
  | { t: 'peer'; seat: Side; online: boolean; graceSec: number }
  | { t: 'desync'; tick: number }
  | { t: 'end'; end: MatchEnd }
  | { t: 'error'; code: ErrorCode }
  | { t: 'pong'; n: number; tick: number };

// ---- the team: ranked ศึกฝีมือ rules (SPEC-deck-budget: a chosen hand from every card, the deck budget, normalized) ----
export const leaderPool = (): string[] => rankedPool.filter((c) => !isBasic(c));
// The server refuses a team that is not a legal deck from the ranked pool (bad_team).
export const teamError = (t: TeamPick): DeckError | null => validateDeck(t, rankedPool);
// A legal team for a leader and sub: the picks autoPicks makes from the ranked pool.
export const autoTeam = (leader: string, sub: string): TeamPick => ({ leader, sub, picks: autoPicks(leader, sub, rankedPool) });
export const pvpSetup = (t: TeamPick): BattleSetup => ({ leader: t.leader, sub: t.sub, picks: t.picks });
export const PVP_OPTS = { normalized: true } as const;

// ---- the validator: a check returns the value or throws ----
export class ProtocolError extends Error {}
type Check<T> = (x: unknown, at: string) => T;
const fail = (at: string, why: string): never => { throw new ProtocolError(`${at}: ${why}`); };
const int = (lo: number, hi: number): Check<number> => (x, at) => (Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi ? (x as number) : fail(at, `integer ${lo}..${hi}`));
const bool: Check<boolean> = (x, at) => (typeof x === 'boolean' ? x : fail(at, 'boolean'));
const str = (max: number, re?: RegExp): Check<string> => (x, at) => (typeof x === 'string' && x.length <= max && (!re || re.test(x)) ? x : fail(at, 'string'));
const oneOf = <T extends string>(...vs: T[]): Check<T> => (x, at) => (vs.includes(x as T) ? (x as T) : fail(at, `one of ${vs.join('|')}`));
const nullable = <T>(c: Check<T>): Check<T | null> => (x, at) => (x === null ? null : c(x, at));
const arr = <T>(c: Check<T>, max: number, len?: number): Check<T[]> => (x, at) => {
  if (!Array.isArray(x) || x.length > max || (len != null && x.length !== len)) return fail(at, 'array');
  return x.map((v, i) => c(v, `${at}[${i}]`));
};
const pair = <T>(c: Check<T>): Check<[T, T]> => (x, at) => arr(c, 2, 2)(x, at) as [T, T];
type Shape = Record<string, Check<unknown>>;
type Out<S extends Shape, O extends string> = { [K in Exclude<keyof S, O>]: ReturnType<S[K]> } & { [K in O & keyof S]?: ReturnType<S[K]> };
// A plain object with exactly these keys (the optional ones may be missing); any other key is an error.
function obj<S extends Shape, O extends string = never>(shape: S, optional: readonly O[] = []): Check<Out<S, O>> {
  return (x, at) => {
    if (x == null || typeof x !== 'object' || Array.isArray(x) || Object.getPrototypeOf(x) !== Object.prototype) return fail(at, 'object');
    const o = x as Record<string, unknown>, r: Record<string, unknown> = {};
    for (const k of Object.keys(o)) if (!Object.hasOwn(shape, k)) fail(`${at}.${k}`, 'unknown field');
    for (const [k, c] of Object.entries(shape)) {
      if (!Object.hasOwn(o, k)) { if ((optional as readonly string[]).includes(k)) continue; fail(`${at}.${k}`, 'missing'); }
      r[k] = c(o[k], `${at}.${k}`);
    }
    return r as Out<S, O>;
  };
}
const record = <T>(key: RegExp, c: Check<T>, max: number): Check<Record<string, T>> => (x, at) => {
  if (x == null || typeof x !== 'object' || Array.isArray(x) || Object.getPrototypeOf(x) !== Object.prototype) return fail(at, 'object');
  const e = Object.entries(x as Record<string, unknown>);
  if (e.length > max) fail(at, 'too many entries');
  return Object.fromEntries(e.map(([k, v]) => [key.test(k) ? k : fail(`${at}.${k}`, 'key'), c(v, `${at}.${k}`)]));
};

const MAX_TICK = battle.matchTicks + 1;
const sideNum: Check<Side> = (x, at) => (x === 0 || x === 1 ? x : fail(at, '0 or 1'));
const card: Check<string> = (x, at) => (typeof x === 'string' && battleUnits.has(x) ? x : fail(at, 'card'));
const depth = int(0, 1_000_000);
const command: Check<NetCommand> = (x, at) => {
  const t = (x as { t?: unknown } | null)?.t;
  if (t === 'summon') return obj({ t: oneOf('summon'), side: sideNum, card, d: depth })(x, at);
  if (t === 'cannon') return obj({ t: oneOf('cannon'), side: sideNum, d: depth })(x, at);
  return fail(`${at}.t`, 'summon|cannon');
};
const team = obj({ leader: card, sub: card, picks: arr(card, battle.deck.pick, battle.deck.pick) });
const tickNum = int(0, MAX_TICK);
// Display names: letters (Thai included), digits, spaces, _ and -; no controls, no markup.
export const NAME_RE = /^[\p{L}\p{M}\p{N} _-]{1,16}$/u;
export const cleanName = (raw: string): string | null => { const n = raw.normalize('NFC').trim().replace(/\s+/g, ' '); return NAME_RE.test(n) ? n : null; };

const CLIENT: Record<ClientMsg['t'], Check<unknown>> = {
  hello: obj({ t: oneOf('hello'), v: int(0, 1000), name: str(NAME_MAX * 4), token: str(43, TOKEN_RE) }, ['token']),
  create: obj({ t: oneOf('create') }),
  join: obj({ t: oneOf('join'), code: str(CODE_LEN + 4) }),
  team: obj({ t: oneOf('team'), team }),
  ready: obj({ t: oneOf('ready'), on: bool }),
  leave: obj({ t: oneOf('leave') }),
  cmd: obj({ t: oneOf('cmd'), tick: tickNum, c: command }),
  hash: obj({ t: oneOf('hash'), tick: tickNum, h: str(8, /^[0-9a-f]{8}$/) }),
  ping: obj({ t: oneOf('ping'), n: int(0, 2 ** 31) }),
};
const seat = nullable(obj({ name: str(NAME_MAX), team: nullable(team), ready: bool, online: bool }));
const end = obj({
  winner: (x, at) => (x === -1 ? -1 : sideNum(x, at)), type: oneOf('total', 'castle', 'hp', 'tiebreak', 'draw', 'forfeit'),
  step: nullable(oneOf('forts', 'mana', 'units', 'kills')), tick: tickNum, hash: str(8), castles: pair(int(-1_000_000, 1_000_000)), flagged: bool,
});
const SERVER: Record<ServerMsg['t'], Check<unknown>> = {
  welcome: obj({ t: oneOf('welcome'), v: int(0, 1000), token: str(43, TOKEN_RE), name: str(NAME_MAX), delay: int(0, 100), tickMs: int(1, 1000) }),
  room: obj({ t: oneOf('room'), code: str(CODE_LEN), seat: sideNum, seats: pair(seat), expiresSec: int(0, 86400) }),
  start: obj({ t: oneOf('start'), seat: sideNum, seed: int(0, 2 ** 32), teams: pair(team), names: pair(str(NAME_MAX)), inMs: int(0, 60_000), tick: tickNum, frames: record(/^\d{1,5}$/, arr(command, 16), MAX_TICK) }),
  frame: obj({ t: oneOf('frame'), tick: tickNum, cmds: arr(command, 16) }),
  reject: obj({ t: oneOf('reject'), code: oneOf('wrong_side', 'late', 'too_early', 'not_in_hand', 'too_many', 'not_running', 'sim'), tick: tickNum, msg: str(64) }, ['msg']),
  peer: obj({ t: oneOf('peer'), seat: sideNum, online: bool, graceSec: int(0, 3600) }),
  desync: obj({ t: oneOf('desync'), tick: tickNum }),
  end: obj({ t: oneOf('end'), end }),
  error: obj({ t: oneOf('error'), code: oneOf('bad_message', 'version', 'need_hello', 'rate_limited', 'room_not_found', 'room_full', 'room_closed', 'not_in_room', 'bad_team', 'no_team', 'in_match', 'server_full', 'replaced') }),
  pong: obj({ t: oneOf('pong'), n: int(0, 2 ** 31), tick: tickNum }),
};

function parse<T>(raw: unknown, max: number, table: Record<string, Check<unknown>>): T {
  let text: string;
  if (typeof raw === 'string') text = raw;
  else if (raw instanceof Uint8Array) { try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { return fail('message', 'not UTF-8'); } }
  else return fail('message', 'text');
  if (text.length > max) fail('message', 'too large');
  let x: unknown;
  try { x = JSON.parse(text); } catch { fail('message', 'not JSON'); }
  const t = (x as { t?: unknown } | null)?.t;
  const check = typeof t === 'string' && Object.hasOwn(table, t) ? table[t]! : fail('t', 'unknown type');
  return check(x, t as string) as T;
}
// Parse a message off the wire; throws ProtocolError on anything not exactly in the protocol.
export const parseClient = (raw: unknown): ClientMsg => parse<ClientMsg>(raw, MAX_CLIENT_BYTES, CLIENT);
export const parseServer = (raw: unknown): ServerMsg => parse<ServerMsg>(raw, MAX_SERVER_BYTES, SERVER);
// A room code as typed: upper-cased, spaces and dashes dropped; null unless it is CODE_LEN letters of the alphabet.
export function normalizeCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  return c.length === CODE_LEN && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : null;
}
// The frames of a match as a BattleRecord's commands (every tick that had any).
export const framesToCommands = (frames: Record<string, NetCommand[]>): Record<number, BattleCommand[]> =>
  Object.fromEntries(Object.entries(frames).filter(([, c]) => c.length > 0).map(([t, c]) => [Number(t), c]));
export { Lockstep } from './lockstep';
