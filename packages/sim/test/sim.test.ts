// Core rules: Wu Xing, economy, combat, combos, secret arts and cards, variety, command validation, determinism,
// the canonical hash, maps and data integrity.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  biomes, canonicalHash, canonicalString, comboDmgPct, combos, costPct, createDefend, economy, fnv1a, grid, isGenerated, isOver, layouts,
  propBlocks, propOnPath, resolveLayout, sects, stageList, stages, statPct, stepDefend, tilesOnPath, upgradeCost, waveEntries, waveHp, wuxingPct,
  enemies as enemyDefs, type Command, type DefendState, type SimEvent,
} from '../src';
import { play } from './bot';
import { replay } from './goldens';
import { defend, interestAtClear, NEXT, place, run, up } from './helpers';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const sect = (el: string) => sects.get(el)!;
const fl = Math.floor;

describe('wu xing', () => {
  // SPEC-core §7: x1.2 against the element it overcomes, x0.85 against the one that overcomes it (from sects.json).
  it('overcoming and overcome-by', () => {
    expect(wuxingPct(['metal'], 'wood')).toBe(120);
    expect(wuxingPct(['metal'], 'fire')).toBe(85);
    expect(wuxingPct(['metal'], 'water')).toBe(100);
    expect(wuxingPct(['yinyang'], 'fire')).toBe(100);
  });
  it('a combo uses its best element', () => expect(wuxingPct(['metal', 'water'], 'fire')).toBe(120));
  it('earth generates metal, not the other way', () => {
    expect(isGenerated(['metal'], [['earth']])).toBe(true);
    expect(isGenerated(['earth'], [['metal']])).toBe(false);
  });
});

describe('economy', () => {
  it('hp curve is integer and grows after wave 10', () => {
    expect(waveHp(60, 1)).toBe(70);
    expect(waveHp(100, 11)).toBeGreaterThanOrEqual(fl(100 * (1 + 0.18 * 11)) + 1);
  });

  it('place, upgrade and sell cost silver', () => {
    const s = defend();
    const start = s.silver;
    run(s, 1, place('metal', 4, 4));
    const d = s.disciples[0]!;
    expect(s.silver).toBe(start - sect('metal').cost);
    const u = upgradeCost(d);
    expect(u).toBe(fl((sect('metal').cost * costPct[1]!) / 100));
    run(s, 1, up(d.id));
    expect(d.level).toBe(2);
    const before = s.silver;
    run(s, 1, { t: 'sell', id: d.id });
    expect(s.silver).toBe(before + fl(((sect('metal').cost + u) * economy.sellRefundPct) / 100));
  });

  it('cannot build on the path or on a disciple', () => {
    const s = defend();
    const { x, y } = s.layout.paths[0]![0]!;
    const ev = run(s, 1, place('metal', x, y), place('metal', 4, 4), place('earth', 4, 4));
    expect(s.disciples.length).toBe(1);
    expect(ev.filter((e) => e.e === 'error').length).toBe(2);
  });

  it('story stages only unlock sects reached so far', () => {
    expect(defend('1-1').unlocked).toEqual(['metal']);
    expect(defend('1-4').unlocked).toEqual(['metal', 'earth', 'fire']); // fire is a guest sect
    expect(defend('1-2').unlocked).toEqual(['metal', 'water']);
    expect(defend('T-1').unlocked.length).toBe(6);
  });

  it('interest is paid when the field is clear, and capped', () => {
    const s = defend('1-1');
    expect(run(s, 1, NEXT).some((e) => e.e === 'interest')).toBe(false);
    s.silver = 1000; s.wave = 1;
    expect(interestAtClear(s)).toBe(economy.interestCap + economy.interestCapPerWave);
    s.phase = 'spawning'; s.wave = 5; s.silver = 100;
    expect(interestAtClear(s)).toBe(fl((100 * economy.interestPct) / 100));
  });

  it('an early call overlaps waves and pays a share of the bounty at stake', () => {
    const s = defend('1-1');
    run(s, 1, place('metal', 4, 3), NEXT);
    run(s, 60);
    expect(s.enemies.length).toBeGreaterThan(0);
    const atStake = s.enemies.reduce((a, e) => a + e.bounty, 0);
    const before = s.silver;
    const ev = run(s, 1, NEXT);
    expect(ev.some((e) => e.e === 'interest')).toBe(false);
    expect(s.wave).toBe(2);
    expect(s.silver - before).toBeGreaterThanOrEqual(economy.earlyCallBonus + fl((atStake * economy.earlyCallPct) / 100));
    expect(s.spawnQueue.length).toBeGreaterThan(0);
  });
});

describe('combat', () => {
  it('a generated disciple out-damages a lone one', () => {
    const lone = defend(), gen = defend();
    run(lone, 1, place('metal', 3, 3));
    run(gen, 1, place('metal', 3, 3), place('earth', 3, 4));
    const hit = (s: DefendState) => run(s, 1500, NEXT).find((e) => e.e === 'hit' && e.from === s.disciples[0]!.id && !e.crit);
    const a = hit(lone), b = hit(gen);
    expect(a && b).toBeTruthy();
    expect(b!.dmg!).toBeGreaterThan(a!.dmg!);
  });

  it('merging a maxed pair makes the right combo', () => {
    const s = defend();
    s.silver = 10000;
    run(s, 1, place('metal', 3, 3), place('water', 4, 3));
    const a = s.disciples[0]!.id, b = s.disciples[1]!.id;
    for (let i = 0; i < 2; i++) run(s, 1, up(a), up(b));
    const ev = run(s, 1, { t: 'merge', a, b });
    expect(ev.some((e) => e.e === 'combo' && e.type === 'frozen_blade')).toBe(true);
    expect(s.disciples.length).toBe(1);
    expect(s.disciples[0]!.els).toEqual(['metal', 'water']);
  });

  it('merge is refused below max level or when not adjacent', () => {
    const s = defend();
    s.silver = 10000;
    run(s, 1, place('metal', 3, 3), place('water', 6, 3));
    const ev = run(s, 1, { t: 'merge', a: s.disciples[0]!.id, b: s.disciples[1]!.id });
    expect(ev.some((e) => e.e === 'error')).toBe(true);
    expect(s.disciples.length).toBe(2);
  });

  it('a defended stage wins, an undefended one loses', () => {
    const empty = defend('1-1');
    run(empty, 20 * 60 * 10, NEXT);
    expect(empty.phase).toBe('lost');
    const guarded = play(defend('1-1'));
    expect(guarded.phase).toBe('won');
    expect(guarded.stars?.[0]).toBe(true);
  });
});

describe('combos', () => {
  function maxedPair(a: string, b: string): DefendState {
    const s = defend();
    s.silver = 100000;
    run(s, 1, place(a, 3, 3), place(b, 4, 3));
    const x = s.disciples[0]!.id, y = s.disciples[1]!.id;
    for (let i = 0; i < 2; i++) run(s, 1, up(x), up(y));
    run(s, 1, { t: 'merge', a: x, b: y });
    return s;
  }

  it('every combo in the data has a signature effect', () => {
    const src = readFileSync(SRC + 'defend.ts', 'utf8');
    for (const c of combos) expect(src.includes(`'${c.id}'`), `${c.id} has no rule in defend.ts`).toBe(true);
  });

  it('root quake keeps its bell stun while its root timer runs', () => {
    const s = maxedPair('wood', 'earth');
    expect(s.disciples[0]!.combo).toBe('root_quake');
    const ev = run(s, 2500, NEXT);
    expect(ev.filter((e) => e.e === 'stun' && e.from === s.disciples[0]!.id).length).toBeGreaterThanOrEqual(4);
  });

  it('molten edge ignores brute armour', () => {
    const s = maxedPair('metal', 'fire');
    run(s, 2, NEXT);
    const e = s.enemies[0]!;
    Object.assign(e, { id: 999, type: 'brute', el: 'earth', hp: 100000, maxHp: 100000, d: 3000, x: 3500, y: 2500, stunT: 1000 });
    const hits = run(s, 60).filter((x) => x.e === 'hit' && x.to === 999 && !x.crit);
    // merged damage (sum x comboDmgPct) at level 3, armour not subtracted; earth target is neutral to metal+fire
    const expected = fl((fl(((sect('metal').dmg + sect('fire').dmg) * comboDmgPct) / 100) * statPct[2]!) / 100);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.dmg).toBe(expected);
  });

  it('yin-yang level 3 adds one percent interest', () => {
    const s = defend();
    s.silver = 100000;
    run(s, 1, place('yinyang', 10, 0));
    for (let i = 0; i < 2; i++) run(s, 1, up(s.disciples[0]!.id));
    s.silver = 400;
    s.wave = 10; // cap 40, so the +1% is visible: 400 * (4 + 1)% = 20
    expect(interestAtClear(s)).toBe(20);
  });
});

describe('secret arts and cards', () => {
  it('heaven sword hits, then goes on cooldown', () => {
    const s = defend('1-1');
    run(s, 60, NEXT);
    const before = s.enemies.reduce((a, e) => a + e.hp, 0);
    const ev = run(s, 1, { t: 'cast', art: 'heaven_sword' });
    expect(ev.some((e) => e.e === 'art' && e.name === 'heaven_sword')).toBe(true);
    expect(s.enemies.reduce((a, e) => a + e.hp, 0)).toBeLessThan(before);
    expect(run(s, 1, { t: 'cast', art: 'heaven_sword' }).some((e) => e.e === 'error' && e.msg === 'art on cooldown')).toBe(true);
  });

  it('lion roar stuns everything and reveals', () => {
    const s = defend();
    run(s, 200, NEXT);
    run(s, 1, { t: 'cast', art: 'lion_roar' });
    expect(s.enemies.every((e) => e.stunT > 0)).toBe(true);
    expect(s.revealAllT).toBeGreaterThan(0);
  });

  it('offers three cards after wave 5 and auto-picks', () => {
    const s = defend('1-1');
    s.silver = 10000;
    run(s, 1, ...[[3, 3], [5, 3], [7, 3], [3, 6], [5, 8], [7, 8]].map(([x, y]) => place('metal', x!, y!)));
    while (s.phase !== 'picking' && !isOver(s)) stepDefend(s, s.phase === 'build' || s.phase === 'break' ? [NEXT] : []);
    expect(s.wave).toBe(5);
    expect(s.offer!.length).toBe(3);
    expect(new Set(s.offer).size).toBe(3);
    expect(s.offer!.every((id) => !['overheat', 'deep_freeze', 'mountain_root'].includes(id))).toBe(true);
    const first = s.offer![0]!;
    const ev = run(s, 20 * 16);
    expect(ev.some((e) => e.e === 'picked' && e.name === first)).toBe(true);
    expect(s.cards).toEqual([first]);
  });

  it('the bounty board adds silver per kill', () => {
    const a = defend('1-1'), b = defend('1-1');
    b.cards.push('bounty_board');
    for (const s of [a, b]) run(s, 1, place('metal', 3, 3), NEXT);
    const ka = run(a, 900).find((e) => e.e === 'kill'), kb = run(b, 900).find((e) => e.e === 'kill');
    expect(ka && kb).toBeTruthy();
    expect(kb!.amount).toBe(ka!.amount! + 1);
  });
});

describe('variety', () => {
  it('target modes pick different enemies', () => {
    // Three stunned enemies in range: lead (d high, mid hp), strong (most hp), weak+close.
    const pick = (mode: string) => {
      const s = defend('1-1');
      run(s, 1, place('metal', 4, 3), NEXT);
      run(s, 60);
      const [a, b, c] = [s.enemies[0]!, s.enemies[1]!, s.enemies[2]!];
      Object.assign(a, { d: 6000, x: 6500, y: 2500, hp: 50, stunT: 999 });
      Object.assign(b, { d: 5000, x: 5500, y: 2500, hp: 90, stunT: 999 });
      Object.assign(c, { d: 4000, x: 4500, y: 2500, hp: 20, stunT: 999 });
      s.disciples[0]!.cd = 0;
      const hit = run(s, 1, { t: 'target', id: s.disciples[0]!.id, mode }).find((e) => e.e === 'hit');
      return hit ? [a.id, b.id, c.id].indexOf(hit.to!) : -1;
    };
    expect(pick('first')).toBe(0);
    expect(pick('strong')).toBe(1);
    expect(pick('weak')).toBe(2);
    expect(pick('close')).toBe(2);
  });

  it('wave entries match what the next wave spawns', () => {
    const s = defend('1-4');
    const preview = waveEntries(s.stageId, s.wave + 1, s.nextRecipe).length;
    expect(run(s, 400, NEXT).filter((e) => e.e === 'spawn').length).toBe(preview);
  });

  it('elites appear from wave 5', () => {
    const s = defend('T-1');
    s.wave = 7;
    for (let i = 0; i < 200; i++) stepDefend(s, []);
    for (let w = 0; w < 3; w++) { s.phase = 'build'; run(s, 300, NEXT); }
    const e = s.enemies.find((x) => x.elite != null);
    expect(e).toBeTruthy();
    expect(['golden', 'swift', 'undying']).toContain(e!.elite);
  });

  it('rejects unknown sects and prototype keys', () => {
    const s = defend('1-1');
    const ev = run(s, 1, place('dragon', 4, 4), place('constructor', 4, 5), { t: 'bogus' } as unknown as Command);
    expect(s.disciples.length).toBe(0);
    expect(ev.filter((e) => e.e === 'error').length).toBe(3);
  });

  it('the greedy bot wins early stages', () => {
    for (const id of ['1-1', '1-2', '1-4', 'T-1']) expect(play(defend(id), { maxDisciples: 6 }).phase, id).toBe('won');
  });
});

describe('determinism', () => {
  const REPLAY: Record<number, Command[]> = {
    0: [place('metal', 3, 2), place('earth', 3, 3), NEXT],
    200: [place('metal', 6, 5)],
    600: [up(1)],
    900: [place('earth', 5, 8)],
  };
  const trace = (seed: number) => {
    const hashes: string[] = [];
    const end = replay('1-4', seed, null, REPLAY, (s) => { if (s.tick % 100 === 0) hashes.push(canonicalHash(s)); });
    hashes.push(end.phase + ':' + canonicalHash(end));
    return hashes;
  };

  it('the same seed and commands give identical hashes', () => {
    const a = trace(42), b = trace(42);
    expect(a.length).toBeGreaterThanOrEqual(11);
    expect(b).toEqual(a);
  });
  it('a different seed diverges', () => expect(trace(43).at(-1)).not.toBe(trace(42).at(-1)));
  it('the canonical string has a fixed layout', () => {
    expect(canonicalString(defend('1-1'))).toBe(`0|120|${economy.startLives}|0|build|1|||`);
    expect(fnv1a('abc')).toBe('1a47e90b');
  });

  // The rules must give the same result on every device and on the server: no clocks, no system randomness,
  // no DOM calls and no locale-dependent formatting. Maps and Sets are lookups only; the rules iterate arrays.
  it('the rules use no non-deterministic APIs', () => {
    const banned = /Math\.random|\bDate\b|performance\.|crypto\.|setTimeout|setInterval|\bwindow\.|\bdocument\.|toLocale|\bIntl\./;
    const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const src = readFileSync(SRC + f, 'utf8').replace(/\/\/[^\n]*/g, '');
      const m = src.match(banned);
      expect(m, `${f} uses ${m?.[0]}`).toBeNull();
    }
  });
});

describe('maps', () => {
  const defendLayouts = [...layouts.keys()].filter((k) => layouts.get(k)!.kind === 'defend');

  it('defend layouts start on the edge, end inside and keep props off the path', () => {
    const edge = (p: { x: number; y: number }) => p.x === 0 || p.y === 0 || p.x === grid.w - 1 || p.y === grid.h - 1;
    for (const name of defendLayouts)
      for (const variant of [null, 'mirror']) {
        const l = resolveLayout(name, variant);
        expect(l.paths.length, `${name} has a path`).toBeGreaterThan(0);
        for (const r of l.paths) {
          for (let i = 1; i < r.length; i++) expect(r[i]!.x === r[i - 1]!.x || r[i]!.y === r[i - 1]!.y, `${name} segment ${i}`).toBe(true);
          for (const p of r) expect(p.x >= 0 && p.y >= 0 && p.x < grid.w && p.y < grid.h, `${name} inside the grid`).toBe(true);
          expect(edge(r[0]!), `${name} spawn on the edge`).toBe(true);
          expect(edge(r.at(-1)!), `${name} goal inside`).toBe(false);
          expect(r.at(-1), `${name} paths share one goal`).toEqual(l.paths[0]!.at(-1));
        }
        const path = new Set(l.paths.flatMap((r) => [...tilesOnPath(r)]));
        for (const p of l.props) {
          expect(propBlocks.has(p.type), `${name} prop type ${p.type}`).toBe(true);
          expect(path.has(`${p.at.x},${p.at.y}`), `${name} prop ${p.type} at ${p.at.x},${p.at.y} on the path`).toBe(!!propOnPath.get(p.type));
        }
        expect(biomes.has(l.biome), `${name} biome`).toBe(true);
      }
  });

  // SPEC-pc-v2 §2: story maps are long and winding on the wide board.
  it('story layouts: every path 60-110 tiles, turning every 3-8 tiles', () => {
    for (const name of ['village-terraces', 'village-shrine', 'village-rooftops', 'village-spiral'])
      for (const r of layouts.get(name)!.paths) {
        let len = 0;
        for (let i = 1; i < r.length; i++) {
          const seg = Math.abs(r[i]!.x - r[i - 1]!.x) + Math.abs(r[i]!.y - r[i - 1]!.y);
          expect(seg, `${name} segment ${i}`).toBeGreaterThanOrEqual(3);
          expect(seg, `${name} segment ${i}`).toBeLessThanOrEqual(8);
          len += seg;
        }
        expect(len, `${name} length`).toBeGreaterThanOrEqual(60);
        expect(len, `${name} length`).toBeLessThanOrEqual(110);
      }
    for (const name of ['village-shrine', 'village-rooftops']) expect(layouts.get(name)!.paths.length, `${name} entrances`).toBe(2);
  });

  it('a two-gate stage sends its waves down both paths', () => {
    const s = defend('1-4');
    const ev = run(s, 400, NEXT);
    const used = ev.filter((e) => e.e === 'spawn').map((e) => s.enemies.find((x) => x.id === e.id)?.path);
    expect(used).toContain(0);
    expect(used).toContain(1);
    // each enemy stands on its own path
    for (const e of s.enemies) expect(s.pathTiles.has(`${Math.floor(e.x / 1000)},${Math.floor(e.y / 1000)}`)).toBe(true);
  });

  it('mirror twice is the original', () => {
    for (const name of defendLayouts)
      expect(resolveLayout(name, 'mirror').paths.map((r) => r.map((p) => ({ x: grid.w - 1 - p.x, y: p.y })))).toEqual(layouts.get(name)!.paths);
  });

  it('stage layouts exist and blocked tiles stop building', () => {
    for (const st of stageList) if (st.layout != null) expect(layouts.has(st.layout), `${st.id} layout`).toBe(true);
    const s = defend('1-1');
    const [bx, by] = [...s.blocked][0]!.split(',').map(Number);
    const ev: SimEvent[] = run(s, 1, place('metal', bx!, by!));
    expect(s.disciples.length).toBe(0);
    expect(ev.some((e) => e.e === 'error')).toBe(true);
  });
});

describe('data', () => {
  it('stages reference existing enemies and layouts', () => {
    for (const id of ['T-1', '1-1', '1-2', '1-3', '1-4', '1-9', '1-10']) {
      const st = stages.get(id)!;
      expect(st.layout, `${id} has a layout`).not.toBeNull();
      for (const e of st.enemies) expect(enemyDefs.has(e), `${id}: ${e}`).toBe(true);
    }
  });

  it('createDefend rejects an unknown stage', () => expect(() => createDefend('9-99', 1)).toThrow());
});
