import { describe, expect, it } from 'vitest';
import {
  battle, battleCardIds, battleUnits, createBattle, progression, stepBattle, unitStats, type BattleOpts, type BattleSetup, type Progress,
} from '../src';

// Every card summoned for real in each context a screen shows numbers for: the HP and damage the sim gives the unit are
// the ones unitStats returns (what the HUD prints), the leader's and sub's ability levels and the lv30 unlock included.
const lv = (n: number): Progress => ({ levels: Object.fromEntries(battleCardIds.map((c) => [c, n])) });
const geared: Progress = { ...lv(20), gear: Object.fromEntries(battleCardIds.map((c) => [c, progression.forge.map((f) => f.id)])) };
const contexts: [string, Progress | null, BattleOpts][] = [
  ['base', null, {}], ['Lv20', lv(20), {}], [`Lv${progression.abilityAt}`, lv(progression.abilityAt), {}], ['Lv20 + forge', geared, {}],
  ['ranked (normalized)', lv(progression.abilityAt), { normalized: true }],
];

function summoned(setup: BattleSetup, card: string, opts: BattleOpts) {
  const s = createBattle(1, setup, { leader: '', sub: '', picks: ['crimson_phoenix_banner'] }, opts);
  s.mana = [battle.manaMax, battle.manaMax];
  stepBattle(s, [{ t: 'summon', side: 0, card, d: 500 }]);
  const u = s.units.find((x) => x.side === 0 && x.card === card);
  expect(u, `${card} summoned`).toBeDefined();
  return u!;
}

describe('unitStats is what a summon gets', () => {
  for (const [name, p, opts] of contexts)
    it(name, () => {
      for (const card of battleCardIds) {
        const def = battleUnits.get(card)!;
        // as a plain pick, as the leader and as the sub (ability levels 1/2/3, or the unlock)
        const [other, third] = battleCardIds.filter((c) => c !== card);
        const roles: BattleSetup[] = [{ leader: other!, sub: third!, picks: [card] }, { leader: card, sub: other!, picks: [] }, { leader: other!, sub: card, picks: [] }];
        for (const t of roles) {
          const setup = p ? { ...t, progress: p } : t, u = summoned(setup, card, opts), shown = unitStats(setup, card, opts.normalized ? null : p);
          expect([u.maxHp, u.dmg], `${name} ${card} leader=${t.leader === card} sub=${t.sub === card}`).toEqual([shown.hp, shown.dmg]);
          if (def.ability?.kind === 'aura') expect(u.aura).toBe(shown.ability);
          if (def.ability?.kind === 'ward') expect(u.ward).toBe(shown.ability);
        }
      }
    });

  it('ranked shows base stats whatever the account has', () => {
    for (const card of battleCardIds) {
      const def = battleUnits.get(card)!, st = unitStats({ leader: '', sub: '', picks: [card] }, card, null);
      expect(st.dmg).toBe(def.dmg);
      if (def.ability?.kind !== 'hp') expect(st.hp).toBe(def.hp);
    }
  });

  it('a card at abilityAt plays its ability at the leader level even as a plain pick', () => {
    const card = 'golden_lion', setup = { leader: 'cloud_sword_striker', sub: 'cloud_sword_burst', picks: [card] };
    expect(unitStats(setup, card, lv(progression.abilityAt - 1)).abilityLevel).toBe(1);
    expect(unitStats(setup, card, lv(progression.abilityAt)).abilityLevel).toBe(progression.abilityLevel);
  });
});
