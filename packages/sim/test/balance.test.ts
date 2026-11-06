// Balance gates from docs/research/design-review.md §6 (B1, B2, B4-B7 + boss mechanics) and SPEC-core §4 (story curve
// for the roster sects), measured with the deterministic rules and the greedy bot on fixed seeds. The story is played
// with a roster sect (sect pick offers only those); the element-mixing build lives on the training ground T-1.
// npm run sim:measure prints the full table these gates were tuned from.
import { beforeEach, describe, expect, it } from 'vitest';
import { comboDmgPct, combos, createDefend, isOver, sects, stepDefend, type Command, type SimEvent } from '../src';
import { bestTiles, playStage } from './bot';
import { NEXT, place, up } from './helpers';

const SEEDS = [1, 2, 3, 4];
const minutes = (tick: number) => tick / 20 / 60;

describe('balance', () => {
  // These tests run synchronously for many seconds; let the worker's message queue drain between them or vitest's RPC times out.
  beforeEach(() => new Promise((r) => setTimeout(r)));

  // Direct damage per second per 100 silver at level 1 (metal adds its 15% crit chance), plus DoT on one target.
  it('B1 cost efficiency is within 30-55 dps per 100 silver', () => {
    const dot: Record<string, number> = { wood: 10, fire: 6 };
    for (const el of ['metal', 'wood', 'water', 'fire', 'earth']) {
      const s = sects.get(el)!;
      const direct = s.dmg * (20 / s.cooldown) * (el === 'metal' ? 1.15 : 1);
      const per100 = ((direct + (dot[el] ?? 0)) * 100) / s.cost;
      expect(per100, el).toBeGreaterThanOrEqual(30);
      expect(per100, el).toBeLessThanOrEqual(55);
    }
  });

  // The training ground (all six element sects): mixing wins, any single element alone does not.
  it('B2 on the training ground no single element wins', () => {
    expect(SEEDS.filter((seed) => playStage('T-1', seed, null, { earlyCall: true }).phase === 'won').length).toBeGreaterThanOrEqual(4);
    for (const el of ['metal', 'water', 'earth'])
      expect(SEEDS.filter((seed) => playStage('T-1', seed, null, { earlyCall: true, sects: [el] }).phase === 'won').length, `${el} alone`).toBeLessThanOrEqual(1);
  });

  it('B4 merging is worth it but not mandatory', () => {
    for (const c of combos) {
      const A = sects.get(c.a)!, B = sects.get(c.b)!;
      const separate = A.dmg / A.cooldown + B.dmg / B.cooldown;
      const merged = Math.floor(((A.dmg + B.dmg) * comboDmgPct) / 100) / Math.floor((A.cooldown + B.cooldown) / 2);
      expect(merged / separate, c.id).toBeGreaterThanOrEqual(1.1);
      expect(merged / separate, c.id).toBeLessThanOrEqual(1.3);
    }
  });

  it('B5 twenty-wave stages take at most 10 minutes when calling early', () => {
    for (const seed of SEEDS.slice(0, 2)) {
      const s = playStage('T-1', seed, null, { earlyCall: true });
      expect(s.phase, `T-1 seed ${seed}`).toBe('won');
      expect(minutes(s.tick)).toBeLessThanOrEqual(10);
    }
    for (const sect of ['fire', 'wood'])
      for (const seed of SEEDS) {
        const s = playStage('1-12', seed, sect, { earlyCall: true });
        if (s.phase === 'won') expect(minutes(s.tick), `1-12 ${sect} seed ${seed}`).toBeLessThanOrEqual(10);
      }
  });

  it('B6 at least 3 commands a minute', () => {
    for (const id of ['1-2', '1-12']) {
      const rec: Record<number, Command[]> = {};
      const s = playStage(id, 1, null, { earlyCall: true, record: rec });
      expect(Object.values(rec).reduce((a, v) => a + v.length, 0) / minutes(s.tick), id).toBeGreaterThanOrEqual(3);
    }
  });

  it('B7 seeds change wave shapes', () => {
    // Waves can be called back to back without fighting: the shape sequence depends only on the seed.
    const shapes = (seed: number) => {
      const s = createDefend('T-1', seed);
      const o: string[] = [];
      while (s.wave < s.totalWaves) { stepDefend(s, [NEXT]); o.push(s.recipe); }
      return o;
    };
    const a = shapes(1), b = shapes(2);
    expect(new Set(a).size).toBeGreaterThanOrEqual(4);
    expect(a.filter((r, i) => r !== b[i]).length / a.length).toBeGreaterThanOrEqual(0.5);
    for (let i = 1; i < a.length; i++) if (a[i] !== 'mixed') expect(a[i], `wave ${i + 1} repeats`).not.toBe(a[i - 1]);
  });

  // Jump straight to the boss wave with eight maxed disciples (rotating through what is unlocked), then play it out.
  const bossWave = (stageId: string, wave: number, sect: string | null = null): SimEvent[] => {
    const s = createDefend(stageId, 3, sect);
    s.silver = 100000;
    s.lives = 1000; // the test is about the boss mechanic, not about holding the wave
    const tiles = bestTiles(s).slice(0, 8); // the eight buildable tiles that cover the most path
    stepDefend(s, tiles.map(({ tx, ty }, i) => place(s.unlocked[i % s.unlocked.length]!, tx, ty)));
    for (let i = 0; i < 2; i++) stepDefend(s, s.disciples.map((d) => up(d.id)));
    s.wave = wave - 1;
    const ev = stepDefend(s, [NEXT]);
    while (!isOver(s) && s.wave === wave && s.tick < 20 * 60 * 20) ev.push(...stepDefend(s, []));
    return ev;
  };
  it('boss: the bandit king disables disciples at hp thresholds', () => expect(bossWave('1-10', 10).filter((e) => e.e === 'disable').length).toBeGreaterThanOrEqual(2));
  it('boss: the envoy seals the most used sect', () => expect(bossWave('1-12', 20, 'fire').some((e) => e.e === 'seal' && e.el != null)).toBe(true));

  // Story curve for the player's path (roster sects, a bot that reads the next-wave bar and does not call early):
  // the tutorial is safe, mid-chapter stages are won almost always, the finale is a real test that costs lives,
  // and the two sects end within 15 points of each other (SPEC-core §4 S1/S2).
  const storySeeds = Array.from({ length: 24 }, (_, i) => i + 1);
  const rate = (stage: string, sect: string) => {
    const runs = storySeeds.map((seed) => playStage(stage, seed, sect));
    return { win: runs.filter((r) => r.phase === 'won').length / runs.length, lost: runs.reduce((a, r) => a + r.livesLost, 0) / runs.length };
  };
  const finale: Record<string, number> = {};
  for (const sect of ['fire', 'wood']) {
    it(`story ${sect} 1-1 always wins`, () => expect(rate('1-1', sect).win).toBe(1));
    for (const st of ['1-2', '1-4', '1-6']) it(`story ${sect} ${st} wins at least 85%`, () => expect(rate(st, sect).win).toBeGreaterThanOrEqual(0.85));
    it(`story ${sect} 1-12 is a real finale`, () => {
      const { win, lost } = rate('1-12', sect);
      expect(win, 'win rate').toBeGreaterThanOrEqual(0.55);
      expect(win, 'win rate').toBeLessThanOrEqual(0.9);
      expect(lost, 'lives lost').toBeGreaterThanOrEqual(1);
      finale[sect] = win;
    });
  }
  it('story fire and wood finales are within 15 points', () => expect(Math.abs(finale.fire! - finale.wood!)).toBeLessThanOrEqual(0.15));
});
