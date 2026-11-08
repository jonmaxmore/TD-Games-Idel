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

// Picks for a leader and sub, taking the cards of order in turn: each one only if the slots after it can still be filled
// within the budget and the large cap, a card not owned only as one of the loaners the account may borrow. Fewer than
// deck.pick cards when nothing fits.
export function fillPicks(leader: string, sub: string, order: readonly string[], owned: readonly string[], budget = B.deck.budget): string[] {
  if (!battleUnits.has(leader) || !battleUnits.has(sub)) return [];
  const ok = (c: string) => battleUnits.has(c) && !isBasic(c) && c !== leader && c !== sub && (owned.includes(c) || B.deck.loaners.includes(c));
  const cand = order.filter((c, i) => ok(c) && order.indexOf(c) === i), room = loanerRoom(owned), picks: string[] = [];
  let left = budget - deckPoints(leader) - deckPoints(sub), large = deckLarge({ leader, sub, picks: [] }), lent = 0;
  for (const c of cand) {
    if (picks.length === B.deck.pick) break;
    const big = battleUnits.get(c)!.size === 'large', lend = !owned.includes(c), n = B.deck.pick - picks.length - 1;
    const rest = cand.filter((x) => x !== c && !picks.includes(x)), restLent = rest.filter((x) => !owned.includes(x)).slice(0, room - lent - (lend ? 1 : 0));
    const need = [...rest.filter((x) => owned.includes(x)), ...restLent].map(deckPoints).sort((a, b) => a - b).slice(0, n);
    if ((big && large >= B.hand.maxLarge) || (lend && lent >= room) || need.length < n || deckPoints(c) + need.reduce((a, x) => a + x, 0) > left) continue;
    picks.push(c);
    left -= deckPoints(c);
    if (big) large++;
    if (lend) lent++;
  }
  return picks;
}
// The "จัดให้" pick: the owned cards with the most deck points first (data order on ties), then loaners. skip: owned cards
// to leave out.
export function autoPicks(leader: string, sub: string, owned: readonly string[], budget = B.deck.budget, skip: readonly string[] = []): string[] {
  const mine = battleCardIds.filter((c) => owned.includes(c) && !skip.includes(c)).sort((a, b) => deckPoints(b) - deckPoints(a));
  return fillPicks(leader, sub, [...mine, ...B.deck.loaners.filter((c) => !owned.includes(c))], owned, budget);
}
