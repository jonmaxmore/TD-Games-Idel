// What a player takes into a match: the cards the account owns (collection.json, profile.ts owned), a leader, a sub-leader
// and the picks (SPEC-deck-budget). Until the team screen is rebuilt for picking, the picks are autoPicks from the owned
// cards minus the bench, within the deck budget (a stage's deckBudget in ศึกปราบ). Ranked ศึกฝีมือ picks from every card
// (rankedPool) whatever is owned. The AI plays the next sect's disciples.
import { autoPicks, battle, battleCardIds, battleUnits, rankedPool, sectCards, sectSetup, sects, starterTeam, type BattleSetup } from '@five-sects/sim';

export interface Team { leader: string; sub: string; bench: string[] }

const basics = new Set(battle.hand.basic.values());
export const isBasic = (id: string) => basics.has(id);
// The cards a leader or sub-leader may be: any owned card but a basic capturer.
export const leaderChoices = (owned: readonly string[]) => owned.filter((id) => !isBasic(id));
const sectOf = (card: string) => battleUnits.get(card)?.sect ?? 'metal';
export const teamName = (t: { leader: string }) => `ทัพ${sects.get(sectOf(t.leader))?.nameTh ?? ''}`;

export const teamSetup = (t: Team, owned: readonly string[], budget = battle.deck.budget): BattleSetup => ({ leader: t.leader, sub: t.sub, picks: autoPicks(t.leader, t.sub, owned, budget, t.bench) });
export const rankedSetup = (t: Team): BattleSetup => ({ leader: t.leader, sub: t.sub, picks: autoPicks(t.leader, t.sub, rankedPool, battle.deck.budget, t.bench) });
// How many more owned cards could go on the bench and still leave deck.pick to pick from.
export function benchRoom(t: Team, owned: readonly string[]): number {
  return owned.filter((c) => !isBasic(c) && c !== t.leader && c !== t.sub && !t.bench.includes(c)).length - battle.deck.pick;
}

// A team from a save or a URL, made valid for what is owned: an owned leader and a distinct owned sub-leader (else the
// home sect's starter team, else the first owned cards), a bench of owned cards that are neither, cut so deck.pick owned
// cards stay to pick from.
export function fixTeam(raw: unknown, owned: readonly string[], home: string | null): Team {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, ok = leaderChoices(owned);
  const start = home ? starterTeam(home) : null;
  const pick = (x: unknown, not: string | null, d: string | undefined) => (typeof x === 'string' && ok.includes(x) && x !== not ? x : d && ok.includes(d) && d !== not ? d : ok.find((c) => c !== not) ?? '');
  const leader = pick(r.leader, null, start?.leader);
  const sub = pick(r.sub, leader, start?.sub);
  const want = Array.isArray(r.bench) ? r.bench : [];
  const t: Team = { leader, sub, bench: [] };
  for (const c of battleCardIds) if (want.includes(c) && owned.includes(c) && !isBasic(c) && c !== leader && c !== sub && benchRoom(t, owned) > 0) t.bench.push(c);
  return t;
}

// The AI's side in ศึกทั่วไป: the disciples of the sect after our leader's (battle.json sectTeams leaders).
export function aiSetup(t: { leader: string }): BattleSetup {
  const ids = [...battle.sectTeams.keys()], next = ids[(ids.indexOf(sectOf(t.leader)) + 1) % ids.length]!;
  return sectSetup(next);
}

// Dev and shots: ?deck=<sect>|all|mixed|<card,card,...>&leader=<card>&sub=<card> picks the cards a match draws from (instead
// of the save's collection) and its leaders; null without a known deck.
export function resolveTeam(q: URLSearchParams): { team: Team; cards: string[] } | null {
  const id = q.get('deck');
  if (!id) return null;
  const list = id.split(',').filter((c) => battleUnits.has(c));
  const sect = battle.sectTeams.get(id);
  const cards = sect ? sectCards(id) : id === 'all' || id === 'mixed' ? battleCardIds : list.length > 0 ? battleCardIds.filter((c) => list.includes(c) || isBasic(c)) : null;
  if (!cards) return null;
  const d = sect ?? battle.sectTeams.get('wood')!;
  return { team: fixTeam({ leader: q.get('leader') ?? (list.length > 0 ? list[0] : d.leader), sub: q.get('sub') ?? (list.length > 1 ? list[1] : d.sub) }, [...cards], null), cards: [...cards] };
}
