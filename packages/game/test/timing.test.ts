// Real time: 20 Hz on loopback for 6 s of play with both bots summoning. Measures the server tick lateness, the client's
// round trip, the gap between frames at the client, and how much of the INPUT_DELAY window each command had left when
// it reached the server (negative: it arrived late and ran on the next tick instead).
// Wall clock on a shared machine: vitest.config.ts runs this file alone, and a measurement that another process spoiled
// (the OS took the CPU for a few hundred ms) is taken again, up to two more times. A slow or drifting server fails all three.
import { readFileSync } from 'node:fs';
import { describe, expect, it, onTestFinished } from 'vitest';
import { botCommands, botRng } from '../../sim/test/battleBot';
import { INPUT_DELAY, autoTeam, leaderPool } from '@five-sects/protocol';
import { buildServer, MemoryStore } from '../src/server';
import { TestClient } from './client';

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : NaN; };
const r1 = (x: number) => Math.round(x * 10) / 10;
// Linux: ms this thread spent runnable but waiting for a CPU (schedstat run_delay); a failure with a large value was the OS.
const runQueueMs = () => { try { return Number(readFileSync('/proc/thread-self/schedstat', 'utf8').split(' ')[1]) / 1e6; } catch { return NaN; } };

describe('timing at 20 Hz', () => {
  it('ticks on schedule and commands land inside the input-delay window', { retry: 2, timeout: 30_000 }, async () => {
    const { app, lobby } = await buildServer({ startDelayMs: 100, store: new MemoryStore() });
    onTestFinished(() => app.close());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port, url = `ws://127.0.0.1:${port}/v1/ws`;
    const [L0, S0, L1, S1] = leaderPool();
    const a = await TestClient.open(url), b = await TestClient.open(url);
    await a.hello('a'); await b.hello('b');
    a.send({ t: 'create' });
    const { code } = await a.next('room');
    b.send({ t: 'join', code });
    await b.next('room');
    a.send({ t: 'team', team: autoTeam(L0!, S0!) }); b.send({ t: 'team', team: autoTeam(L1!, S1!) });
    await a.next('room', (m) => m.seats[0]?.team != null && m.seats[1]?.team != null);
    a.send({ t: 'ready', on: true }); b.send({ t: 'ready', on: true });
    const st = await a.next('start');
    await b.next('start');
    const gaps: number[] = [], rtt: number[] = [];
    let lastAt = 0;
    const waited0 = runQueueMs();
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
      rejects: lobby.stats.rejects, cpuWaitMs: r1(runQueueMs() - waited0),
    };
    console.log('timing', JSON.stringify(report));
    expect(report.ticks).toBeGreaterThanOrEqual(120);
    expect(report.tickLateMs.p99).toBeLessThan(25);
    expect(report.commands).toBeGreaterThan(2);
    expect(report.arrivedLate).toBe(0);
  });
});
