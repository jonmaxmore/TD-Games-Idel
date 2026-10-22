import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createGame, ENEMIES, hashState, isOver, runReplay, SECTS, STAGES, step, upgradeCost, waveHp,
  type Command, type DefendState, type AssaultState, type Replay,
} from '../src/index';
import { overcomePct, isGenerated } from '../src/wuxing';
import { playBot } from './bot';

const defend = (id = 'T-1', seed = 1) => createGame(id, seed) as DefendState;
const run = (s: DefendState | AssaultState, ticks: number, cmds: Command[] = []) => {
  const ev = step(s, cmds);
  for (let i = 1; i < ticks; i++) ev.push(...step(s));
  return ev;
};

describe('wu xing', () => {
  it('overcoming x1.5, overcome-by x0.7, neutral x1', () => {
    expect(overcomePct(['metal'], 'wood')).toBe(150);
    expect(overcomePct(['metal'], 'fire')).toBe(70);
    expect(overcomePct(['metal'], 'water')).toBe(100);
    expect(overcomePct(['yinyang'], 'fire')).toBe(100);
  });
  it('a combo uses its best element', () => {
    expect(overcomePct(['metal', 'water'], 'fire')).toBe(150);
  });
  it('earth generates metal; metal does not generate earth', () => {
    expect(isGenerated(['metal'], [['earth']])).toBe(true);
    expect(isGenerated(['earth'], [['metal']])).toBe(false);
  });
});

describe('economy', () => {
  it('hp curve is integer and grows after wave 10', () => {
    expect(waveHp(60, 1)).toBe(70);
    expect(waveHp(100, 11)).toBeGreaterThan(Math.floor(100 * (1 + 0.18 * 11)));
  });
  it('place, upgrade and sell cost silver correctly', () => {
    const s = defend();
    const start = s.silver;
    run(s, 1, [{ t: 'place', sect: 'metal', tx: 4, ty: 4 }]);
    const d = s.disciples[0]!;
    expect(s.silver).toBe(start - SECTS.metal.cost);
    const up = upgradeCost(d);
    expect(up).toBe(Math.floor(SECTS.metal.cost * 1.5));
    run(s, 1, [{ t: 'upgrade', id: d.id }]);
    expect(d.level).toBe(2);
    const before = s.silver;
    run(s, 1, [{ t: 'sell', id: d.id }]);
    expect(s.silver).toBe(before + Math.floor(((SECTS.metal.cost + up) * 75) / 100));
  });
  it('cannot build on the path or on another disciple', () => {
    const s = defend();
    const ev = run(s, 1, [{ t: 'place', sect: 'metal', tx: 0, ty: 2 }, { t: 'place', sect: 'metal', tx: 4, ty: 4 }, { t: 'place', sect: 'earth', tx: 4, ty: 4 }]);
    expect(s.disciples).toHaveLength(1);
    expect(ev.filter((e) => e.e === 'error')).toHaveLength(2);
  });
  it('story stages only unlock sects reached so far', () => {
    expect(defend('1-1').unlocked).toEqual(['metal']);
    expect(defend('1-4').unlocked).toEqual(['metal', 'earth']);
    expect(defend('T-1').unlocked).toHaveLength(6);
  });
  it('pays capped interest after a wave', () => {
    const s = defend('1-1');
    s.silver = 1000;
    const ev = run(s, 2000, [{ t: 'nextWave' }]);
    const interest = ev.find((e) => e.e === 'interest');
    expect(interest).toEqual({ e: 'interest', amount: 25 });
  });
});

describe('combat', () => {
  it('generated disciple (+15%) out-damages a lone one', () => {
    const lone = defend(); const gen = defend();
    run(lone, 1, [{ t: 'place', sect: 'metal', tx: 3, ty: 3 }]);
    run(gen, 1, [{ t: 'place', sect: 'metal', tx: 3, ty: 3 }, { t: 'place', sect: 'earth', tx: 3, ty: 4 }]);
    const hit = (s: DefendState) => {
      const ev = run(s, 1500, [{ t: 'nextWave' }]);
      return ev.find((e) => e.e === 'hit' && e.from === s.disciples[0]!.id && !e.crit);
    };
    const a = hit(lone), b = hit(gen);
    expect(a && b && a.e === 'hit' && b.e === 'hit').toBe(true);
    if (a?.e === 'hit' && b?.e === 'hit') expect(b.dmg).toBeGreaterThan(a.dmg);
  });
  it('merging two max-level disciples of different elements makes the right combo', () => {
    const s = defend();
    s.silver = 10000;
    run(s, 1, [{ t: 'place', sect: 'metal', tx: 3, ty: 3 }, { t: 'place', sect: 'water', tx: 4, ty: 3 }]);
    const [a, b] = s.disciples;
    for (let i = 0; i < 2; i++) run(s, 1, [{ t: 'upgrade', id: a!.id }, { t: 'upgrade', id: b!.id }]);
    const ev = run(s, 1, [{ t: 'merge', a: a!.id, b: b!.id }]);
    expect(ev).toContainEqual(expect.objectContaining({ e: 'combo', combo: 'frozen_blade' }));
    expect(s.disciples).toHaveLength(1);
    expect(s.disciples[0]!.els).toEqual(['metal', 'water']);
  });
  it('merge is refused below max level or when not adjacent', () => {
    const s = defend();
    s.silver = 10000;
    run(s, 1, [{ t: 'place', sect: 'metal', tx: 3, ty: 3 }, { t: 'place', sect: 'water', tx: 6, ty: 3 }]);
    const [a, b] = s.disciples;
    const ev = run(s, 1, [{ t: 'merge', a: a!.id, b: b!.id }]);
    expect(ev.some((e) => e.e === 'error')).toBe(true);
    expect(s.disciples).toHaveLength(2);
  });
  it('a defended stage can be won and an undefended one is lost', () => {
    const empty = defend('1-1');
    run(empty, 20 * 60 * 10, [{ t: 'nextWave' }]);
    expect(empty.phase).toBe('lost');

    const guarded = playBot(defend('1-1'));
    expect(guarded.phase).toBe('won');
    expect(guarded.stars?.[0]).toBe(true);
  });
});

describe('assault 1-3', () => {
  it('waits at the fork until a route is chosen, then can be won with skills', () => {
    const s = createGame('1-3', 7) as AssaultState;
    run(s, 400);
    expect(s.phase).toBe('choosing');
    let guard = 0;
    step(s, [{ t: 'route', choice: 'left' }]);
    while (!isOver(s) && guard++ < 20 * 60 * 5) step(s, [0, 1, 2].map((member) => ({ t: 'skill', member })));
    expect(s.phase).toBe('won');
    expect(s.stars?.[0]).toBe(true);
  });
  it('a party that never chooses a route never wins', () => {
    const s = createGame('1-3', 7) as AssaultState;
    run(s, 20 * 60 * 3);
    expect(s.phase).not.toBe('won');
  });
});

describe('balance (greedy bot)', () => {
  it.each(['1-1', '1-2', '1-4', 'T-1'])('stage %s is winnable', (id) => {
    expect(playBot(defend(id), { maxDisciples: 6 }).phase).toBe('won');
  });
});

describe('determinism', () => {
  const replay: Replay = {
    stageId: '1-4',
    seed: 42,
    commands: {
      0: [{ t: 'place', sect: 'metal', tx: 3, ty: 2 }, { t: 'place', sect: 'earth', tx: 3, ty: 3 }, { t: 'nextWave' }],
      200: [{ t: 'place', sect: 'metal', tx: 6, ty: 5 }],
      600: [{ t: 'upgrade', id: 1 }],
      900: [{ t: 'place', sect: 'earth', tx: 7, ty: 10 }],
    },
  };
  const trace = (r: Replay) => {
    const hashes: string[] = [];
    const end = runReplay(r, 20 * 60 * 20, (s) => { if (s.tick % 100 === 0) hashes.push(hashState(s)); });
    return { hashes, end: hashState(end), phase: end.phase };
  };
  it('same seed + commands => identical hash every 100 ticks', () => {
    const a = trace(replay), b = trace(replay);
    expect(a.hashes.length).toBeGreaterThan(10);
    expect(b).toEqual(a);
  });
  it('a different seed diverges', () => {
    expect(trace({ ...replay, seed: 43 }).end).not.toBe(trace(replay).end);
  });
});

describe('data integrity', () => {
  it('stages 1-1..1-4 and T-1 reference existing enemies and layouts', () => {
    for (const id of ['T-1', '1-1', '1-2', '1-3', '1-4']) {
      const st = STAGES[id]!;
      expect(st.layout, id).toBeTruthy();
      for (const e of st.enemies) expect(ENEMIES[e], `${id}:${e}`).toBeTruthy();
    }
  });
  it('sim source has no non-deterministic APIs', () => {
    const dir = fileURLToPath(new URL('../src', import.meta.url));
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/Math\.random|Date\.|performance\.|window\.|document\./);
    }
  });
});
