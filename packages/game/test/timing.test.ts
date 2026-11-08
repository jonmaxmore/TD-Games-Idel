// Real time: 20 Hz on loopback for 6 s of play with both bots summoning. Measures the server tick lateness, the client's
// round trip, the gap between frames at the client, and how much of the INPUT_DELAY window each command had left when
// it reached the server (negative: it arrived late and ran on the next tick instead).
import { describe, expect, it } from 'vitest';
import { botCommands, botRng } from '../../sim/test/battleBot';
import { INPUT_DELAY, leaderPool } from '@five-sects/protocol';
import { buildServer, MemoryStore } from '../src/server';
import { TestClient } from './client';

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : NaN; };
const r1 = (x: number) => Math.round(x * 10) / 10;

describe('timing at 20 Hz', () => {
  it('ticks on schedule and commands land inside the input-delay window', async () => {
    const { app, lobby } = await buildServer({ startDelayMs: 100, store: new MemoryStore() });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port, url = `ws://127.0.0.1:${port}/v1/ws`;
    const [L0, S0, L1, S1] = leaderPool();
    const a = await TestClient.open(url), b = await TestClient.open(url);
    await a.hello('a'); await b.hello('b');
    a.send({ t: 'create' });
    const { code } = await a.next('room');
    b.send({ t: 'join', code });
    await b.next('room');
    a.send({ t: 'team', team: { leader: L0!, sub: S0! } }); b.send({ t: 'team', team: { leader: L1!, sub: S1! } });
    a.send({ t: 'ready', on: true }); b.send({ t: 'ready', on: true });
    const st = await a.next('start');
    await b.next('start');
    const gaps: number[] = [], rtt: number[] = [];
    let lastAt = 0;
    for (const [c, seat] of [[a, 0], [b, 1]] as const) {
      const mind = botRng(st.seed, seat);
      c.onMsg = (m) => {
        if (m.t === 'frame' && seat === 0) { const t = performance.now(); if (lastAt) gaps.push(t - lastAt); lastAt = t; }
        if (m.t !== 'frame' || !c.ls) return;
        for (const h of c.ls.run(() => { for (const cmd of botCommands(c.ls!.s, seat, 'rush', mind)) c.send(c.ls!.cmd(cmd)); })) c.send(h);
      };
    }
    const pings = setInterval(() => { const t0 = performance.now(), n = Math.floor(t0) % 1e9; a.send({ t: 'ping', n }); void a.next('pong', (m) => m.n === n).then(() => rtt.push(performance.now() - t0), () => {}); }, 200);
    await a.next('frame', (m) => m.tick === 120, 15_000);
    clearInterval(pings);
    a.send({ t: 'leave' });
    await b.next('end');
    const late = lobby.stats.lateMs, slack = lobby.stats.slack;
    const report = {
      ticks: late.length, tickLateMs: { p50: pct(late, 50), p99: pct(late, 99), max: Math.max(...late) },
      frameGapMs: { p50: r1(pct(gaps, 50)), p1: r1(pct(gaps, 1)), p99: r1(pct(gaps, 99)) }, rttMs: { p50: r1(pct(rtt, 50)), max: r1(Math.max(...rtt)) },
      commands: slack.length, slackTicks: { min: Math.min(...slack), p50: pct(slack, 50) }, arrivedLate: slack.filter((x) => x < 0).length, inputDelayTicks: INPUT_DELAY,
      rejects: lobby.stats.rejects,
    };
    console.log('timing', JSON.stringify(report));
    await app.close();
    expect(report.ticks).toBeGreaterThanOrEqual(120);
    expect(report.tickLateMs.p99).toBeLessThan(25);
    expect(report.commands).toBeGreaterThan(2);
    expect(report.arrivedLate).toBe(0);
  }, 30_000);
});
