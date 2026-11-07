// What a player takes into a match: the collection (every card in the game, for now), a leader, a sub-leader and a bench
// of cards kept out of the draw. A sect preset is a ready-made team: the sect's default leaders, everything else benched.
import { battle, battleCardIds, battleUnits, sectCards, sects, type BattleSetup } from '@five-sects/sim';
import { MIXED } from '../../sim/test/battleBot';

export interface Team { leader: string; sub: string; bench: string[] }
export interface Preset { id: string; nameTh: string; color: string; cards: readonly string[] }

export const COLLECTION: readonly string[] = battleCardIds;
export const ALL_NAME = 'ทุกตัวละคร';
const sectIds = [...battle.sectTeams.keys()];
export const PRESETS: Preset[] = sectIds.map((id) => ({ id, nameTh: sects.get(id)!.nameTh, color: sects.get(id)!.color, cards: sectCards(id) }));
export const presetOf = (id: string) => PRESETS.find((p) => p.id === id);

export const defaultTeam = (): Team => ({ leader: MIXED.leader, sub: MIXED.sub, bench: [] });
export function presetTeam(id: string): Team {
  const p = presetOf(id) ?? PRESETS[0]!, t = battle.sectTeams.get(p.id)!;
  return { leader: t.leader, sub: t.sub, bench: COLLECTION.filter((c) => !p.cards.includes(c)) };
}
// The preset a team still is (same leaders, exactly the sect's disciples in the draw), or undefined.
export function presetMatch(t: Team): Preset | undefined {
  return PRESETS.find((p) => {
    const d = presetTeam(p.id);
    return d.leader === t.leader && d.sub === t.sub && d.bench.length === t.bench.length && d.bench.every((c) => t.bench.includes(c));
  });
}
export const teamName = (t: Team) => presetMatch(t)?.nameTh ?? ALL_NAME;

// The cards a leader or sub-leader may be: any card but a basic capturer.
const basics = new Set(battle.hand.basic.values());
export const leaderChoices = COLLECTION.filter((id) => !basics.has(id));
export const isBasic = (id: string) => basics.has(id);

// A team from a save or a URL, made valid: a leader and a distinct sub-leader, a bench of known cards that are neither.
// A v3 save named a collection: a sect id becomes that sect's preset; anything that does not fit falls back field by field.
export function fixTeam(raw: unknown): Team {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const sect = typeof r.collection === 'string' && presetOf(r.collection) ? r.collection : null, d = sect ? presetTeam(sect) : defaultTeam();
  const leader = typeof r.leader === 'string' && leaderChoices.includes(r.leader) ? r.leader : d.leader;
  let sub = typeof r.sub === 'string' && leaderChoices.includes(r.sub) && r.sub !== leader ? r.sub : d.sub;
  if (sub === leader) sub = leaderChoices.find((x) => x !== leader)!;
  const want: unknown[] = Array.isArray(r.bench) ? [...(sect ? d.bench : []), ...r.bench] : d.bench;
  return { leader, sub, bench: COLLECTION.filter((x) => want.includes(x) && x !== leader && x !== sub) };
}

export const teamSetup = (t: Team): BattleSetup => ({ leader: t.leader, sub: t.sub, collection: COLLECTION, bench: t.bench });
// The AI answers a sect preset with the next sect's preset, and any other team with every card under the leaders of the
// sect after its leader's element.
export function aiTeam(t: Team): Team {
  const p = presetMatch(t), el = p?.id ?? battleUnits.get(t.leader)!.sect, i = sectIds.indexOf(el);
  const next = sectIds[(i + 1) % sectIds.length]!;
  if (p) return presetTeam(next);
  const l = battle.sectTeams.get(next)!;
  return { leader: l.leader, sub: l.sub, bench: [] };
}

// ?deck=<sect>|all|mixed|<card,card,...>&leader=<card>&sub=<card> from the URL; null without a known deck. A card list is
// the cards to draw from: everything else is benched.
export function resolveTeam(q: URLSearchParams): Team | null {
  const id = q.get('deck');
  if (!id) return null;
  const list = id.split(',').filter((c) => battleUnits.has(c));
  const base = presetOf(id) ? presetTeam(id) : id === 'all' || id === 'mixed' ? defaultTeam() : list.length > 0 ? { ...defaultTeam(), bench: COLLECTION.filter((c) => !list.includes(c)) } : null;
  if (!base) return null;
  return fixTeam({ ...base, leader: q.get('leader') ?? base.leader, sub: q.get('sub') ?? base.sub });
}
