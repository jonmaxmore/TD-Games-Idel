// The server's limits from the security review (docs/design/reviews/pvp-security.md): addresses, socket caps and
// rates, silent and slow sockets, room-code guessing, kicking, the replay store and the start-up checks.
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchRecord } from '../src/lobby';
import { configFromEnv, DirStore, ipKey, parseTrustProxy, type ServerOpts } from '../src/server';
import { room, startServer, TestClient } from './client';

let close: (() => Promise<void>) | null = null;
afterEach(async () => { vi.restoreAllMocks(); await close?.(); close = null; });
async function server(o: ServerOpts = {}) {
  const s = await startServer(o);
  close = () => s.app.close();
  return s;
}
const status = (p: Promise<unknown>) => p.then(() => 101, (e: Error) => Number(/HTTP (\d+)/.exec(e.message)?.[1] ?? 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('addresses', () => {
  it('keys IPv4 as is and IPv6 by its /64', () => {
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:0db8:0001:0002::9')).toBe('2001:db8:1:2::/64');
    expect(ipKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(ipKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('TRUST_PROXY takes exact addresses or CIDRs only', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('10.0.0.5, 10.1.0.0/16,fd00::/8')).toEqual(['10.0.0.5', '10.1.0.0/16', 'fd00::/8']);
    for (const bad of ['true', '*', 'loopback', '0.0.0.0/0', '10.0.0.0/33', '10.0.0.1/8/1']) expect(() => parseTrustProxy(bad)).toThrow('TRUST_PROXY');
  });

  it('counts the forwarded address only from a trusted proxy, by /64', async () => {
    const xff = (ip: string) => ({ 'x-forwarded-for': ip });
    const trusted = await server({ trustProxy: ['127.0.0.1'], maxConnsPerIp: 1 });
    await TestClient.open(trusted.url, xff('2001:db8:1:2::1'));
    expect(await status(TestClient.open(trusted.url, xff('2001:db8:1:2::9')))).toBe(429);
    expect(await status(TestClient.open(trusted.url, xff('2001:db8:1:3::1')))).toBe(101);
    await close!();
    const direct = await server({ maxConnsPerIp: 1 });
    await TestClient.open(direct.url, xff('198.51.100.1'));
    expect(await status(TestClient.open(direct.url, xff('198.51.100.2')))).toBe(429);
  });
});

describe('sockets', () => {
  it('counts a socket before its upgrade, so parallel upgrades cannot pass the per-address cap, and frees it on close', async () => {
    const { url } = await server({ maxConnsPerIp: 3, upgrades: { burst: 100, perSec: 100 } });
    const tries = await Promise.allSettled(Array.from({ length: 8 }, () => TestClient.open(url)));
    const open = tries.flatMap((t) => (t.status === 'fulfilled' ? [t.value] : []));
    expect(open.length).toBe(3);
    for (const c of open) { c.close(); await c.waitClose(); }
    await sleep(50);
    expect((await Promise.allSettled(Array.from({ length: 3 }, () => TestClient.open(url)))).every((t) => t.status === 'fulfilled')).toBe(true);
  });

  it('refuses sockets past the server-wide cap, and new sockets from one address faster than the upgrade rate', async () => {
    const one = await server({ maxSockets: 2 });
    const a = await TestClient.open(one.url);
    await TestClient.open(one.url);
    expect(await status(TestClient.open(one.url))).toBe(503);
    a.close(); await a.waitClose(); await sleep(50);
    expect(await status(TestClient.open(one.url))).toBe(101);
    await close!();
    const two = await server({ upgrades: { burst: 2, perSec: 1 } });
    await TestClient.open(two.url); await TestClient.open(two.url);
    expect(await status(TestClient.open(two.url))).toBe(429);
  });

  it('closes a socket that has not said hello in time, and sends away a guest idle outside any room', async () => {
    const { url } = await server({ helloMs: 100, idleMs: 150 });
    const quiet = await TestClient.open(url);
    expect(await quiet.waitClose(1000)).toEqual({ code: 1008, reason: 'hello timeout' });
    const idle = await TestClient.open(url), host = await TestClient.open(url);
    await idle.hello('idle'); await host.hello('host');
    host.send({ t: 'create' });
    await host.next('room');
    expect((await idle.next('error', () => true, 2000)).code).toBe('idle');
    expect((await idle.waitClose()).code).toBe(4002);
    expect(host.closed).toBeNull(); // in a room: not idle
  });

  it('cuts a socket that stops answering pings; in a match that starts the reconnect window, then the forfeit', async () => {
    const { url } = await server({ pingMs: 50, tickMs: 10, graceMs: 200 });
    const lone = await TestClient.open(url, {}, { autoPong: false });
    await lone.hello('lone');
    expect((await lone.waitClose(1000)).code).toBe(1006);
    const { a } = await room(url, { autoPong: false });
    expect((await a.next('peer', (m) => !m.online, 2000)).seat).toBe(1);
    const e = await a.next('end', () => true, 3000);
    expect([e.end.type, e.end.winner]).toEqual(['forfeit', 0]);
  });

  it('cuts a client that is not reading once its queue passes the cap', async () => {
    const { url, app } = await server({ maxBuffered: 1000 });
    const c = await TestClient.open(url);
    await c.hello('slow');
    const [peer] = [...app.websocketServer.clients];
    Object.defineProperty(peer, 'bufferedAmount', { get: () => 5000 });
    c.send({ t: 'ping', n: 1 });
    expect((await c.waitClose()).code).toBe(1006);
    expect(c.got.some((m) => m.t === 'pong')).toBe(false);
  });

  it('/health says only that it is up', async () => {
    const { http } = await server();
    expect(await (await fetch(`${http}/health`)).json()).toEqual({ ok: true });
  });
});

describe('rooms', () => {
  it('limits reconnects per guest token', async () => {
    const { url } = await server({ upgrades: { burst: 10, perSec: 10 } });
    const first = await TestClient.open(url);
    const { token } = await first.hello('me');
    for (let i = 0; i < 3; i++) await (await TestClient.open(url)).hello('me', token);
    const fourth = await TestClient.open(url);
    fourth.send({ t: 'hello', v: 1, name: 'me', token });
    expect((await fourth.next('error')).code).toBe('rate_limited');
  });

  it('a server-wide budget of wrong codes, once spent, refuses joins even with a right code', async () => {
    const { url } = await server({ joinFailsPerMin: 3 });
    const host = await TestClient.open(url), g = await TestClient.open(url);
    await host.hello('host'); await g.hello('guest');
    host.send({ t: 'create' });
    const { code } = await host.next('room');
    for (let i = 0; i < 3; i++) { g.send({ t: 'join', code: 'ZZZZZZ' }); expect((await g.next('error')).code).toBe('room_not_found'); }
    g.send({ t: 'join', code });
    expect((await g.next('error')).code).toBe('rate_limited');
  });

  it('the host kicks the guest, who cannot come back to that room', async () => {
    const { url } = await server();
    const host = await TestClient.open(url), g = await TestClient.open(url);
    await host.hello('host'); await g.hello('guest');
    host.send({ t: 'create' });
    const { code } = await host.next('room');
    g.send({ t: 'join', code });
    await host.next('room', (m) => m.seats[1] != null);
    g.send({ t: 'kick' }); // only the host may
    host.send({ t: 'kick' });
    expect((await g.next('error')).code).toBe('kicked');
    expect((await host.next('room', (m) => m.seats[1] == null)).seats[1]).toBeNull();
    g.send({ t: 'join', code });
    expect((await g.next('error')).code).toBe('kicked');
  });

  it('match timing ignores a wall-clock step', async () => {
    const { url } = await server({ tickMs: 10, startDelayMs: 0 });
    const { a } = await room(url);
    await a.next('frame', (m) => m.tick === 5, 2000);
    const t = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(t - 3_600_000);
    expect((await a.next('frame', (m) => m.tick === 30, 2000)).tick).toBe(30);
  });

  it('message and command rates count match time, so a sped-up match does not cut a client within them', async () => {
    const { url } = await server({ tickMs: 5, startDelayMs: 0 }); // 10x speed: 200 ticks are 10 s of match time in 1 s
    const { a } = await room(url);
    a.onMsg = (m) => {
      if (m.t !== 'frame') return;
      a.send({ t: 'ping', n: m.tick }); // 20 a match second, under 30
      if (m.tick % 4 === 0) a.send({ t: 'cmd', tick: m.tick + 3, c: { t: 'cannon', side: 0, d: 0 } }); // 5, under 6
    };
    const cut = a.waitClose(5000).catch(() => null);
    expect(await Promise.race([a.next('frame', (m) => m.tick === 200, 5000).then(() => null), cut])).toBe(null);
    expect(a.got.filter((m) => m.t === 'reject' && m.code === 'too_many')).toEqual([]);
  });
});

describe('replays and start-up', () => {
  it('writes replays off the tick loop and keeps only the newest maxFiles', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'replays-')), store = new DirStore(dir, 3);
    for (let i = 0; i < 5; i++) store.save({ id: `m${i}`, playedAt: `2026-11-08T10:00:0${i}.000Z` } as MatchRecord);
    await store.flush();
    expect(readdirSync(dir).sort()).toEqual(['2026-11-08T10-00-02-000Z-m2.json', '2026-11-08T10-00-03-000Z-m3.json', '2026-11-08T10-00-04-000Z-m4.json']);
    expect(store.records.length).toBe(5);
  });

  it('refuses to listen beyond this machine without ORIGINS', () => {
    expect(() => configFromEnv({ HOST: '0.0.0.0' })).toThrow('ORIGINS');
    expect(() => configFromEnv({ HOST: '::' })).toThrow('ORIGINS');
    expect(configFromEnv({ HOST: '0.0.0.0', ORIGINS: 'https://play.example' }).host).toBe('0.0.0.0');
    expect(configFromEnv({}).host).toBe('127.0.0.1');
    expect(configFromEnv({ TRUST_PROXY: '10.0.0.5' }).opts.trustProxy).toEqual(['10.0.0.5']);
  });
});
