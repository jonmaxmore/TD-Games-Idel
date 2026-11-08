// Friend rooms end to end: a real server on a free port, two headless clients over WebSocket. The battle bots play a
// whole match through the room; both clients must end on the server's hash and replayBattle must reproduce it.
import { afterEach, describe, expect, it } from 'vitest';
import { battleHash, battleOver, battleUnits, replayBattle, type Side } from '@five-sects/sim';
import { autoTeam, leaderPool, type ServerMsg } from '@five-sects/protocol';
import { botCommands, botRng, type Policy } from '../../sim/test/battleBot';
import { buildServer, MemoryStore, type ServerOpts } from '../src/server';
import { TestClient } from './client';

const [L0, S0, L1, S1] = leaderPool();
let close: (() => Promise<void>) | null = null;
afterEach(async () => { await close?.(); close = null; });

async function server(o: ServerOpts = {}) {
  const store = new MemoryStore();
  const { app, lobby } = await buildServer({ tickMs: 2, startDelayMs: 20, graceMs: 2000, store, ...o });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const url = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/v1/ws`;
  close = () => app.close();
  return { url, store, lobby };
}

// Host creates, guest joins by code, both pick a team and ready up; resolves on both start messages.
async function room(url: string) {
  const a = await TestClient.open(url), b = await TestClient.open(url);
  const wa = await a.hello('เจ้าบ้าน'), wb = await b.hello('แขก');
  a.send({ t: 'create' });
  const { code } = await a.next('room');
  b.send({ t: 'join', code: code.toLowerCase() });
  const r = await b.next('room');
  expect(r.seat).toBe(1);
  expect(r.seats[0]?.name).toBe('เจ้าบ้าน');
  a.send({ t: 'team', team: autoTeam(L0!, S0!) });
  b.send({ t: 'team', team: autoTeam(L1!, S1!) });
  a.send({ t: 'ready', on: true });
  b.send({ t: 'ready', on: true });
  const [sa, sb] = await Promise.all([a.next('start'), b.next('start')]);
  return { a, b, code, sa, sb, tokens: [wa.token, wb.token] as const };
}

// Plays a side with a bot: after every frame, step the local sim and send what the bot decides, stamped by Lockstep.
function bot(c: TestClient, seat: Side, policy: Policy, seed: number, opts: { badHashAt?: number } = {}) {
  const mind = botRng(seed, seat);
  c.onMsg = (m: ServerMsg) => {
    if (m.t !== 'frame' || !c.ls) return;
    const hashes = c.ls.run(() => { for (const cmd of botCommands(c.ls!.s, seat, policy, mind)) c.send(c.ls!.cmd(cmd)); });
    for (const h of hashes) c.send(h.t === 'hash' && h.tick === opts.badHashAt ? { ...h, h: '00000000' } : h);
  };
}

describe('friend rooms', () => {
  it('a bot-vs-bot match through a room: both clients end on the server hash, and the saved record replays to it', async () => {
    const { url, store } = await server({ tickMs: 5 }); // at 2 ms a tick the bots outrun the per-second message limits
    const { a, b, sa } = await room(url);
    expect(sa.teams).toEqual([autoTeam(L0!, S0!), autoTeam(L1!, S1!)]);
    bot(a, 0, 'rush', sa.seed); bot(b, 1, 'defend', sa.seed);
    const [ea, eb] = await Promise.all([a.next('end', () => true, 150_000), b.next('end', () => true, 150_000)]);
    expect(ea.end).toEqual(eb.end);
    expect(battleOver(a.ls!.s) && battleOver(b.ls!.s)).toBe(true);
    expect(battleHash(a.ls!.s)).toBe(ea.end.hash);
    expect(battleHash(b.ls!.s)).toBe(ea.end.hash);
    expect(ea.end.flagged).toBe(false);
    const rec = JSON.parse(JSON.stringify(store.records[0]));
    expect(rec.end.hash).toBe(ea.end.hash);
    expect(Object.keys(rec.commands).length).toBeGreaterThan(5);
    const s = replayBattle(rec);
    expect(battleHash(s)).toBe(ea.end.hash);
    expect(s.winner).toBe(ea.end.winner);
    expect(rec.commands).toEqual(a.ls!.log);
  });

  it('refuses a malformed message, a command for the other side, a card not in hand and one it cannot afford', async () => {
    const { url } = await server({ tickMs: 20, startDelayMs: 0 });
    const { a, b } = await room(url);
    a.onMsg = (m) => { if (m.t === 'frame') a.ls!.run(); };
    await a.next('frame');
    const notMine = leaderPool().find((c) => !a.ls!.s.hands[0].includes(c))!;
    a.send(a.ls!.cmd({ t: 'summon', side: 1, card: a.ls!.s.hands[1][0]!, d: 0 }));
    expect((await a.next('reject')).code).toBe('wrong_side');
    a.send(a.ls!.cmd({ t: 'summon', side: 0, card: notMine, d: 0 }));
    expect((await a.next('reject')).code).toBe('not_in_hand');
    a.send({ t: 'cmd', tick: a.ls!.s.tick + 500, c: { t: 'cannon', side: 0, d: 0 } });
    expect((await a.next('reject')).code).toBe('too_early');
    a.send(a.ls!.cmd({ t: 'cannon', side: 0, d: 999_999 })); // out of reach: only the sim knows, so it refuses it
    const r = await a.next('reject');
    expect([r.code, r.msg]).toEqual(['sim', 'out of cannon reach']);
    b.send('{"t":"cmd","tick":1}');
    expect((await b.next('error')).code).toBe('bad_message');
    expect((await b.waitClose()).code).toBe(1008);
  });

  it('refuses a team that is not a legal deck (validateDeck) with bad_team and keeps the seat without one', async () => {
    const { url } = await server();
    const a = await TestClient.open(url);
    await a.hello('a');
    a.send({ t: 'create' });
    await a.next('room');
    const t = autoTeam(L0!, S0!), large = leaderPool().filter((c) => battleUnits.get(c)!.size === 'large' && c !== L0 && c !== S0);
    a.send({ t: 'team', team: { ...t, picks: [...large.slice(0, 3), t.picks[3]!] } });
    expect((await a.next('error')).code).toBe('bad_team');
    a.send({ t: 'team', team: t });
    expect((await a.next('room')).seats[0]?.team).toEqual(t);
  });

  it('an expired room code: the host is told it closed and a join finds nothing', async () => {
    const { url } = await server({ roomTtlMs: 150 });
    const a = await TestClient.open(url), b = await TestClient.open(url);
    await a.hello('a'); await b.hello('b');
    a.send({ t: 'create' });
    const { code, expiresSec } = await a.next('room');
    expect(expiresSec).toBe(1);
    expect((await a.next('error')).code).toBe('room_closed');
    b.send({ t: 'join', code });
    expect((await b.next('error')).code).toBe('room_not_found');
    b.send({ t: 'join', code: 'ZZZZZZ' });
    expect((await b.next('error')).code).toBe('room_not_found');
  });

  it('a dropped player reconnects with its token inside the window and both still end on the server hash', async () => {
    const { url, store } = await server({ tickMs: 8 }); // faster ticks let the bots outrun the per-second message limits
    const { a, b, sa, tokens } = await room(url);
    bot(a, 0, 'rush', sa.seed);
    await a.next('frame', (m) => m.tick === 200, 60_000);
    b.close();
    await a.next('peer', (m) => !m.online);
    const b2 = await TestClient.open(url);
    await b2.hello('ignored', tokens[1]);
    const st = await b2.next('start');
    expect(st.seat).toBe(1);
    expect(st.tick).toBeGreaterThan(200);
    expect(battleHash(b2.ls!.s)).not.toBe('');
    await a.next('peer', (m) => m.online);
    bot(b2, 1, 'defend', sa.seed);
    const e = await b2.next('end', () => true, 150_000);
    expect(e.end.type).not.toBe('forfeit');
    expect(battleHash(b2.ls!.s)).toBe(e.end.hash);
    expect(battleHash(replayBattle(store.records[0]!))).toBe(e.end.hash);
    expect(store.records[0]!.names).toEqual(['เจ้าบ้าน', 'แขก']);
  });

  it('a player gone past the reconnect window forfeits; leaving a match forfeits at once', async () => {
    const { url, store } = await server({ tickMs: 10, graceMs: 200 });
    const one = await room(url);
    one.b.close();
    const e = await one.a.next('end', () => true, 5000);
    expect([e.end.type, e.end.winner]).toEqual(['forfeit', 0]);
    expect(store.records[0]!.end.type).toBe('forfeit');
    const two = await room(url);
    two.a.send({ t: 'leave' });
    const e2 = await two.b.next('end');
    expect([e2.end.type, e2.end.winner]).toEqual(['forfeit', 1]);
  });

  it('a client whose state hash differs is told of the desync and the match is flagged; the server result stands', async () => {
    const { url, lobby } = await server({ tickMs: 2 });
    const { a, b, sa } = await room(url);
    bot(a, 0, 'rush', sa.seed); bot(b, 1, 'rush', sa.seed, { badHashAt: 100 });
    const d = await b.next('desync', () => true, 60_000);
    expect(d.tick).toBe(100);
    const e = await a.next('end', () => true, 150_000);
    expect(e.end.flagged).toBe(true);
    expect(lobby.stats.desyncs).toBe(1);
    expect(a.got.some((m) => m.t === 'desync')).toBe(false);
  });

  it('refuses a foreign browser origin, the wrong protocol version, and too many join attempts', async () => {
    const { url } = await server();
    await expect(TestClient.open(url, { origin: 'https://evil.example' })).rejects.toThrow('HTTP 403');
    const ok = await TestClient.open(url, { origin: 'http://localhost:5173' });
    ok.send({ t: 'hello', v: 99, name: 'x' });
    expect((await ok.next('error')).code).toBe('version');
    const c = await TestClient.open(url);
    await c.hello('c');
    for (let i = 0; i < 12; i++) c.send({ t: 'join', code: 'ABCDEF' });
    const codes: string[] = [];
    for (let i = 0; i < 12; i++) codes.push((await c.next('error')).code);
    expect(codes.filter((x) => x === 'room_not_found').length).toBe(10);
    expect(codes.filter((x) => x === 'rate_limited').length).toBe(2);
  });
});
