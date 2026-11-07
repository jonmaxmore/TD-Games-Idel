// What a player takes into a match: a collection (for now a sect's whole roster, or every card), a leader, a sub-leader
// and a bench of owned cards kept out of the draw. Each collection names the one the AI answers with.
import { battle, battleCardIds, battleUnits, sects, type BattleSetup } from '@five-sects/sim';
import { MIXED } from '../../sim/test/battleBot';

export interface Collection { id: string; nameTh: string; color: string; cards: readonly string[]; vs: string }
export interface Team { collection: string; leader: string; sub: string; bench: string[] }

const sectIds = [...battle.sectTeams.keys()];
export const COLLECTIONS: Collection[] = [
  ...sectIds.map((sect, i) => ({
    id: sect, nameTh: sects.get(sect)!.nameTh, color: sects.get(sect)!.color,
    cards: battleCardIds.filter((c) => battleUnits.get(c)!.sect === sect), vs: sectIds[(i + 1) % sectIds.length]!,
  })),
  { id: 'all', nameTh: 'ทุกสำนัก', color: '#E3B04B', cards: battleCardIds, vs: 'all' },
];
export const collectionOf = (id: string) => COLLECTIONS.find((c) => c.id === id) ?? COLLECTIONS[0]!;

export function defaultTeam(collection: string): Team {
  const c = collectionOf(collection), t = battle.sectTeams.get(c.id) ?? MIXED;
  return { collection: c.id, leader: t.leader, sub: t.sub, bench: [] };
}

// The cards a leader or sub-leader may be: owned, not the basic capturer of any sect.
const basics = new Set(battle.hand.basic.values());
export const leaderChoices = (c: Collection) => c.cards.filter((id) => !basics.has(id));

// A team from a save or a URL, made valid: a known collection, a leader and a distinct sub-leader from it, a bench of its
// cards that are neither of the two. Anything that does not fit falls back to the collection's default.
export function fixTeam(raw: unknown): Team {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const c = collectionOf(typeof r.collection === 'string' ? r.collection : '');
  const d = defaultTeam(c.id), ok = leaderChoices(c);
  const leader = typeof r.leader === 'string' && ok.includes(r.leader) ? r.leader : d.leader;
  let sub = typeof r.sub === 'string' && ok.includes(r.sub) && r.sub !== leader ? r.sub : d.sub;
  if (sub === leader) sub = ok.find((x) => x !== leader)!;
  const bench = Array.isArray(r.bench) ? c.cards.filter((x) => (r.bench as unknown[]).includes(x) && x !== leader && x !== sub) : [];
  return { collection: c.id, leader, sub, bench };
}

export const teamSetup = (t: Team): BattleSetup => ({ leader: t.leader, sub: t.sub, collection: collectionOf(t.collection).cards, bench: t.bench });
export const aiTeam = (t: Team): Team => defaultTeam(collectionOf(t.collection).vs);

// ?deck=<collection>&leader=<card>&sub=<card> from the URL; null without a known collection.
export function resolveTeam(q: URLSearchParams): Team | null {
  const id = q.get('deck');
  if (!id || !COLLECTIONS.some((c) => c.id === id)) return null;
  return fixTeam({ collection: id, leader: q.get('leader'), sub: q.get('sub') });
}
