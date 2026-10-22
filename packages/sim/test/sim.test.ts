import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalString, COMBOS, createGame, ENEMIES, fnv1a, hashState, previewWave, isOver, runReplay, SECTS, STAGES, step, upgradeCost, waveHp,
  type Command, type DefendState, type Element, type SimEvent, type AssaultState, type Replay,
} from '../src/index';
import { overcomePct, isGenerated } from '../src/wuxing';
import { playBot } from './bot';
import { COMBO_EFFECTS } from '../src/defend';

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
    expect(defend('1-4').unlocked).toEqual(['metal', 'earth', 'fire']); // fire is a guest sect for 1-4 only
    expect(defend('1-2').unlocked).toEqual(['metal', 'water']);
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

describe('combos and timers', () => {
  const maxedPair = (a: Element, b: Element) => {
    const s = defend();
    s.silver = 100000;
    run(s, 1, [{ t: 'place', sect: a, tx: 3, ty: 3 }, { t: 'place', sect: b, tx: 4, ty: 3 }]);
    const [x, y] = s.disciples;
    for (let i = 0; i < 2; i++) run(s, 1, [{ t: 'upgrade', id: x!.id }, { t: 'upgrade', id: y!.id }]);
    run(s, 1, [{ t: 'merge', a: x!.id, b: y!.id }]);
    return s;
  };
  it('every combo technique in the data has a signature effect', () => {
    expect([...COMBO_EFFECTS].sort()).toEqual(COMBOS.map((c) => c.id).sort());
  });
  it('root_quake keeps its bell/quake stun while its root timer runs (separate timers)', () => {
    const s = maxedPair('wood', 'earth');
    expect(s.disciples[0]!.combo).toBe('root_quake');
    const ev = run(s, 2500, [{ t: 'nextWave' }]);
    expect(ev.filter((e) => e.e === 'stun' && e.by === s.disciples[0]!.id).length).toBeGreaterThan(3);
  });
  it('molten_edge ignores brute armor', () => {
    const s = maxedPair('metal', 'fire');
    run(s, 2, [{ t: 'nextWave' }]);
    const e = s.enemies[0]!;
    Object.assign(e, { id: 999, type: 'brute', el: 'earth', hp: 100000, maxHp: 100000, d: 3000, x: 3500, y: 2500, stunT: 1000 });
    const hits = run(s, 60).filter((x) => x.e === 'hit' && x.to === 999 && !x.crit);
    const expected = Math.floor((Math.floor((SECTS.metal.dmg + SECTS.fire.dmg) * 2.5) * 100) / 100);
    expect(hits[0]).toMatchObject({ dmg: expected });
  });
  it('yin-yang level 3 adds +1% interest', () => {
    const s = defend();
    s.silver = 100000;
    run(s, 1, [{ t: 'place', sect: 'yinyang', tx: 10, ty: 0 }]);
    for (let i = 0; i < 2; i++) run(s, 1, [{ t: 'upgrade', id: s.disciples[0]!.id }]);
    s.silver = 400;
    const ev = run(s, 2000, [{ t: 'nextWave' }]);
    expect(ev.find((e) => e.e === 'interest')).toMatchObject({ amount: 24 });
  });
});

describe('secret arts and cards', () => {
  it('heaven sword hits the lead enemy area, then goes on cooldown', () => {
    const s = defend('1-1');
    run(s, 60, [{ t: 'nextWave' }]);
    const before = s.enemies.reduce((sum, e) => sum + e.hp, 0);
    const ev = run(s, 1, [{ t: 'cast', art: 'heaven_sword' }]);
    expect(ev).toContainEqual(expect.objectContaining({ e: 'art', art: 'heaven_sword' }));
    expect(s.enemies.reduce((sum, e) => sum + e.hp, 0)).toBeLessThan(before);
    const again = run(s, 1, [{ t: 'cast', art: 'heaven_sword' }]);
    expect(again).toContainEqual({ e: 'error', msg: 'art on cooldown' });
  });
  it('lion roar stuns everything and reveals stealth', () => {
    const s = defend();
    run(s, 200, [{ t: 'nextWave' }]);
    run(s, 1, [{ t: 'cast', art: 'lion_roar' }]);
    expect(s.enemies.every((e) => e.stunT > 0)).toBe(true);
    expect(s.revealAllT).toBeGreaterThan(0);
  });
  it('offers 3 cards after wave 5, auto-picks when idle, and the pick changes the rules', () => {
    const s = defend('1-1');
    s.silver = 10000;
    run(s, 1, [[3, 3], [5, 3], [7, 3], [3, 6], [5, 8], [7, 8]].map(([tx, ty]) => ({ t: 'place' as const, sect: 'metal' as const, tx: tx!, ty: ty! })));
    let ev: SimEvent[] = [];
    while (s.phase !== 'picking' && !isOver(s)) ev = step(s, s.phase === 'build' || s.phase === 'break' ? [{ t: 'nextWave' }] : []);
    expect(s.wave).toBe(5);
    expect(s.offer).toHaveLength(3);
    expect(new Set(s.offer).size).toBe(3);
    expect(s.offer!.every((id) => !['overheat', 'deep_freeze', 'mountain_root'].includes(id))).toBe(true); // needs locked sects
    const first = s.offer![0]!;
    ev = run(s, 20 * 16);
    expect(ev).toContainEqual({ e: 'picked', card: first });
    expect(s.cards).toEqual([first]);
  });
  it('bounty board adds silver per kill', () => {
    const a = defend('1-1'), b = defend('1-1');
    b.cards.push('bounty_board');
    for (const s of [a, b]) run(s, 1, [{ t: 'place', sect: 'metal', tx: 3, ty: 3 }, { t: 'nextWave' }]);
    const kill = (s: DefendState) => run(s, 900).find((e) => e.e === 'kill');
    const ka = kill(a), kb = kill(b);
    if (ka?.e === 'kill' && kb?.e === 'kill') expect(kb.bounty).toBe(ka.bounty + 1);
    else throw new Error('no kill');
  });
});

describe('variety', () => {
  it('target modes pick different enemies', () => {
    const base = defend('1-1');
    run(base, 1, [{ t: 'place', sect: 'metal', tx: 4, ty: 3 }, { t: 'nextWave' }]);
    run(base, 60);
    // Three stunned enemies in range: lead (d high, mid hp), strong (most hp), weak+close.
    const [a, b, c] = base.enemies;
    Object.assign(a!, { d: 6000, x: 6500, y: 2500, hp: 50, stunT: 999 });
    Object.assign(b!, { d: 5000, x: 5500, y: 2500, hp: 90, stunT: 999 });
    Object.assign(c!, { d: 4000, x: 4500, y: 2500, hp: 20, stunT: 999 });
    const pick = (mode: 'first' | 'strong' | 'weak' | 'close') => {
      const s = structuredClone(base);
      s.disciples[0]!.cd = 0;
      const ev = run(s, 1, [{ t: 'target', id: s.disciples[0]!.id, mode }]);
      const hit = ev.find((e) => e.e === 'hit');
      return hit?.e === 'hit' ? hit.to : -1;
    };
    expect(pick('first')).toBe(a!.id);
    expect(pick('strong')).toBe(b!.id);
    expect(pick('weak')).toBe(c!.id);
    expect(pick('close')).toBe(c!.id);
  });
  it('previewWave matches what the next wave spawns', () => {
    const s = defend('1-4');
    const preview = previewWave(s);
    const ev = run(s, 400, [{ t: 'nextWave' }]);
    const spawned = ev.filter((e) => e.e === 'spawn').length;
    expect(preview.reduce((n, [, c]) => n + c, 0)).toBe(spawned);
  });
  it('elites appear from wave 5 with an affix and give double bounty', () => {
    const s = defend('T-1');
    s.wave = 7;
    let elites = 0;
    for (let i = 0; i < 200; i++) step(s, []); // build phase auto-start not reached; spawn directly
    for (let w = 0; w < 3; w++) { s.phase = 'build'; run(s, 300, [{ t: 'nextWave' }]); }
    elites = s.enemies.filter((e) => e.elite).length;
    expect(elites).toBeGreaterThan(0);
    const e = s.enemies.find((x) => x.elite)!;
    expect(['golden', 'swift', 'undying']).toContain(e.elite);
  });
});

describe('command validation', () => {
  it('rejects non-integer tiles, unknown sects and bad route choices', () => {
    const s = defend('1-1');
    const ev = run(s, 1, [
      { t: 'place', sect: 'metal', tx: 0.5, ty: 2 }, { t: 'place', sect: 'metal', tx: Number.NaN, ty: 3 },
      { t: 'place', sect: 'dragon' as never, tx: 4, ty: 4 },
    ]);
    expect(s.disciples).toHaveLength(0);
    expect(ev.filter((e) => e.e === 'error')).toHaveLength(3);
    const a = createGame('1-3', 1) as AssaultState;
    run(a, 1, [{ t: 'route', choice: 'up' as never }]);
    expect(a.route).toBeNull();
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
  it('survivors close ranks and keep going when the leader falls', () => {
    const s = createGame('1-3', 7) as AssaultState;
    let guard = 0;
    while (!isOver(s) && guard++ < 20 * 60 * 5) {
      if (s.tick === 30) s.members[0]!.hp = 1;
      step(s, s.phase === 'choosing' ? [{ t: 'route', choice: 'right' }] : []);
    }
    expect(s.members[0]!.hp).toBeLessThanOrEqual(0);
    expect(isOver(s)).toBe(true);
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

describe('canonical hash (engine-port parity)', () => {
  it('is stable across identical runs and matches the golden generator', async () => {
    const { golden } = await import('../scripts/golden');
    const a = golden('1-1', 42), b = golden('1-1', 42);
    expect(a.trace.length).toBeGreaterThan(10);
    expect(b).toEqual(a);
    expect(a.final.phase).toBe('won');
  });
  it('committed Unity goldens and synced data are up to date (run npm run sim:golden / unity:sync)', async () => {
    const { GOLDENS } = await import('../scripts/golden');
    const unity = fileURLToPath(new URL('../../../prototypes/unity/Assets/', import.meta.url));
    for (const [name, make] of Object.entries(GOLDENS)) {
      const committed = JSON.parse(readFileSync(join(unity, 'Editor/Tests', `golden-${name}.json`), 'utf8'));
      expect(committed, name).toEqual(JSON.parse(JSON.stringify(make())));
    }
    const data = fileURLToPath(new URL('../../../docs/data/', import.meta.url));
    for (const f of readdirSync(data).filter((x) => x.endsWith('.json')))
      expect(readFileSync(join(unity, 'Resources/data', f), 'utf8'), f).toBe(readFileSync(join(data, f), 'utf8'));
  });
  it('the actions golden exercises merge, arts, targets, sell and picks', async () => {
    const { goldenActions } = await import('../scripts/golden');
    const all = Object.values(goldenActions().commands).flat().map((c) => c.t);
    for (const t of ['merge', 'cast', 'target', 'sell', 'pick', 'upgrade', 'place']) expect(all, t).toContain(t);
  });
  it('uses a fixed layout other engines can reproduce', () => {
    const s = defend('1-1');
    expect(canonicalString(s)).toBe('0|120|20|0|build|1|||');
    expect(fnv1a('abc')).toBe('1a47e90b');
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
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/Math\.random|\bDate\b|\bperformance\b|\bwindow\.|\bdocument\.|for\s*\([^)]*\bin\b/);
    }
  });
});
