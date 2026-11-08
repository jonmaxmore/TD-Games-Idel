import { describe, expect, it } from 'vitest';
import { battle, battleCardIds, createBattle, progression, stepBattle, type BattleSetup, type Progress } from '@five-sects/sim';
import { cardInfo } from '../src/cardInfo';

// The numbers every screen prints for a card (cardInfo) against the unit the sim actually summons in that context: plain
// pick, sub and leader, at base, Lv20, the lv30 ability unlock, with forge items, and ranked (normalized: base whatever).
const lv = (n: number): Progress => ({ levels: Object.fromEntries(battleCardIds.map((c) => [c, n])) });
const gear: Progress = { ...lv(20), gear: Object.fromEntries(battleCardIds.map((c) => [c, progression.forge.map((f) => f.id)])) };
const cases: [string, Progress | null, boolean][] = [
  ['base', null, false], ['Lv20', lv(20), false], [`Lv${progression.abilityAt}`, lv(progression.abilityAt), false], ['forge', gear, false], ['ranked', lv(30), true],
];

describe('shown stats are the summoned unit', () => {
  for (const [name, p, normalized] of cases)
    it(name, () => {
      for (const card of battleCardIds) {
        const [a, b] = battleCardIds.filter((c) => c !== card);
        for (const t of [{ leader: a!, sub: b!, picks: [card] }, { leader: card, sub: a!, picks: [] }, { leader: a!, sub: card, picks: [] }] as BattleSetup[]) {
          const setup = p ? { ...t, progress: p } : t;
          const s = createBattle(3, setup, { leader: '', sub: '', picks: ['ember_imp'] }, { normalized });
          s.mana = [battle.manaMax, battle.manaMax];
          stepBattle(s, [{ t: 'summon', side: 0, card, d: 500 }]);
          const u = s.units.find((x) => x.side === 0)!, shown = cardInfo(card, setup, normalized ? null : p);
          const as = t.leader === card ? 'leader' : t.sub === card ? 'sub' : 'pick';
          expect(shown.stats.startsWith(`HP ${u.maxHp} · ตี ${u.dmg} ·`), `${name} ${card} as ${as}: "${shown.stats}" vs sim HP ${u.maxHp} ตี ${u.dmg}`).toBe(true);
          if (u.aura || u.ward) expect(shown.ability, `${name} ${card} as ${as}`).toContain(`${u.aura || u.ward}%`);
        }
      }
    });

  it('every card has its full description', () => {
    for (const card of battleCardIds) expect(cardInfo(card, { leader: card, sub: '', picks: [] }, null).desc.length, card).toBeGreaterThan(10);
  });
});
