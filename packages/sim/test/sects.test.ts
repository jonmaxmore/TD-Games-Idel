// Sect x role rosters and the sect rules (sects.json > roster, SPEC-core §4), plus the roster rules of the polish pass.
import { describe, expect, it } from 'vitest';
import { allegiance, cards, createDefend, stages, stepDefend, unlockedUnits, units, type Enemy } from '../src';
import { defend, NEXT, place, run, up } from './helpers';

describe('rosters', () => {
  it('roles unlock along chapter 1, and all of them on training grounds', () => {
    expect(unlockedUnits('fire', '1-1')).toEqual(['crimson_phoenix_striker', 'crimson_phoenix_burst']);
    expect(unlockedUnits('wood', '1-2')).toEqual(['jade_bamboo_striker', 'jade_bamboo_burst', 'jade_bamboo_control']);
    expect(unlockedUnits('fire', '1-12').length).toBe(5);
    expect(unlockedUnits('wood', 'T-0').length).toBe(5);
  });

  it('a sect without a roster plays legacy disciples', () => {
    const s = defend('1-1', 1, 'metal');
    expect(s.sect).toBeNull();
    expect(s.unlocked).toEqual(['metal']);
  });

  it('a roster unit fights with its kit but counts as its sect', () => {
    const s = defend('1-12', 1, 'fire');
    run(s, 1, place('crimson_phoenix_striker', 3, 3));
    const d = s.disciples[0]!;
    expect(d.els).toEqual(['metal']);
    expect(d.el).toBe('fire');
    expect(d.unit).toBe('crimson_phoenix_striker');
    expect(s.silver).toBe(defend('1-12', 1, 'fire').silver - units.get('crimson_phoenix_striker')!.cost);
  });

  it('rejects merging roster disciples', () => {
    const s = defend('1-12', 1, 'wood');
    s.silver = 10000;
    run(s, 1, place('jade_bamboo_striker', 3, 3), place('jade_bamboo_burst', 4, 3));
    for (let i = 0; i < 2; i++) run(s, 1, ...s.disciples.map((d) => up(d.id)));
    expect(run(s, 1, { t: 'merge', a: 1, b: 2 }).some((e) => e.e === 'error')).toBe(true);
  });

  const burnLoss = (sect: string | null) => {
    const s = createDefend('1-12', 1, sect);
    stepDefend(s, [NEXT]);
    while (s.enemies.length === 0) stepDefend(s, []);
    const e = s.enemies[0]!;
    e.hp = e.maxHp = 100000;
    let lost = 0;
    for (let t = 0; t < 100; t++) { e.burnT = 60; e.burnDps = 20; const before = e.hp; stepDefend(s, []); lost += before - e.hp; }
    return lost;
  };
  it('fire: a burn that keeps going hits harder', () => expect(burnLoss('fire')).toBeGreaterThan(burnLoss(null)));

  it('wood: a poisoned enemy that dies poisons its neighbours', () => {
    const s = createDefend('1-12', 1, 'wood');
    stepDefend(s, [NEXT]);
    while (s.enemies.length < 2) stepDefend(s, []);
    const [a, b] = [s.enemies[0]!, s.enemies[1]!];
    b.x = a.x; b.y = a.y; b.poison = 0;
    Object.assign(a, { poison: 2, poisonT: 40, poisonDps: 10, hp: 0 });
    stepDefend(s, []);
    expect(b.poison).toBeGreaterThan(0);
  });
});

describe('roster rules', () => {
  it('roster games get their sect cards and never the mixing cards', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      const s = defend('1-12', seed, 'fire');
      s.wave = 5; s.phase = 'clearing';
      run(s, 1);
      expect(s.phase).toBe('picking');
      for (const c of s.offer!) seen.add(c);
    }
    expect(seen.has('five_harmony') || seen.has('single_path'), [...seen].join(',')).toBe(false);
    expect(cards.filter((c) => c.needs === 'fire').length).toBeGreaterThan(0);
    expect(cards.filter((c) => c.needs != null && c.needs !== 'fire').every((c) => !seen.has(c.id))).toBe(true);
  });

  it('healers cannot mend burning or poisoned allies, and bosses only 1% a second', () => {
    const s = defend('1-12', 1, 'fire');
    run(s, 1, NEXT);
    while (s.enemies.length < 3) run(s, 1);
    const [h, a, b] = [s.enemies[0]!, s.enemies[1]!, s.enemies[2]!];
    h.type = 'healer'; h.age = 0;
    for (const e of [a, b]) Object.assign(e, { x: h.x, y: h.y, maxHp: 1000, hp: 500, stunT: 100 });
    h.stunT = 100;
    a.burnT = 100; a.burnDps = 0;
    for (let i = 0; i < 20; i++) { a.hp = Math.max(a.hp, 500); run(s, 1); }
    expect(b.hp).toBeGreaterThan(500);
    expect(a.hp).toBeLessThanOrEqual(500);
    const boss = s.enemies[2]!;
    Object.assign(boss, { type: 'boss_ch1b', maxHp: 100000, hp: 50000 });
    const before = boss.hp;
    for (let i = 0; i < 20; i++) run(s, 1);
    expect(boss.hp).toBeLessThanOrEqual(before + 100000 / 100);
  });

  it('wave shapes need a role the player has', () => {
    // 1-1: only striker and burst; "rush" needs a binder, so it must never be rolled.
    for (let seed = 1; seed <= 8; seed++) {
      const s = defend('1-1', seed, 'wood');
      const shapes: string[] = [];
      while (s.wave < s.totalWaves) { stepDefend(s, [NEXT]); shapes.push(s.recipe); }
      expect(shapes, `seed ${seed}`).not.toContain('rush');
    }
  });

  const strikerCrit = (sect: string, unit: string): Enemy => {
    const s = defend('1-12', 1, sect);
    run(s, 1, place(unit, 4, 3), NEXT);
    while (s.enemies.length === 0) run(s, 1);
    const e = s.enemies[0]!;
    Object.assign(e, { x: 4500, y: 2500, stunT: 999, hp: 100000, maxHp: 100000, type: 'cultist' });
    Object.assign(s.disciples[0]!, { hits: 5, cd: 0, level: 2 }); // level 2: every 6th hit is a sure crit
    run(s, 1);
    return e;
  };
  it("a roster striker's crit feeds its sect DoT", () => {
    expect(strikerCrit('fire', 'crimson_phoenix_striker').burnT).toBeGreaterThan(0);
    expect(strikerCrit('wood', 'jade_bamboo_striker').poison).toBeGreaterThan(0);
  });

  it('fire tier 3: a phoenix sweeps the path every 20 seconds', () => {
    const s = defend('1-12', 1, 'fire');
    s.silver = 100000;
    run(s, 1, place('crimson_phoenix_burst', 4, 3), NEXT);
    const d = s.disciples[0]!;
    for (let i = 0; i < 2; i++) run(s, 1, up(d.id));
    expect(d.level).toBe(3);
    expect(run(s, 20 * 21).some((e) => e.e === 'phoenix' && e.from === d.id)).toBe(true);
  });

  it('the max_2_sects star counts sects placed', () => {
    const s = defend('T-1');
    s.silver = 10000;
    run(s, 1, place('metal', 3, 3), place('water', 5, 3));
    expect(s.sectsUsed.length).toBe(2);
    run(s, 1, place('fire', 7, 3));
    expect(s.sectsUsed.length).toBe(3);
  });
});

describe('stage data', () => {
  // The first-run tutorial is a lesson, not a test: it starts with enough lives that it cannot be lost.
  it('the tutorial cannot be lost and story stages have names', () => {
    expect(defend('T-0').lives).toBeGreaterThanOrEqual(50);
    const undefended = defend('T-0');
    run(undefended, 20 * 60 * 6, NEXT);
    expect(undefended.phase).not.toBe('lost');
    for (const id of ['T-0', '1-1', '1-2', '1-4', '1-6', '1-12']) {
      const st = stages.get(id)!;
      expect(st.nameTh && st.nameEn, `${id} has Thai and English names`).toBeTruthy();
    }
    for (const a of allegiance) expect(a.ruleEn, `${a.element} rule in English`).toBeTruthy();
  });
});
