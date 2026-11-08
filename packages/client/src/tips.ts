// The versus-screen tip and the one tip a loss gives (ui.json, ui-flow.md §2.3). Client text only: the loss tip reads the
// damage each enemy card dealt us, which battle.ts adds up from the sim's own hit events.
import { battle, battleUnits, classesOf } from '@five-sects/sim';
import ui from '../../../docs/data/ui.json';

export const versusTip = (seed: number) => ui.versusTipsTh[Math.abs(seed) % ui.versusTipsTh.length]!;

const L = ui.lossTip as { order: string[]; classTh: Record<string, string>; lineTh: string };

const classOf = (card: string) => { const own = classesOf(battleUnits.get(card)!); return L.order.find((c) => own.includes(c)); };
// foeDmg: enemy card -> damage it dealt our side; cards: the ones we could bring, the likeliest first. The enemy card that
// dealt the most among those with a class in L.order is named. Null when nothing hurt us.
export function lossTip(foeDmg: Record<string, number>, cards: readonly string[]): string | null {
  const top = Object.entries(foeDmg).filter(([c, d]) => d > 0 && classOf(c)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (!top) return null;
  const def = battleUnits.get(top[0])!, cls = classOf(top[0])!;
  const example = cards.find((c) => battleUnits.get(c)!.counters.includes(cls));
  if (!example) return null;
  return L.lineTh.replace('{card}', def.nameTh).replace('{class}', L.classTh[cls]!).replace('{counter}', battle.counterTags.get(cls)!).replace('{example}', battleUnits.get(example)!.nameTh);
}
