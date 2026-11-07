// ศึกปราบ stage rules (SPEC-castle-battle §13): each gimmick, the enemy's mana and the fort layout, and that a match without
// a stage is the same match as before stages existed.
import { describe, expect, it } from 'vitest';
import {
  battle, BATTLE_LEN, battleHash, battleOver, battleString, battleUnits, createBattle, fixedHand, fwd, progression, stepBattle,
  type BattleCommand, type BattleEvent, type Gimmick, type StageRules,
} from '../src';
import { MIXED, playBattle } from './battleBot';

const HAND = fixedHand(['crimson_phoenix_striker', 'crimson_phoenix_banner', 'jade_bamboo_blade', 'wandering_archer']);
const stage = (gimmick: Gimmick, more: Partial<StageRules> = {}): StageRules => ({ manaStart: battle.manaStart, regenPct: 100, fortsAtPct: battle.forts.atPct, gimmick, ...more });
const MOON: StageRules = stage({ kind: 'bloodMoon', dmgPct: 100 });

describe('stage rules', () => {
  it('a stage whose numbers are all the defaults plays the same match as no stage; the plain fingerprint has no stage part', () => {
    const { commands } = playBattle(2, 'rush', 'defend');
    const a = createBattle(2, MIXED, MIXED), b = createBattle(2, MIXED, MIXED, { stage: MOON });
    while (!battleOver(a)) {
      const c = commands[a.tick] ?? [];
      stepBattle(a, c);
      stepBattle(b, c);
      expect(battleString(b).startsWith(battleString(a)), `tick ${a.tick}`).toBe(true);
    }
    expect(battleString(a)).not.toContain('stage');
  });

  it('castle: the enemy castle starts damaged (HP below its max) or reinforced (a higher max), ours untouched', () => {
    const hurt = createBattle(1, HAND, HAND, { stage: stage({ kind: 'castle', hpPct: 60 }) });
    expect([hurt.castles[1].hp, hurt.castles[1].maxHp, hurt.castles[0].hp]).toEqual([battle.castle.hp * 0.6, battle.castle.hp, battle.castle.hp]);
    const wall = createBattle(1, HAND, HAND, { stage: stage({ kind: 'castle', hpPct: 150 }) });
    expect([wall.castles[1].hp, wall.castles[1].maxHp]).toEqual([battle.castle.hp * 1.5, battle.castle.hp * 1.5]);
  });

  it('waves: the scripted enemy unit walks out free at its tick and depth, at the enemy card level', () => {
    const card = 'jade_bamboo_blade', s = createBattle(1, HAND, { ...HAND, progress: { levels: { [card]: 11 } } }, { stage: stage({ kind: 'waves', waves: [{ tick: 40, card, d: 2000 }] }) });
    let ev: BattleEvent[] = [];
    while (s.tick <= 40) ev = stepBattle(s);
    const u = s.units.find((x) => x.side === 1)!;
    expect(ev.some((e) => e.e === 'spawn' && e.side === 1)).toBe(true);
    expect([u.card, u.maxHp, s.mana[1]]).toEqual([card, Math.floor((battleUnits.get(card)!.hp * (100 + 10 * progression.statPctPerLevel)) / 100), battle.manaStart]);
    expect(fwd(1, u.d)).toBeGreaterThan(2000);
    expect(s.units.length).toBe(1);
  });

  it('noCannon: neither castle may fire, and the mana stays', () => {
    const s = createBattle(1, HAND, HAND, { stage: stage({ kind: 'noCannon' }) });
    const ev = stepBattle(s, [{ t: 'cannon', side: 0, d: 3000 }, { t: 'cannon', side: 1, d: 3000 }]);
    expect(ev.filter((e) => e.e === 'error').map((e) => e.msg)).toEqual(['no cannon this stage', 'no cannon this stage']);
    expect(s.mana).toEqual([battle.manaStart, battle.manaStart]);
  });

  it('bloodMoon: enemy units deal dmgPct of their damage; ours deal the plain amount', () => {
    const card: BattleCommand = { t: 'summon', side: 1, card: 'crimson_phoenix_striker', d: 0 };
    const s = createBattle(1, HAND, HAND, { stage: stage({ kind: 'bloodMoon', dmgPct: 130 }) });
    stepBattle(s, [card, { ...card, side: 0 }]);
    const base = battleUnits.get('crimson_phoenix_striker')!.dmg;
    expect(s.units.map((u) => [u.side, u.dmg])).toEqual([[1, Math.floor(base * 1.3)], [0, base]]);
  });

  it('the enemy starts with the stage mana and regenerates regenPct of the normal rate; we keep the normal numbers', () => {
    const s = createBattle(1, HAND, HAND, { stage: stage({ kind: 'noCannon' }, { manaStart: 10, regenPct: 50 }) });
    expect(s.mana).toEqual([battle.manaStart, 10]);
    for (let i = 0; i < 60 * 20; i++) stepBattle(s);
    expect(s.mana).toEqual([Math.min(battle.manaMax, battle.manaStart + 10), 15]);
  });

  it('the fort layout comes from the stage', () => {
    const s = createBattle(1, HAND, HAND, { stage: stage({ kind: 'noCannon' }, { fortsAtPct: [40, 60] }) });
    expect(s.forts.map((f) => f.d)).toEqual([Math.floor(BATTLE_LEN * 0.4), Math.floor(BATTLE_LEN * 0.6)]);
  });

  it('a stage match is deterministic: two runs hash the same', () => {
    const run = () => { const s = createBattle(5, MIXED, MIXED, { stage: stage({ kind: 'castle', hpPct: 80 }, { regenPct: 70 }) }); while (!battleOver(s)) stepBattle(s); return battleHash(s); };
    expect(run()).toBe(run());
  });
});
