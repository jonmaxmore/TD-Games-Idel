// Balance gates from docs/research/design-review.md §6 (B1, B2, B5, B7 + boss mechanics), measured with the
// deterministic sim and the greedy bot on fixed seeds. `npm run sim:measure` prints the full report.
import { describe, expect, it } from 'vitest';
import { COMBO_DMG_PCT, COMBOS, createGame, SECTS, step, type Command, type DefendState, type Element, type SimEvent } from '../src/index';
import { playBot } from './bot';

const play = (stageId: string, seed: number, opts: Parameters<typeof playBot>[1]) => playBot(createGame(stageId, seed) as DefendState, opts);
const SEEDS = [1, 2, 3, 4];

describe('B1 cost efficiency', () => {
  // Direct damage per second per 100 silver at level 1 (metal adds its 15% crit chance), plus DoT on one target.
  const dot: Partial<Record<Element, number>> = { wood: 10, fire: 6 };
  it.each(['metal', 'wood', 'water', 'fire', 'earth'] as Element[])('%s is within 30-55 dps per 100 silver', (el) => {
    const s = SECTS[el];
    const rate = 20 / s.cooldown;
    const direct = s.dmg * rate * (el === 'metal' ? 1.15 : 1);
    const per100 = ((direct + (dot[el] ?? 0)) * 100) / s.cost;
    expect(per100).toBeGreaterThanOrEqual(30);
    expect(per100).toBeLessThanOrEqual(55);
  });
});

describe('B2 no single sect solves the chapter finale', () => {
  it('1-12: a mixed build wins most seeds, metal alone does not', () => {
    const mixed = SEEDS.filter((seed) => play('1-12', seed, { maxDisciples: 8, earlyCall: true }).phase === 'won').length;
    const mono = SEEDS.filter((seed) => play('1-12', seed, { maxDisciples: 8, earlyCall: true, sects: ['metal'] }).phase === 'won').length;
    expect(mixed).toBeGreaterThanOrEqual(3);
    expect(mono).toBeLessThanOrEqual(1);
  }, 60_000);
});

describe('B5 pace', () => {
  it.each(['T-1', '1-12'])('%s (20 waves) takes at most 10 minutes for a player who calls waves early', (id) => {
    for (const seed of SEEDS.slice(0, 2)) {
      const s = play(id, seed, { maxDisciples: 8, earlyCall: true });
      expect(s.phase, `seed ${seed}`).toBe('won');
      expect(s.tick / 20 / 60, `seed ${seed}`).toBeLessThanOrEqual(10);
    }
  });
});

describe('B4 merging is worth it but not mandatory', () => {
  // DPS of the merged form (summed damage x comboDmgPct at the average cooldown) over the two disciples kept apart.
  it.each(COMBOS.map((c) => [c.id, c.from[0], c.from[1]] as const))('%s: merged/separate DPS in 1.1-1.3', (_id, a, b) => {
    const A = SECTS[a], B = SECTS[b];
    const separate = A.dmg / A.cooldown + B.dmg / B.cooldown;
    const merged = Math.floor(((A.dmg + B.dmg) * COMBO_DMG_PCT) / 100) / Math.floor((A.cooldown + B.cooldown) / 2);
    expect(merged / separate).toBeGreaterThanOrEqual(1.1);
    expect(merged / separate).toBeLessThanOrEqual(1.3);
  });
});

describe('B6 decision density', () => {
  it('a player who calls waves early makes at least 3 commands a minute', () => {
    for (const id of ['1-2', '1-12']) {
      const rec: Record<number, Command[]> = {};
      const s = play(id, 1, { maxDisciples: 8, earlyCall: true, record: rec });
      const perMin = Object.values(rec).flat().length / (s.tick / 20 / 60);
      expect(perMin, id).toBeGreaterThanOrEqual(3);
    }
  }, 60_000);
});

describe('B7 run-to-run variety', () => {
  it('different seeds give different wave shapes on at least half of the waves', () => {
    const shapes = (seed: number) => {
      const s = createGame('T-1', seed) as DefendState;
      const out: string[] = [];
      // Waves can be called back to back without fighting: the shape sequence depends only on the seed.
      while (s.wave < s.totalWaves) { step(s, [{ t: 'nextWave' }]); out.push(s.recipe); }
      return out;
    };
    const a = shapes(1), b = shapes(2);
    expect(new Set(a).size).toBeGreaterThanOrEqual(4);
    const differ = a.filter((r, i) => r !== b[i]).length;
    expect(differ / a.length).toBeGreaterThanOrEqual(0.5);
    for (let i = 1; i < a.length; i++) if (a[i] !== 'mixed') expect(a[i], `wave ${i + 1}`).not.toBe(a[i - 1]);
  });
});

describe('bosses', () => {
  // Jump straight to the boss wave with eight maxed disciples of the first unlocked sect, then play it out.
  const events = (stageId: string, bossWave: number) => {
    const s = createGame(stageId, 3) as DefendState;
    s.silver = 100000;
    const tiles: [number, number][] = [[4, 3], [6, 4], [3, 7], [5, 9], [7, 7], [3, 12], [7, 12], [5, 13]];
    step(s, tiles.map(([tx, ty]) => ({ t: 'place' as const, sect: s.unlocked[0]!, tx, ty })));
    for (let i = 0; i < 2; i++) step(s, s.disciples.map((d) => ({ t: 'upgrade' as const, id: d.id })));
    s.wave = bossWave - 1;
    const ev: SimEvent[] = [...step(s, [{ t: 'nextWave' }])];
    while (s.phase !== 'won' && s.phase !== 'lost' && s.wave === bossWave && s.tick < 20 * 60 * 20) ev.push(...step(s));
    return { s, ev };
  };
  it('1-10: the bandit king disables disciples at his HP thresholds', () => {
    const { ev } = events('1-10', 10);
    expect(ev.filter((e) => e.e === 'disable').length).toBeGreaterThanOrEqual(2);
  });
  it('1-12: the blood moon envoy seals the most-used sect', () => {
    const { ev } = events('1-12', 20);
    const seal = ev.find((e) => e.e === 'seal') as { el: Element } | undefined;
    expect(seal?.el).toBeDefined();
  });
});

describe('sect rosters (SPEC-core §4)', () => {
  const sects = ['fire', 'wood'] as Element[];
  it('S1/S2: each roster sect wins 1-12 on most seeds, and the two are within 1 seed of each other', () => {
    const wins = sects.map((sect) => SEEDS.filter((seed) => playBot(createGame('1-12', seed, sect) as DefendState, { maxDisciples: 8, earlyCall: true }).phase === 'won').length);
    for (const w of wins) expect(w).toBeGreaterThanOrEqual(3);
    expect(Math.abs(wins[0]! - wins[1]!)).toBeLessThanOrEqual(1);
  }, 120_000);
});
