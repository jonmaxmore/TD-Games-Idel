import { describe, expect, it } from 'vitest';
import { battleCardIds, battleUnits } from '@five-sects/sim';
import { lookKey, lookOf } from '../src/looks';
import { teamName } from '../src/decks';

describe('card looks', () => {
  it('no two cards share a look', () => {
    const seen = new Map<string, string>();
    for (const c of battleCardIds) {
      const k = lookKey(battleUnits.get(c)!);
      expect(seen.get(k), `${c} looks like ${seen.get(k)}`).toBeUndefined();
      seen.set(k, c);
    }
  });

  it('human disciples differ in shape, not only colour: headgear, weapon and mount are unique together', () => {
    const shapes = battleCardIds.map((c) => lookOf(battleUnits.get(c)!)).filter((l) => l.body === 'human').map((l) => `${l.head}|${l.weapon}|${l.mount}`);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('every human disciple has a weapon, every flier a mount, and the giants their own body', () => {
    for (const c of battleCardIds) {
      const u = battleUnits.get(c)!, l = lookOf(u);
      if (l.body === 'human') expect(l.weapon, c).toBeTruthy();
      if (l.body === 'human' && u.move === 'fly') expect(l.mount, c).toBeTruthy();
    }
    expect(['crimson_phoenix_beast', 'frost_tide_naga', 'jade_bamboo_warden', 'vajra_stone_guardian'].map((c) => lookOf(battleUnits.get(c)!).body)).toEqual(['phoenix', 'naga', 'treant', 'statue']);
  });
});

describe('team names', () => {
  it('a sect disciple names its sect; a beast or the sectless archer names itself', () => {
    expect(teamName({ leader: 'cloud_sword_striker' })).toBe('ทัพสำนักกระบี่เมฆา');
    expect(teamName({ leader: 'wandering_archer' })).toBe('ทัพนักธนูพเนจร');
    expect(teamName({ leader: 'golden_lion' })).toBe('ทัพสิงห์ทองพิทักษ์');
  });
});
