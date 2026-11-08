// Card acquisition (collection.json, acquisition.md): the tiers follow their rule, every card has one route for every home
// sect, a new account owns 9 cards, the egg shop sells by choice at its tier's price and gates, and ranked ignores ownership.
import { describe, expect, it } from 'vitest';
import {
  battleCardIds, battleUnits, collection, firstClearPay, homeCard, homeSects, ownedAt, rankedPool, routeOf, shopBlock, stages, starRewards,
  starterCards, starterTeam, tierOf, type Account,
} from '../src';

const ruleTier = (c: string) => {
  const u = battleUnits.get(c)!;
  if (u.move === 'capture') return 'basic';
  if (u.kind === 'dragon') return 'legendary';
  if (u.size === 'large') return 'elite';
  if (u.size === 'medium' && (u.move === 'fly' || u.kind === 'demon' || u.kind === 'divine')) return 'adept';
  return 'common';
};

describe('collection data', () => {
  it('every roster card has the tier its rule gives; prices and castle gates climb with the tier', () => {
    for (const c of battleCardIds) expect(tierOf(c).id, c).toBe(ruleTier(c));
    const priced = ['common', 'adept', 'elite', 'legendary'].map((t) => tierOf(battleCardIds.find((c) => ruleTier(c) === t)!));
    for (let i = 1; i < priced.length; i++) expect(priced[i]!.eggPoints! > priced[i - 1]!.eggPoints! && priced[i]!.eggShopFromCastleLevel! > priced[i - 1]!.eggShopFromCastleLevel!).toBe(true);
  });

  it('a new account owns the 5 banners, the archer and its home sect\'s blade, striker and control, and leads with striker and control', () => {
    for (const home of homeSects) {
      const own = starterCards(home);
      expect(own.length, home).toBe(9);
      expect(own).toEqual(expect.arrayContaining([...collection.starter, homeCard(home, 'blade'), homeCard(home, 'striker'), homeCard(home, 'control')]));
      expect(starterTeam(home)).toEqual({ leader: homeCard(home, 'striker'), sub: homeCard(home, 'control') });
    }
  });

  it('every card has exactly one route per home; chapter 1 gives a new card on 7 first clears and egg points on 3', () => {
    for (const home of homeSects) {
      const byStage = battleCardIds.filter((c) => routeOf(c, home).kind === 'stage');
      expect(byStage.length, home).toBe(7);
      expect(new Set(byStage.map((c) => (routeOf(c, home) as { stage: string }).stage)).size).toBe(7);
      for (const c of battleCardIds) {
        const r = routeOf(c, home);
        if (r.kind === 'shop') expect([r.price, r.castleLevel], c).toEqual([tierOf(c).eggPoints, tierOf(c).eggShopFromCastleLevel]);
      }
      expect(ownedAt(home, 0)).toEqual(starterCards(home));
      expect(ownedAt(home, 10).length).toBe(16);
    }
  });

  it('a first clear of a card already owned pays its tier\'s egg price instead', () => {
    const st = stages[0]!, card = (st.rewards.firstClear as { card: string }).card;
    expect(firstClearPay(st, 'fire', [])).toEqual({ card, eggPoints: 0 });
    expect(firstClearPay(st, 'fire', [card])).toEqual({ card: null, eggPoints: tierOf(card).eggPoints });
    expect(firstClearPay(stages[3]!, 'fire', [])).toEqual({ card: null, eggPoints: 10 });
  });

  it('chapter stars pay once each threshold is reached', () => {
    expect(starRewards('ch1', 14)).toEqual([]);
    expect(starRewards('ch1', 30).map((r) => r.key)).toEqual(['ch1:15', 'ch1:30']);
  });

  it('ranked draws from every card, whatever an account owns', () => expect(rankedPool).toEqual(battleCardIds));
});

describe('egg shop', () => {
  const acct = (more: Partial<Account> = {}): Account => ({ home: 'fire', owned: starterCards('fire'), castleLevel: 20, eggPoints: 999, won: () => true, ...more });
  const shopCard = battleCardIds.find((c) => routeOf(c, 'fire').kind === 'shop' && tierOf(c).id === 'adept')!;
  it('sells a shop card once 1-10 is won, from its tier\'s castle level, for its egg price', () => {
    expect(shopBlock(acct(), shopCard)).toBeNull();
    expect(shopBlock(acct({ won: (s) => s !== collection.shopAfter }), shopCard)).toBe('shopClosed');
    expect(shopBlock(acct({ castleLevel: tierOf(shopCard).eggShopFromCastleLevel! - 1 }), shopCard)).toBe('castleLevel');
    expect(shopBlock(acct({ eggPoints: tierOf(shopCard).eggPoints! - 1 }), shopCard)).toBe('eggPoints');
  });
  it('never sells a basic, nor a card with a stage route until it is owned (then as a training egg)', () => {
    expect(shopBlock(acct(), 'cloud_sword_banner')).toBe('notForSale');
    expect(shopBlock(acct(), 'cloud_crane')).toBe('notForSale');
    expect(shopBlock(acct({ owned: [...starterCards('fire'), 'cloud_crane'] }), 'cloud_crane')).toBeNull();
  });
});
