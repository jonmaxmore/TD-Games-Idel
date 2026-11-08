// How the procedural drawing tells every card apart (no sprites yet, ADR 0009): a disciple wears its sect's headgear and
// carries the weapon of its slot in the sect (sects.json role, else what its move and size make it), and a human flier rides
// its sect's mount; any other body (data body) is its own silhouette. Pure data, no DOM: board.ts draws a Look.
import type { BattleUnitDef } from '@five-sects/sim';

export type Slot = 'banner' | 'blade' | 'striker' | 'burst' | 'control' | 'stacker' | 'support' | 'large' | 'rider';
export type Head = 'guan' | 'straw' | 'hood' | 'topknot' | 'bald' | 'hat';
export type Mount = 'kite' | 'crane' | 'flysword' | 'swallow' | 'hawk';
export interface Look { body: string; head: Head | null; weapon: string | null; mount: Mount | null }

// Per sect (its element): headgear, the mount a flier rides, and the weapon per slot (named after what the card's Thai
// name says it carries).
const SECT: Record<string, { head: Head; mount: Mount; weapon: Record<Slot, string> }> = {
  fire: { head: 'topknot', mount: 'kite', weapon: { banner: 'banner', blade: 'emberblade', striker: 'quills', burst: 'fan', control: 'flameshield', stacker: 'coals', support: 'hammer', large: 'fan', rider: 'torch' } },
  wood: { head: 'straw', mount: 'crane', weapon: { banner: 'banner', blade: 'thornblade', striker: 'blowpipe', burst: 'leaves', control: 'vine', stacker: 'flute', support: 'gourd', large: 'vine', rider: 'darts' } },
  metal: { head: 'guan', mount: 'flysword', weapon: { banner: 'banner', blade: 'shortsword', striker: 'qisword', burst: 'swords', control: 'crossguard', stacker: 'broadsword', support: 'whetstone', large: 'greatsword', rider: 'shortsword' } },
  water: { head: 'hood', mount: 'swallow', weapon: { banner: 'banner', blade: 'iceblade', striker: 'palm', burst: 'ribbon', control: 'veil', stacker: 'lotus', support: 'bowl', large: 'ribbon', rider: 'iceblade' } },
  earth: { head: 'bald', mount: 'hawk', weapon: { banner: 'banner', blade: 'shortstaff', striker: 'fist', burst: 'longstaff', control: 'bell', stacker: 'iron', support: 'beads', large: 'longstaff', rider: 'shortstaff' } },
};
const ROLES = new Set<Slot>(['striker', 'burst', 'control', 'stacker', 'support']);

export function slotOf(d: BattleUnitDef): Slot {
  if (d.move === 'capture') return 'banner';
  if (d.move === 'fly') return 'rider';
  if (d.move === 'support') return 'support';
  if (d.move === 'guard') return 'control';
  if (d.size === 'small') return 'blade';
  if (d.size === 'large') return 'large';
  return ROLES.has(d.role as Slot) ? (d.role as Slot) : 'striker';
}

export function lookOf(d: BattleUnitDef): Look {
  const sect = SECT[d.sect];
  if (d.body !== 'human' || !sect) return { body: d.body, head: d.body === 'archer' ? 'hat' : null, weapon: null, mount: null };
  const slot = slotOf(d);
  return { body: 'human', head: sect.head, weapon: sect.weapon[slot], mount: slot === 'rider' ? sect.mount : null };
}

// Everything a drawing of the card depends on, so two cards with the same key would look alike.
export function lookKey(d: BattleUnitDef): string {
  const l = lookOf(d);
  return [l.body, l.head, l.weapon, l.mount, d.sect, d.size, d.move, d.kind].join('|');
}
