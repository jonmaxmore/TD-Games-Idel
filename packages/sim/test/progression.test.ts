// Castle-battle progression (SPEC-castle-battle §12): levels, forge and town change a casual match, never a normalized one;
// the egg odds the shop shows are the odds it rolls.
import { describe, expect, it } from 'vitest';
import {
  abilityValue, addXp, battle, BATTLE_LEN, battleCardIds, battleHash, battleOver, battleUnits, castleLevelOf, createBattle, fixedHand,
  progression, rollEgg, stepBattle, type BattleCommand, type BattleSetup, type Progress,
} from '../src';
import { MIXED, playBattle } from './battleBot';

const MAXED: Progress = {
  levels: Object.fromEntries(battleCardIds.map((c) => [c, progression.maxLevel])),
  gear: Object.fromEntries(battleCardIds.map((c) => [c, progression.forge.map((f) => f.id)])),
  town: { cannon: progression.cannonTiers.length, wall: progression.wallTiers.length },
};
const withProgress = (s: BattleSetup, p: Progress): BattleSetup => ({ ...s, progress: p });

describe('progression data', () => {
  it('realms cover every level once, the xp curve has one step per level and never dips, castle levels climb', () => {
    for (let lv = 1; lv <= progression.maxLevel; lv++) expect(progression.realms.filter((r) => lv >= r.from && lv <= r.to).length, `level ${lv}`).toBe(1);
    expect(progression.xpToNext.length).toBe(progression.maxLevel - 1);
    for (let i = 1; i < progression.xpToNext.length; i++) expect(progression.xpToNext[i]!).toBeGreaterThanOrEqual(progression.xpToNext[i - 1]!);
    for (let i = 1; i < progression.castleLevels.length; i++) expect(progression.castleLevels[i]!.cardLevels).toBeGreaterThan(progression.castleLevels[i - 1]!.cardLevels);
    expect(castleLevelOf(battleCardIds.length)).toBe(1);
    expect(castleLevelOf(battleCardIds.length * progression.maxLevel)).toBe(progression.castleLevels.length);
  });

  it('xp levels a card up through the curve and stops at the cap', () => {
    expect(addXp(1, 0, progression.xpToNext[0]! + 1)).toEqual({ level: 2, xp: 1 });
    expect(addXp(1, 0, progression.xpToNext.reduce((a, x) => a + x, 0) + 999)).toEqual({ level: progression.maxLevel, xp: 0 });
  });
});

describe('progression in a match', () => {
  it('a normalized match hashes the same every tick with or without either side\'s progress', () => {
    const { commands } = playBattle(1, 'rush', 'defend');
    const plain = createBattle(1, MIXED, MIXED);
    const ranked = createBattle(1, withProgress(MIXED, MAXED), withProgress(MIXED, MAXED), { normalized: true });
    const casual = createBattle(1, withProgress(MIXED, MAXED), MIXED);
    let differs = false;
    while (!battleOver(plain)) {
      const cmds = commands[plain.tick] ?? [];
      stepBattle(plain, cmds); stepBattle(ranked, cmds); stepBattle(casual, cmds);
      expect(battleHash(ranked), `tick ${plain.tick}`).toBe(battleHash(plain));
      differs ||= battleHash(casual) !== battleHash(plain);
    }
    expect(differs).toBe(true); // the same progress outside ranked does change the match
  });

  it('a level-30 card beats its level-1 self in a duel', () => {
    const card = 'jade_bamboo_blade';
    const p30: Progress = { levels: { [card]: progression.maxLevel } };
    const s = createBattle(1, withProgress(fixedHand([card]), p30), fixedHand([card]));
    s.mana = [40, 40];
    const at = (side: 0 | 1): BattleCommand => ({ t: 'summon', side, card, d: 1000 });
    stepBattle(s, [at(0), at(1)]);
    const strong = s.units[0]!, weak = s.units[1]!;
    expect(strong.maxHp).toBeGreaterThan(weak.maxHp);
    const mid = Math.floor(BATTLE_LEN / 2); // out of both castles' reach
    s.units = [{ ...strong, d: mid, home: mid }, { ...weak, d: mid + 500, home: mid + 500 }];
    for (let i = 0; i < 2000 && s.units.length === 2; i++) stepBattle(s);
    expect(s.units.map((u) => u.side)).toEqual([0]);
  });

  it('at level 30 a card uses its ability at the leader\'s level even when it is not the leader, not in a normalized match', () => {
    const card = 'golden_lion', def = battleUnits.get(card)!;
    const p30: Progress = { levels: { [card]: progression.maxLevel } };
    const hp = (normalized: boolean) => {
      const s = createBattle(1, withProgress(fixedHand([card]), p30), fixedHand([card]), { normalized });
      s.mana = [40, 40];
      stepBattle(s, [{ t: 'summon', side: 0, card, d: 0 }]);
      return s.units[0]!.maxHp;
    };
    const k = 100 + (progression.maxLevel - 1) * progression.statPctPerLevel;
    expect(hp(false)).toBe(Math.floor((Math.floor((def.hp * k) / 100) * (100 + abilityValue(def, progression.abilityLevel))) / 100));
    expect(hp(true)).toBe(Math.floor((def.hp * (100 + abilityValue(def, 1))) / 100));
  });

  it('cannon and wall tiers add damage, push and castle HP, only when not normalized', () => {
    const town: Progress = { town: { cannon: progression.cannonTiers.length, wall: progression.wallTiers.length } };
    const top = progression.cannonTiers[progression.cannonTiers.length - 1]!, wall = progression.wallTiers[progression.wallTiers.length - 1]!;
    const shot = (normalized: boolean) => {
      const s = createBattle(1, withProgress(fixedHand(['ember_imp']), town), fixedHand(['ember_imp']), { normalized });
      s.mana = [40, 40];
      stepBattle(s, [{ t: 'summon', side: 1, card: 'ember_imp', d: 0 }]);
      const imp = s.units[0]!, aim = battle.cannon.reach;
      imp.hp = imp.maxHp = 9999;
      imp.d = aim; // side 0's depth is the path distance
      const ev = stepBattle(s, [{ t: 'cannon', side: 0, d: aim }]);
      return { castle: s.castles[0].maxHp, dmg: ev.find((e) => e.e === 'hit' && e.from === -1)!.dmg!, pushed: imp.d - aim };
    };
    expect(shot(false).castle).toBe(battle.castle.hp + wall.hp);
    expect(shot(true).castle).toBe(battle.castle.hp);
    expect(shot(false).dmg).toBe(battle.cannon.dmg + top.dmg);
    expect(shot(true).dmg).toBe(battle.cannon.dmg);
    expect(shot(false).pushed).toBeGreaterThan(shot(true).pushed);
  });
});

describe('eggs', () => {
  it('the odds shown sum to 100, every bucket has cards, and 20,000 seeded rolls land within 1.5 points of each', () => {
    for (const egg of progression.eggs) {
      expect(egg.odds.reduce((a, o) => a + o.pct, 0)).toBe(100);
      for (const o of egg.odds) expect(o.cards.length, o.nameTh).toBeGreaterThan(0);
      const r = { rng: 12345 }, hits = egg.odds.map(() => 0), N = 20000;
      for (let i = 0; i < N; i++) {
        const card = rollEgg(egg, r);
        const b = egg.odds.findIndex((o) => o.cards.includes(card));
        expect(b).toBeGreaterThanOrEqual(0);
        hits[b]!++;
      }
      egg.odds.forEach((o, i) => expect(Math.abs((100 * hits[i]!) / N - o.pct), o.nameTh).toBeLessThan(1.5));
    }
  });
});
