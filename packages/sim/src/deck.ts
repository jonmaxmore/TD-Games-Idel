// Deck points (SPEC-deck-budget, battle.json deck): what a card costs in the deck budget, apart from its mana in the match.
import { battle as B, battleUnits } from './data';

export const deckPoints = (card: string): number => {
  const d = battleUnits.get(card)!;
  return B.deck.cardPoints.get(card) ?? d.mana + (B.deck.sizePoints.get(d.size) ?? 0);
};
