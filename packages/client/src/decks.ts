// The decks a player can take into a match: each sect's preset of its own cards (battle.json > sectDecks) and the mixed
// deck the bots are balanced on. Each names the deck the AI answers with.
import { battle, battleUnits, sects } from '@five-sects/sim';
import { DECK } from '../../sim/test/battleBot';

export const DECK_SIZE = 8;
export interface DeckChoice { id: string; nameTh: string; color: string; cards: string[]; vs: string }

const sectIds = [...battle.sectDecks.keys()];

export const DECKS: DeckChoice[] = [
  ...sectIds.map((sect, i) => ({ id: sect, nameTh: sects.get(sect)!.nameTh, color: sects.get(sect)!.color, cards: [...battle.sectDecks.get(sect)!], vs: sectIds[(i + 1) % sectIds.length]! })),
  { id: 'mixed', nameTh: 'สำรับผสม', color: '#E3B04B', cards: [...DECK], vs: 'mixed' },
];

// A deck from a URL or save: a choice id, or a comma list of card ids (unknown ids dropped); null when nothing is left.
export function resolveDeck(v: string | null): DeckChoice | null {
  if (!v) return null;
  const d = DECKS.find((x) => x.id === v);
  if (d) return d;
  const cards = v.split(',').filter((c) => battleUnits.has(c)).slice(0, DECK_SIZE);
  return cards.length ? { id: 'custom', nameTh: 'สำรับกำหนดเอง', color: '#E3B04B', cards, vs: 'mixed' } : null;
}
