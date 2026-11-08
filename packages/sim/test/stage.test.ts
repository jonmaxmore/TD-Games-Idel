// ศึกปราบ stage rules (SPEC-castle-battle §13): each gimmick, both sides' mana and the fort bonus, the fort layout, the wave
// warning, our castle starting hurt, and that a match without a stage is the same match as before stages existed.
import { describe, expect, it } from 'vitest';
import {
  battle, BATTLE_LEN, battleHash, battleOver, battleString, battleUnits, createBattle, fixedHand, fwd, plainStage, progression, stepBattle,
  type BattleCommand, type BattleEvent, type StageRules,
} from '../src';
import { MIXED, playBattle } from './battleBot';

const HAND = fixedHand(['crimson_phoenix_striker', 'crimson_phoenix_banner', 'jade_bamboo_blade', 'wandering_archer']);
const stage = (more: Partial<StageRules>): StageRules => ({ ...plainStage(), ...more });

describe('stage rules', () => {
  it('a stage whose numbers are all the defaults plays the same match as no stage; the plain fingerprint has no stage part', () => {
    const { commands } = playBattle(2, 'rush', 'defend');
    const a = createBattle(2, MIXED, MIXED), b = createBattle(2, MIXED, MIXED, { stage: plainStage() });
    while (!battleOver(a)) {
      const c = commands[a.tick] ?? [];
      stepBattle(a, c);
      stepBattle(b, c);
      expect(battleString(b).startsWith(battleString(a)), `tick ${a.tick}`).toBe(true);
    }
    expect(battleString(a)).not.toContain('stage');
  });

  it('castle: the enemy castle starts damaged (HP below its max) or reinforced (a higher max), ours untouched', () => {
    const hurt = createBattle(1, HAND, HAND, { stage: stage({ castleHpPct: [100, 60] }) });
    expect([hurt.castles[1].hp, hurt.castles[1].maxHp, hurt.castles[0].hp]).toEqual([battle.castle.hp * 0.6, battle.castle.hp, battle.castle.hp]);
    const wall = createBattle(1, HAND, HAND, { stage: stage({ castleHpPct: [100, 150] }) });
    expect([wall.castles[1].hp, wall.castles[1].maxHp]).toEqual([battle.castle.hp * 1.5, battle.castle.hp * 1.5]);
  });

  it('our castle can start below full HP: its max stays, the enemy\'s is untouched', () => {
    const s = createBattle(1, HAND, HAND, { stage: stage({ castleHpPct: [60, 100] }) });
    expect([s.castles[0].hp, s.castles[0].maxHp, s.castles[1].hp]).toEqual([battle.castle.hp * 0.6, battle.castle.hp, battle.castle.hp]);
  });

  it('waves: the scripted enemy unit walks out free at its tick and depth, at the enemy card level', () => {
    const card = 'jade_bamboo_blade', s = createBattle(1, HAND, { ...HAND, progress: { levels: { [card]: 11 } } }, { stage: stage({ waves: [{ tick: 40, card, d: 2000, warn: 0 }] }) });
    let ev: BattleEvent[] = [];
    while (s.tick <= 40) ev = stepBattle(s);
    const u = s.units.find((x) => x.side === 1)!;
    expect(ev.some((e) => e.e === 'spawn' && e.side === 1)).toBe(true);
    expect([u.card, u.maxHp, s.mana[1]]).toEqual([card, Math.floor((battleUnits.get(card)!.hp * (100 + 10 * progression.statPctPerLevel)) / 100), battle.manaStart]);
    expect(fwd(1, u.d)).toBeGreaterThan(2000);
    expect(s.units.length).toBe(1);
  });

  it('a wave with warn sends one warning event warn ticks before it lands, naming its card; none without warn', () => {
    const s = createBattle(1, HAND, HAND, { stage: stage({ waves: [{ tick: 300, card: 'golden_lion', d: 1000, warn: 100 }, { tick: 50, card: 'ember_imp', d: 1000, warn: 0 }, { tick: 20, card: 'ember_imp', d: 1000, warn: 60 }] }) });
    const warns: [number, BattleEvent][] = [];
    while (s.tick < 320) { const t = s.tick; for (const e of stepBattle(s)) if (e.e === 'warn') warns.push([t, e]); }
    expect(warns.map(([t, e]) => [t, e.type, e.amount, e.side])).toEqual([[0, 'ember_imp', 20, 1], [200, 'golden_lion', 100, 1]]);
    expect(s.units.filter((u) => u.card === 'golden_lion').length).toBe(1);
  });

  it('noCannon: neither castle may fire, and the mana stays', () => {
    const s = createBattle(1, HAND, HAND, { stage: stage({ noCannon: true }) });
    const ev = stepBattle(s, [{ t: 'cannon', side: 0, d: 3000 }, { t: 'cannon', side: 1, d: 3000 }]);
    expect(ev.filter((e) => e.e === 'error').map((e) => e.msg)).toEqual(['no cannon this stage', 'no cannon this stage']);
    expect(s.mana).toEqual([battle.manaStart, battle.manaStart]);
  });

  it('bloodMoon: enemy units deal enemyDmgPct of their damage, waves too; ours deal the plain amount', () => {
    const card: BattleCommand = { t: 'summon', side: 1, card: 'crimson_phoenix_striker', d: 0 };
    const s = createBattle(1, HAND, HAND, { stage: stage({ enemyDmgPct: 130, waves: [{ tick: 0, card: 'ember_imp', d: 3000, warn: 0 }] }) });
    stepBattle(s, [card, { ...card, side: 0 }]);
    const base = battleUnits.get('crimson_phoenix_striker')!.dmg;
    expect(s.units.map((u) => [u.side, u.card, u.dmg])).toEqual([[1, 'crimson_phoenix_striker', Math.floor(base * 1.3)], [0, 'crimson_phoenix_striker', base], [1, 'ember_imp', Math.floor(battleUnits.get('ember_imp')!.dmg * 1.3)]]);
  });

  it('each side starts with its stage mana; the enemy regenerates regenPct of the normal rate, we the normal rate', () => {
    const s = createBattle(1, HAND, HAND, { stage: stage({ manaStart: [8, 10], regenPct: 50 }) });
    expect(s.mana).toEqual([8, 10]);
    for (let i = 0; i < 60 * 20; i++) stepBattle(s);
    expect(s.mana).toEqual([18, 15]);
  });

  it('fortBonus: our first capture of each fort pays the bonus once; a retake or an enemy capture pays nothing', () => {
    const s = createBattle(1, HAND, HAND, { stage: stage({ manaStart: [0, 0], fortBonus: 5 }) });
    const take = (side: 0 | 1, i: number) => {
      const f = s.forts[i]!;
      f.owner = null;
      s.units = [];
      s.mana[side] = 1;
      stepBattle(s, [{ t: 'summon', side, card: 'crimson_phoenix_banner', d: 0 }]);
      s.units[0]!.d = f.d;
      const ev: BattleEvent[] = [];
      for (let k = 0; k < battle.forts.captureTicks + 2 && f.owner !== side; k++) ev.push(...stepBattle(s));
      expect(f.owner).toBe(side);
      const bonus = ev.filter((e) => e.e === 'bonus');
      if (bonus.length > 0) expect(s.mana[side]).toBeGreaterThanOrEqual(5);
      return bonus.map((e) => [e.side, e.id, e.amount]);
    };
    expect(take(0, 0)).toEqual([[0, 0, 5]]);
    expect(take(0, 0)).toEqual([]);
    expect(take(1, 1)).toEqual([]);
    expect(take(0, 1)).toEqual([[0, 1, 5]]);
  });

  it('the fort layout comes from the stage', () => {
    const s = createBattle(1, HAND, HAND, { stage: stage({ fortsAtPct: [40, 60] }) });
    expect(s.forts.map((f) => f.d)).toEqual([Math.floor(BATTLE_LEN * 0.4), Math.floor(BATTLE_LEN * 0.6)]);
  });

  it('a stage match is deterministic: two runs hash the same', () => {
    const run = () => { const s = createBattle(5, MIXED, MIXED, { stage: stage({ castleHpPct: [70, 80], regenPct: 70, fortBonus: 5, waves: [{ tick: 400, card: 'golden_lion', d: 1000, warn: 100 }] }) }); while (!battleOver(s)) stepBattle(s); return battleHash(s); };
    expect(run()).toBe(run());
  });
});
