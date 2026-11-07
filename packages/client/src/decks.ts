// The decks a player can take into a match: one per sect with a roster (its own cards, topped up to 8 with other sects'
// guards) and the mixed deck the bots are balanced on. Each names the deck the AI answers with.
import { battleUnits, sects } from '@five-sects/sim';
import { DECK } from '../../sim/test/battleBot';

export const DECK_SIZE = 8;
export interface DeckChoice { id: string; nameTh: string; color: string; cards: string[]; vs: string }

const all = [...battleUnits.values()];
const sectIds = [...new Set(all.map((u) => u.sect))];
const sectDeck = (sect: string): string[] => {
  const own = all.filter((u) => u.sect === sect).map((u) => u.id);
  const guards = all.filter((u) => u.sect !== sect && u.move === 'guard').map((u) => u.id);
  return [...own, ...guards].slice(0, DECK_SIZE);
};

export const DECKS: DeckChoice[] = [
  ...sectIds.map((sect, i) => ({ id: sect, nameTh: sects.get(sect)!.nameTh, color: sects.get(sect)!.color, cards: sectDeck(sect), vs: sectIds[(i + 1) % sectIds.length]! })),
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
