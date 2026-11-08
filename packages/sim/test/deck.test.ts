// The chosen hand (SPEC-deck-budget): deck points, validateDeck's rules in order, loaners, and autoPicks always legal.
import { describe, expect, it } from 'vitest';
import {
  autoPicks, battle, battleCardIds, battleUnits, deckPoints, deckSpend, homeSects, isBasic, loanerRoom, ownedAt, rankedPool, sectCards, starterCards,
  starterTeam, stages, validateDeck, type Deck,
} from '../src';

const LEADER = 'cloud_sword_elder', SUB = 'cloud_sword_striker';
const deck = (picks: string[], leader = LEADER, sub = SUB): Deck => ({ leader, sub, picks });

describe('deck points', () => {
  it('a card costs its mana plus its size points, unless cardPoints names it', () => {
    for (const c of battleCardIds) {
      const d = battleUnits.get(c)!;
      expect(deckPoints(c), c).toBe(battle.deck.cardPoints.get(c) ?? d.mana + battle.deck.sizePoints.get(d.size)!);
    }
    expect(battle.hand.size).toBe(3 + battle.deck.pick);
  });
});

describe('validateDeck', () => {
  const ok = deck(['cloud_sword_burst', 'cloud_sword_stacker', 'wandering_archer', 'ember_imp']);
  it('passes a legal deck and names the first rule a deck breaks', () => {
    expect(deckSpend(ok)).toBeLessThanOrEqual(battle.deck.budget);
    expect(validateDeck(ok, rankedPool)).toBeNull();
    expect(validateDeck(deck(['nope', 'cloud_sword_stacker', 'wandering_archer', 'ember_imp']), rankedPool)).toBe('unknownCard');
    expect(validateDeck(deck(['cloud_sword_banner', 'cloud_sword_stacker', 'wandering_archer', 'ember_imp']), rankedPool)).toBe('basic');
    expect(validateDeck(deck(['cloud_sword_burst', 'wandering_archer', 'ember_imp'], 'jade_bamboo_banner'), rankedPool)).toBe('basic');
    expect(validateDeck(deck(['cloud_sword_burst', 'wandering_archer', 'ember_imp']), rankedPool)).toBe('pickCount');
    expect(validateDeck(deck(['cloud_sword_burst', 'cloud_sword_burst', 'wandering_archer', 'ember_imp']), rankedPool)).toBe('duplicate');
    expect(validateDeck(deck(['cloud_sword_striker', 'cloud_sword_stacker', 'wandering_archer', 'ember_imp']), rankedPool)).toBe('duplicate');
    expect(validateDeck(deck(['frost_tide_naga', 'jade_bamboo_warden', 'wandering_archer', 'ember_imp']), rankedPool)).toBe('tooManyLarge');
    expect(validateDeck(deck(['frost_tide_naga', 'cloud_sword_burst', 'cloud_sword_support', 'frost_tide_burst']), rankedPool)).toBe('overBudget');
  });

  it('a stage budget replaces the deck budget', () => {
    expect(validateDeck(ok, rankedPool, deckSpend(ok))).toBeNull();
    expect(validateDeck(ok, rankedPool, deckSpend(ok) - 1)).toBe('overBudget');
  });

  it('the leader, the sub and every pick come from the owned cards; an account short of 6 non-basic cards borrows loaners for the gap', () => {
    const owned = starterCards('metal'); // 4 non-basic cards: blade, striker, control, archer
    expect(loanerRoom(owned)).toBe(2);
    const [lend0, lend1] = battle.deck.loaners.filter((c) => !owned.includes(c)) as [string, string];
    const mine = deck(['cloud_sword_blade', 'wandering_archer', lend0, lend1], 'cloud_sword_striker', 'cloud_sword_control');
    expect(validateDeck(mine, owned)).toBeNull();
    expect(validateDeck({ ...mine, leader: 'cloud_sword_elder' }, owned)).toBe('notOwned');
    expect(validateDeck({ ...mine, picks: ['cloud_sword_blade', 'wandering_archer', lend0, 'ember_imp'] }, owned)).toBe('notOwned');
    const more = [...owned, 'cloud_sword_burst'];
    expect(validateDeck({ ...mine, picks: ['cloud_sword_blade', 'wandering_archer', 'cloud_sword_burst', lend0] }, more)).toBeNull();
    expect(validateDeck(mine, more)).toBe('tooManyLoaners');
    expect(loanerRoom(rankedPool)).toBe(0);
    expect(battle.deck.loaners.every((c) => !isBasic(c) && battleUnits.get(c)!.size !== 'large')).toBe(true);
  });
});

// The cheapest legal completion by brute force (a DP over count, large cards and loaners), independent of fillPicks: does
// any legal hand hold this leader and sub?
function anyHand(leader: string, sub: string, owned: readonly string[], budget: number): boolean {
  const room = loanerRoom(owned), capL = battle.hand.maxLarge - [leader, sub].filter((c) => battleUnits.get(c)!.size === 'large').length;
  if (capL < 0) return false;
  const cand = [...new Set([...owned, ...battle.deck.loaners])].filter((c) => battleUnits.has(c) && !isBasic(c) && c !== leader && c !== sub);
  let dp = new Map<string, number>([['0,0,0', 0]]);
  for (const c of cand) {
    const nd = new Map(dp), big = battleUnits.get(c)!.size === 'large' ? 1 : 0, lend = owned.includes(c) ? 0 : 1;
    for (const [k, v] of dp) {
      const [n, l, j] = k.split(',').map(Number) as [number, number, number], nk = `${n + 1},${l + big},${j + lend}`;
      if (n < battle.deck.pick && l + big <= capL && j + lend <= room && (nd.get(nk) ?? Infinity) > v + deckPoints(c)) nd.set(nk, v + deckPoints(c));
    }
    dp = nd;
  }
  const best = Math.min(...[...dp].filter(([k]) => k.startsWith(`${battle.deck.pick},`)).map(([, v]) => v));
  return best <= budget - deckPoints(leader) - deckPoints(sub);
}

describe('autoPicks', () => {
  it('finds a legal hand whenever one exists: every ranked pair, and every pair each home owns at each stage', () => {
    const cases: [readonly string[], number, string][] = [[rankedPool, battle.deck.budget, 'ranked']];
    homeSects.forEach((h) => stages.forEach((st, i) => cases.push([ownedAt(h, i), st.deckBudget, `${h} ${st.id}`])));
    for (const [owned, budget, tag] of cases) {
      const mine = owned.filter((c) => battleUnits.has(c) && !isBasic(c));
      for (const l of mine) for (const s of mine) {
        if (l === s || !anyHand(l, s, owned, budget)) continue;
        expect(validateDeck({ leader: l, sub: s, picks: autoPicks(l, s, owned, budget) }, owned, budget), `${tag} ${l} ${s}`).toBeNull();
      }
    }
  });

  it('looks ahead within the large cap: a cheap large card cannot fill a slot the cap closes', () => {
    const was = battle.deck.cardPoints.get('venom_toad');
    battle.deck.cardPoints.set('venom_toad', 1); // a season could price a large card this low
    try {
      // Two large leaders close the cap; the four small and medium cards that fit cost 4 + 3 + 2 + 2.
      const owned = ['cloud_sword_elder', 'dawn_qilin', 'venom_toad', 'crimson_phoenix_striker', 'crimson_phoenix_burst', 'wandering_archer', 'ember_imp', 'crimson_phoenix_control'];
      const budget = deckPoints('cloud_sword_elder') + deckPoints('dawn_qilin') + 11;
      expect(anyHand('cloud_sword_elder', 'dawn_qilin', owned, budget)).toBe(true);
      expect(validateDeck({ leader: 'cloud_sword_elder', sub: 'dawn_qilin', picks: autoPicks('cloud_sword_elder', 'dawn_qilin', owned, budget) }, owned, budget)).toBeNull();
    } finally {
      if (was == null) battle.deck.cardPoints.delete('venom_toad'); else battle.deck.cardPoints.set('venom_toad', was);
    }
  });

  it('borrows the cheapest loaners when it looks ahead', () => {
    const was = battle.deck.cardPoints.get('vajra_stone_blade'); // the last loaner in data order
    battle.deck.cardPoints.set('vajra_stone_blade', 1);
    try {
      const owned = starterCards('fire'), t = starterTeam('fire'), cheap = battle.deck.loaners.filter((c) => !owned.includes(c)).map(deckPoints).sort((a, b) => a - b);
      const mine = owned.filter((c) => !isBasic(c) && c !== t.leader && c !== t.sub).map(deckPoints).sort((a, b) => a - b);
      const budget = deckPoints(t.leader) + deckPoints(t.sub) + mine.reduce((a, x) => a + x, 0) + cheap[0]! + cheap[1]!;
      expect(anyHand(t.leader, t.sub, owned, budget)).toBe(true);
      expect(validateDeck({ ...t, picks: autoPicks(t.leader, t.sub, owned, budget) }, owned, budget)).toBeNull();
    } finally {
      if (was == null) battle.deck.cardPoints.delete('vajra_stone_blade'); else battle.deck.cardPoints.set('vajra_stone_blade', was);
    }
  });

  it('a new account of every home sect fills its hand with loaners, within budget', () => {
    for (const home of homeSects) {
      const owned = starterCards(home), t = starterTeam(home), picks = autoPicks(t.leader, t.sub, owned);
      expect(validateDeck({ ...t, picks }, owned), home).toBeNull();
      expect(picks.filter((c) => !owned.includes(c)).length, home).toBe(2);
    }
  });

  it('is legal for every home sect at every stage, every sect team and any ranked leader pair, and takes the dearest cards that fit', () => {
    homeSects.forEach((home) => stages.forEach((st, i) => {
      const owned = ownedAt(home, i), t = starterTeam(home);
      expect(validateDeck({ ...t, picks: autoPicks(t.leader, t.sub, owned, st.deckBudget) }, owned, st.deckBudget), `${home} ${st.id}`).toBeNull();
    }));
    for (const [sect, t] of battle.sectTeams) expect(validateDeck({ ...t, picks: autoPicks(t.leader, t.sub, sectCards(sect)) }, sectCards(sect)), sect).toBeNull();
    const ok = rankedPool.filter((c) => !isBasic(c));
    for (let i = 0; i < ok.length; i += 7) {
      const leader = ok[i]!, sub = ok[(i + 3) % ok.length]!, d = { leader, sub, picks: autoPicks(leader, sub, rankedPool) };
      const fill = ok.filter((c) => c !== leader && c !== sub).map(deckPoints).sort((a, b) => a - b).slice(0, battle.deck.pick).reduce((a, x) => a + x, 0);
      if (deckPoints(leader) + deckPoints(sub) + fill > battle.deck.budget) continue; // no legal hand holds this pair
      expect(validateDeck(d, rankedPool), `${leader} ${sub}`).toBeNull();
    }
    const elder = autoPicks(LEADER, SUB, rankedPool);
    expect(deckSpend(deck(elder))).toBeGreaterThanOrEqual(battle.deck.budget - 1);
    expect(autoPicks(LEADER, SUB, rankedPool, battle.deck.budget, [elder[0]!])).not.toContain(elder[0]);
  });
});
