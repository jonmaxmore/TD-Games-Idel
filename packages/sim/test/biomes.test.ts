// Biome rules (SPEC-pc-v2 §3): rooftops, fog, ice, city gates and the blood moon, each played on a stage that uses it.
import { describe, expect, it } from 'vitest';
import { canBuild, discipleStats, moonElement, openPath, stepDefend, TILE, units, waveEntries, type DefendState, type SimEvent } from '../src';
import { defend, place, run } from './helpers';

// Queue one enemy on a path and let it walk; returns the events until it leaks or maxTicks pass.
function walk(s: DefendState, type: string, path = 0, wave = 1, maxTicks = 2000) {
  s.spawnQueue.push({ type, wave, hpPct: 100, path });
  s.phase = 'spawning'; s.spawnT = 0; s.wave = wave;
  const ev: SimEvent[] = [];
  let t = 0;
  for (; t < maxTicks && !ev.some((e) => e.e === 'leak'); t++) ev.push(...stepDefend(s, []));
  return { ev, ticks: t };
}

const unitOf = (sect: string, role: string) => [...units.values()].find((u) => u.sect === sect && u.roleId === role)!;

describe('biome rules', () => {
  it('rooftops: a disciple on a roof reaches roofRangePct further', () => {
    const s = defend('1-6', 1, 'fire');
    const u = unitOf('fire', 'striker');
    run(s, 1, place(u.id, 7, 4), place(u.id, 5, 5)); // (7,4) is a roof, (5,5) plain ground
    const [roof, ground] = s.disciples.map((d) => discipleStats(s, d).range);
    expect(ground).toBe(u.range);
    expect(roof).toBe(Math.floor((u.range * (100 + s.rule.roofRangePct)) / 100));
    expect(s.rule.roofRangePct).toBeGreaterThan(0);
  });

  it('rooftops: a leaper jumps ahead at each roof line and reaches the gate sooner', () => {
    const a = defend('1-6', 1, 'fire');
    const leaps = walk(a, 'leaper');
    const b = defend('1-6', 1, 'fire');
    b.rule.leap = 0;
    const plain = walk(b, 'leaper');
    expect(leaps.ev.filter((e) => e.e === 'leap').length).toBeGreaterThanOrEqual(2);
    expect(plain.ev.some((e) => e.e === 'leap')).toBe(false);
    expect(leaps.ticks).toBeLessThan(plain.ticks);
    // only leapers leap
    expect(walk(defend('1-6', 1, 'fire'), 'cultist').ev.some((e) => e.e === 'leap')).toBe(false);
  });

  it('fog: only wood disciples shoot past fogSightTiles', () => {
    const s = defend('2-1', 1, 'fire');
    const w = defend('2-1', 1, 'wood');
    const fire = unitOf('fire', 'striker'), wood = unitOf('wood', 'striker');
    expect(s.rule.fogSight).toBeGreaterThan(0);
    expect(fire.range).toBeGreaterThan(s.rule.fogSight);
    run(s, 1, place(fire.id, 3, 1)); // bamboo-stream: (3,1) is beside column x=1 and row y=2
    run(w, 1, place(wood.id, 3, 1));
    expect(discipleStats(s, s.disciples[0]!).range).toBe(s.rule.fogSight);
    expect(discipleStats(w, w.disciples[0]!).range).toBe(wood.range);
    // A stunned enemy held 2.8 tiles away (past the fog, inside the wood striker's 3.2) is hit by wood only.
    for (const g of [s, w]) {
      walk(g, 'cultist', 0, 1, 1);
      const e = g.enemies[0]!;
      e.stunT = 1000;
      e.x = 3 * TILE + TILE / 2; e.y = 1 * TILE + TILE / 2 + 2800;
    }
    const hits = (g: DefendState) => run(g, 60).filter((e) => e.e === 'hit').length;
    expect(hits(s)).toBe(0);
    expect(hits(w)).toBeGreaterThan(0);
  });

  it('ice: enemies slide faster on ice, and a burning one melts it for good', () => {
    const s = defend('3-1', 1, 'fire');
    expect(s.ice.has('1,5')).toBe(true); // ice-lake starts (0,5) -> (4,5) over ice
    walk(s, 'brute', 0, 1, 1);
    const e = s.enemies[0]!;
    e.d = 1500; // tile (1,5)
    run(s, 1);
    const d0 = e.d;
    run(s, 1);
    expect(e.d - d0).toBe(Math.floor((e.speed * (100 + s.rule.iceSpeedPct)) / 100));
    e.burnT = 100; e.burnDps = 1;
    const ev = run(s, 1);
    expect(ev.some((x) => x.e === 'melt')).toBe(true);
    expect(s.ice.has(`${Math.floor(e.x / TILE)},${Math.floor(e.y / TILE)}`)).toBe(false);
    e.burnT = 0; e.d = 1500; run(s, 1); // back on the melted tile: normal speed
    const d1 = e.d;
    run(s, 1);
    expect(e.d - d1).toBe(e.speed);
  });

  it('city gates: one road open at a time, switching every gateEveryWaves, known a wave ahead', () => {
    const s = defend('4-2', 1, 'fire');
    const every = s.rule.gateEveryWaves;
    expect(every).toBeGreaterThan(0);
    expect(s.paths.length).toBe(2);
    for (let w = 1; w <= 2 * every + 1; w++) {
      const road = openPath('4-2', w);
      expect(road, `wave ${w}`).toBe(Math.floor((w - 1) / every) % 2);
      expect(new Set(waveEntries('4-2', w, 'mixed').map((q) => q.path)), `wave ${w}`).toEqual(new Set([road]));
    }
    // a two-gate stage without the rule keeps both roads busy
    expect(openPath('1-4', 1)).toBeNull();
  });

  it('blood moon: every moonEveryWaves waves enemy elements step round the cycle', () => {
    expect(moonElement('wood', 1)).toBe('fire');
    expect(moonElement('earth', 2)).toBe('water'); // earth -> metal -> water
    expect(moonElement('yinyang', 3)).toBe('yinyang');
    const every = defend('5-3').rule.moonEveryWaves;
    expect(every).toBeGreaterThan(0);
    const el = (wave: number, stage = '5-3') => { const g = defend(stage, 1, 'fire'); walk(g, 'brute', 0, wave, 1); return g.enemies[0]!.el; };
    expect(el(1)).toBe('metal');
    expect(el(every)).toBe('metal');
    expect(el(every + 1)).toBe('water');
    expect(el(every + 1, '1-12')).toBe('metal'); // no moon outside its biome
    // and the Wu Xing match follows: fire is overcome by the moon-turned water brute
    const g = defend('5-3', 1, 'fire');
    const u = unitOf('fire', 'burst');
    walk(g, 'brute', 0, every + 1, 1);
    const e = g.enemies[0]!;
    e.stunT = 1000;
    const [ex, ey] = [Math.floor(e.x / TILE), Math.floor(e.y / TILE)];
    const spot = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]].find(([dx, dy]) => canBuild(g, ex + dx!, ey + dy!))!;
    run(g, 1, place(u.id, ex + spot[0]!, ey + spot[1]!));
    const hit = run(g, 40).find((x) => x.e === 'hit');
    expect(hit?.pct).toBe(85);
  });
});
