// The chosen hand (SPEC-deck-budget, battle.json deck): the leader, the sub and deck.pick cards the player picks, checked at
// match start by validateDeck on the client and the server alike. Deck points are a budget apart from mana in the match.
import { battle as B, battleCardIds, battleUnits } from './data';

export interface Deck { leader: string; sub: string; picks: readonly string[] }
export type DeckError = 'unknownCard' | 'basic' | 'pickCount' | 'duplicate' | 'notOwned' | 'tooManyLoaners' | 'tooManyLarge' | 'overBudget';

const basics = new Set(B.hand.basic.values());
export const isBasic = (card: string) => basics.has(card);
export const deckPoints = (card: string): number => {
  const d = battleUnits.get(card)!;
  return B.deck.cardPoints.get(card) ?? d.mana + (B.deck.sizePoints.get(d.size) ?? 0);
};
const cardsOf = (d: Deck) => [d.leader, d.sub, ...d.picks];
export const deckSpend = (d: Deck) => cardsOf(d).reduce((a, c) => a + deckPoints(c), 0);
export const deckLarge = (d: Deck) => cardsOf(d).filter((c) => battleUnits.get(c)!.size === 'large').length;
// How many loaners an account that owns these cards may pick: one per non-basic card it lacks of the 6 a hand holds.
export const loanerRoom = (owned: readonly string[]) => Math.max(0, B.deck.pick + 2 - new Set(owned.filter((c) => battleUnits.has(c) && !isBasic(c))).size);

// null for a legal deck, else the first rule it breaks (SPEC-deck-budget §5). owned: the cards it may pick from (an
// account's collection, or rankedPool); budget: deck.budget or a stage's deckBudget.
export function validateDeck(d: Deck, owned: readonly string[], budget = B.deck.budget): DeckError | null {
  const all = cardsOf(d);
  if (!all.every((c) => battleUnits.has(c))) return 'unknownCard';
  if (all.some(isBasic)) return 'basic';
  if (d.picks.length !== B.deck.pick) return 'pickCount';
  if (new Set(all).size !== all.length) return 'duplicate';
  const loaned = d.picks.filter((c) => !owned.includes(c));
  if (!owned.includes(d.leader) || !owned.includes(d.sub) || !loaned.every((c) => B.deck.loaners.includes(c))) return 'notOwned';
  if (loaned.length > loanerRoom(owned)) return 'tooManyLoaners';
  if (deckLarge(d) > B.hand.maxLarge) return 'tooManyLarge';
  if (deckSpend(d) > budget) return 'overBudget';
  return null;
}

// The fewest deck points n of these cards can cost with at most big large cards and lend loaners (cards not owned), or -1
// when no n of them fit those caps. A small DP over [count][large][loaners], integers only.
function cheapestFill(cards: readonly string[], n: number, big: number, lend: number, owned: readonly string[]): number {
  if (big < 0 || lend < 0) return -1;
  const NONE = -1, at = (k: number, l: number, j: number) => (k * (big + 1) + l) * (lend + 1) + j;
  const dp: number[] = new Array((n + 1) * (big + 1) * (lend + 1)).fill(NONE);
  dp[at(0, 0, 0)] = 0;
  for (const c of cards) {
    const b = battleUnits.get(c)!.size === 'large' ? 1 : 0, o = owned.includes(c) ? 0 : 1, p = deckPoints(c);
    for (let k = n - 1; k >= 0; k--) for (let l = big - b; l >= 0; l--) for (let j = lend - o; j >= 0; j--) {
      const v = dp[at(k, l, j)]!, to = at(k + 1, l + b, j + o);
      if (v !== NONE && (dp[to] === NONE || v + p < dp[to]!)) dp[to] = v + p;
    }
  }
  let best = NONE;
  for (let l = 0; l <= big; l++) for (let j = 0; j <= lend; j++) { const v = dp[at(n, l, j)]!; if (v !== NONE && (best === NONE || v < best)) best = v; }
  return best;
}

// Picks for a leader and sub, taking the cards of order in turn: each one only if the cards after it can still fill the
// slots left within the budget, the large cap and the loaners the account may borrow (cheapestFill), so it finds a legal
// hand whenever one exists. Fewer than deck.pick cards when none does.
export function fillPicks(leader: string, sub: string, order: readonly string[], owned: readonly string[], budget = B.deck.budget): string[] {
  if (!battleUnits.has(leader) || !battleUnits.has(sub)) return [];
  const ok = (c: string) => battleUnits.has(c) && !isBasic(c) && c !== leader && c !== sub && (owned.includes(c) || B.deck.loaners.includes(c));
  const cand = order.filter((c, i) => ok(c) && order.indexOf(c) === i), room = loanerRoom(owned), picks: string[] = [];
  let left = budget - deckPoints(leader) - deckPoints(sub), large = deckLarge({ leader, sub, picks: [] }), lent = 0;
  cand.forEach((c, i) => {
    if (picks.length === B.deck.pick) return;
    const big = battleUnits.get(c)!.size === 'large' ? 1 : 0, lend = owned.includes(c) ? 0 : 1;
    const rest = cheapestFill(cand.slice(i + 1), B.deck.pick - picks.length - 1, B.hand.maxLarge - large - big, room - lent - lend, owned);
    if (rest < 0 || deckPoints(c) + rest > left) return;
    picks.push(c);
    left -= deckPoints(c);
    large += big;
    lent += lend;
  });
  return picks;
}
// The "จัดให้" pick: the owned cards with the most deck points first (data order on ties), then loaners. skip: owned cards
// to leave out.
export function autoPicks(leader: string, sub: string, owned: readonly string[], budget = B.deck.budget, skip: readonly string[] = []): string[] {
  const mine = battleCardIds.filter((c) => owned.includes(c) && !skip.includes(c)).sort((a, b) => deckPoints(b) - deckPoints(a));
  return fillPicks(leader, sub, [...mine, ...B.deck.loaners.filter((c) => !owned.includes(c))], owned, budget);
}
