// Chapter 1 stages that differ only by stage data (SPEC-pc-v2 §4): 1-9 two-lane siege, 1-10 boss duel.
import { describe, expect, it } from 'vitest';
import { canBuild, enemies as enemyDefs, grid, isOver, layouts, openPath, stepDefend, tilesOnPath, waveEntries, type DefendState } from '../src';
import { defend, run } from './helpers';

const enemyOn = (s: DefendState, type: string, path: number) => {
  s.spawnQueue.push({ type, wave: 1, hpPct: 100, path });
  s.phase = 'spawning'; s.spawnT = 0;
  stepDefend(s, []);
  return s.enemies.at(-1)!;
};

describe('1-9 two-lane siege', () => {
  it('two lanes meet only at the gate, and some tile reaches both', () => {
    const [a, b] = layouts.get('village-siege')!.paths.map((p) => tilesOnPath(p));
    expect([...a!].filter((k) => b!.has(k))).toEqual(['21,6']);
    const s = defend('1-9', 1, 'fire');
    const near = (lane: Set<string>, tx: number, ty: number) => [...lane].some((k) => { const [x, y] = k.split(',').map(Number); return (x! - tx) ** 2 + (y! - ty) ** 2 <= 6.25; });
    let both = 0;
    for (let ty = 0; ty < grid.h; ty++) for (let tx = 0; tx < grid.w; tx++) if (canBuild(s, tx, ty) && near(a!, tx, ty) && near(b!, tx, ty)) both++;
    expect(both, 'tiles within 2.5 of both lanes').toBeGreaterThan(0);
  });

  it('waves split across both lanes; the last wave comes down lane 2 only, warned by openPath', () => {
    for (let w = 1; w < 12; w++) {
      const lanes = waveEntries('1-9', w, 'mixed').map((q) => q.path);
      expect(openPath('1-9', w), `wave ${w}`).toBeNull();
      expect(Math.abs(lanes.filter((p) => p === 0).length - lanes.filter((p) => p === 1).length), `wave ${w} halves`).toBeLessThanOrEqual(1);
    }
    expect(openPath('1-9', 12)).toBe(1);
    expect(new Set(waveEntries('1-9', 12, 'mixed').map((q) => q.path))).toEqual(new Set([1]));
  });

  it('both lanes pay into one silver pool and leak from one pool of lives', () => {
    const s = defend('1-9', 1, 'fire');
    s.wave = 1;
    const top = enemyOn(s, 'cultist', 0), bottom = enemyOn(s, 'cultist', 1);
    const silver = s.silver;
    top.hp = 0; bottom.hp = 0;
    const kills = run(s, 1).filter((e) => e.e === 'kill');
    expect(kills.length).toBe(2);
    expect(s.silver).toBe(silver + top.bounty + bottom.bounty);

    const lives = s.lives;
    const t = enemyOn(s, 'cultist', 0), b = enemyOn(s, 'cultist', 1);
    t.d = s.pathLens[0]!; b.d = s.pathLens[1]!;
    expect(run(s, 1).filter((e) => e.e === 'leak').length).toBe(2);
    expect(s.lives).toBe(lives - 2 * enemyDefs.get('cultist')!.leakCost);
  });
});

describe('1-10 boss duel', () => {
  it('the bandit king comes with wave 1', () => {
    expect(waveEntries('1-10', 1, 'mixed').map((q) => q.type)).toContain('boss_ch1');
    expect(waveEntries('1-10', 2, 'mixed').map((q) => q.type)).not.toContain('boss_ch1');
  });

  it('minion waves keep coming while the boss lives', () => {
    const s = defend('1-10', 1, 'fire');
    s.lives = 1000;
    run(s, 1, { t: 'nextWave' });
    while (s.wave === 1) {
      stepDefend(s, []);
      for (const e of s.enemies) if (e.type !== 'boss_ch1') e.hp = 0; // only the boss stays on the field
    }
    expect(s.wave).toBe(2);
    expect(s.enemies.some((e) => e.type === 'boss_ch1')).toBe(true);
    expect(isOver(s)).toBe(false);
  });

  it('killing the boss wins at once, with waves still to come', () => {
    const s = defend('1-10', 1, 'fire');
    const boss = enemyOn(s, 'boss_ch1', 0);
    boss.hp = 0;
    const end = run(s, 1).find((e) => e.e === 'end');
    expect(end?.won).toBe(true);
    expect(s.wave).toBeLessThan(s.totalWaves);
  });

  it('the boss reaching the temple loses the duel, whatever lives are left', () => {
    const s = defend('1-10', 1, 'fire');
    s.lives = 1000;
    const boss = enemyOn(s, 'boss_ch1', 0);
    boss.d = s.pathLens[0]!;
    const end = run(s, 1).find((e) => e.e === 'end');
    expect(end?.won).toBe(false);
    expect(s.lives).toBe(0);
  });
});
