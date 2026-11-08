// What a player takes into a match (SPEC-deck-budget): a leader, a sub-leader and deck.pick chosen cards, checked by the
// sim's validateDeck against the cards the mode lets them pick from: the account's own (plus loaners when it owns too few)
// in ศึกปราบ and ศึกทั่วไป, every card (rankedPool) in ศึกฝีมือ and friend rooms. The team screen edits a Team through the
// pure steps below and keeps it in one of DECK_SLOTS named saved decks. The casual AI plays the next sect's disciples with a
// seeded legal hand per match.
import {
  autoPicks, battle, battleCardIds, battleUnits, deckLarge, deckPoints, deckSpend, fillPicks, isBasic, loanerRoom, nextRandom, rankedPool, sectCards, sectSetup, sects,
  starterTeam, validateDeck, type BattleSetup, type DeckError,
} from '@five-sects/sim';

export { isBasic };
// picks may be short while the player is still choosing; validateDeck says so (pickCount) and the match cannot start.
export interface Team { leader: string; sub: string; picks: string[] }
export interface SavedDeck { name: string; team: Team }
export const DECK_SLOTS = 3;
export const DECK_NAME_MAX = 12;
export const deckName = (i: number) => `ทัพ ${i + 1}`;

// Where a team is played: the cards validateDeck counts as owned, the budget, and whether card levels count.
export interface DeckRules { owned: readonly string[]; budget: number; ranked: boolean }
export const casualRules = (owned: readonly string[], budget = battle.deck.budget): DeckRules => ({ owned, budget, ranked: false });
export const RANKED_RULES: DeckRules = { owned: rankedPool, budget: battle.deck.budget, ranked: true };
// The cards a team may pick from under these rules: every non-basic card it owns, then the loaners when it owns too few.
export const pickPool = (r: DeckRules): string[] => {
  const mine = battleCardIds.filter((c) => r.owned.includes(c) && !isBasic(c));
  return loanerRoom(r.owned) > 0 ? [...mine, ...battle.deck.loaners.filter((c) => !r.owned.includes(c))] : mine;
};
export const isLoaner = (c: string, r: DeckRules) => !r.owned.includes(c) && battle.deck.loaners.includes(c);

const sectOf = (card: string) => battleUnits.get(card)?.sect ?? 'metal';
export const teamName = (t: { leader: string }) => `ทัพ${sects.get(sectOf(t.leader))?.nameTh ?? ''}`;
export const setupOf = (t: Team): BattleSetup => ({ leader: t.leader, sub: t.sub, picks: [...t.picks] });
export const spendOf = (t: Team) => deckSpend(t);
export const largeOf = (t: Team) => deckLarge(t);
export { deckPoints };

// Why a team cannot start a match, in Thai (validateDeck's first broken rule), or null when it can.
const WHY: Record<DeckError, (t: Team, r: DeckRules) => string> = {
  unknownCard: () => 'มีการ์ดที่ไม่มีในเกมแล้ว เอาออกแล้วเลือกใหม่',
  basic: () => 'ธงยึดป้อมอยู่ในมือให้เองแล้ว ใช้เป็นแม่ทัพ รอง หรือช่องเลือกไม่ได้',
  pickCount: (t) => `เลือกการ์ดอีก ${battle.deck.pick - t.picks.length} ใบให้ครบ ${battle.deck.pick} ช่อง`,
  duplicate: () => 'มีการ์ดซ้ำกันในทัพ',
  notOwned: (t, r) => (r.owned.includes(t.leader) && r.owned.includes(t.sub) ? 'มีการ์ดที่บัญชียังไม่มี เอาใบนั้นออกก่อน' : 'แม่ทัพหรือรองเป็นการ์ดที่บัญชียังไม่มี'),
  tooManyLoaners: (_t, r) => `ยืมการ์ดได้ไม่เกิน ${loanerRoom(r.owned)} ใบ`,
  tooManyLarge: () => `ตัวใหญ่ได้ไม่เกิน ${battle.hand.maxLarge} ตัวต่อทัพ`,
  overBudget: (t, r) => `แต้มทัพเกินงบ ${r.budget} ไป ${deckSpend(t) - r.budget} แต้ม เปลี่ยนใบแพงเป็นใบที่ถูกกว่า`,
};
export function deckProblem(t: Team, r: DeckRules): string | null {
  const e = validateDeck(t, r.owned, r.budget);
  return e ? WHY[e](t, r) : null;
}
// A leader and sub with at least one legal hand under these rules (autoPicks finds one whenever one exists).
export const pairOk = (leader: string, sub: string, r: DeckRules) => autoPicks(leader, sub, r.owned, r.budget).length === battle.deck.pick;

// ---- the editing steps: each returns the next team, or a Thai reason it cannot be done ----
export type Step = { team: Team } | { why: string };
const inTeam = (t: Team, c: string) => c === t.leader || c === t.sub || t.picks.includes(c);
// A card goes into the first free slot only if the hand can still be completed within the budget and caps (fillPicks keeps
// a card only when the slots after it can still be filled).
export function addPick(t: Team, c: string, r: DeckRules): Step {
  if (inTeam(t, c)) return { why: 'ใบนี้อยู่ในทัพแล้ว' };
  if (t.picks.length >= battle.deck.pick) return { why: `ทัพเต็ม ${battle.deck.pick} ช่องแล้ว คลิกใบในทัพเพื่อเอาออกก่อน` };
  if (battleUnits.get(c)!.size === 'large' && deckLarge(t) >= battle.hand.maxLarge) return { why: `ตัวใหญ่ได้ไม่เกิน ${battle.hand.maxLarge} ตัวต่อทัพ` };
  const lent = t.picks.filter((x) => !r.owned.includes(x)).length;
  if (!r.owned.includes(c) && lent >= loanerRoom(r.owned)) return { why: `ยืมการ์ดได้ไม่เกิน ${loanerRoom(r.owned)} ใบ` };
  const want = [...t.picks, c], cheap = pickPool(r).sort((a, b) => deckPoints(a) - deckPoints(b));
  const fits = fillPicks(t.leader, t.sub, [...want, ...cheap], r.owned, r.budget).slice(0, want.length);
  if (fits.length < want.length || fits.some((x, i) => x !== want[i])) {
    const left = r.budget - deckSpend({ ...t, picks: want }), slots = battle.deck.pick - want.length;
    return { why: left < 0 ? `แต้มทัพไม่พอ ใบนี้ทำให้เกินงบ ${-left} แต้ม` : `แต้มเหลือ ${left} ไม่พอสำหรับอีก ${slots} ช่องที่ยังว่าง` };
  }
  return { team: { ...t, picks: want } };
}
export const removePick = (t: Team, c: string): Team => ({ ...t, picks: t.picks.filter((x) => x !== c) });
// The leader or sub takes card c: swapping with the other role, or with c's pick slot (the old holder takes that slot).
export function setRole(t: Team, role: 'leader' | 'sub', c: string, r: DeckRules): Step {
  const other = role === 'leader' ? 'sub' : 'leader';
  if (isBasic(c)) return { why: 'ธงยึดป้อมอยู่ในมือให้เองแล้ว' };
  if (!r.owned.includes(c)) return { why: isLoaner(c, r) ? 'ใบยืมใส่ได้แค่ช่องเลือก เป็นแม่ทัพหรือรองไม่ได้' : 'บัญชียังไม่มีการ์ดใบนี้' };
  if (t[role] === c) return { team: t };
  const next: Team = t[other] === c ? { ...t, [role]: c, [other]: t[role] } : { ...t, [role]: c, picks: t.picks.map((x) => (x === c ? t[role] : x)) };
  if (!pairOk(next.leader, next.sub, r)) return { why: 'แม่ทัพคู่นี้แต้มสูงเกินจนจัดมือให้ถูกกติกาไม่ได้' };
  return { team: next };
}
export const autoFill = (t: Team, r: DeckRules): Team => ({ ...t, picks: autoPicks(t.leader, t.sub, r.owned, r.budget) });

// ---- saves and URLs ----
const known = (c: unknown): c is string => typeof c === 'string' && battleUnits.has(c) && !isBasic(c);
// A team from a save, a URL or an older save shape: known non-basic cards only (which mode may use them is validateDeck's
// call), a leader and a distinct sub (else the home sect's starter pair, else the first owned cards), picks that are
// neither, each once, at most deck.pick. An older save's {leader, sub, bench} gets the autoPicks hand that leaves the bench
// out, or any autoPicks hand when too few cards are left.
export function fixTeam(raw: unknown, owned: readonly string[], home: string | null): Team {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, ok = owned.filter((c) => !isBasic(c));
  const start = home ? starterTeam(home) : null;
  const pick = (x: unknown, not: string | null, d: string | undefined) => (known(x) && x !== not ? x : d && known(d) && d !== not ? d : ok.find((c) => c !== not) ?? '');
  const leader = pick(r.leader, null, start?.leader);
  const sub = pick(r.sub, leader, start?.sub);
  if (!Array.isArray(r.picks)) {
    const skip = autoPicks(leader, sub, owned, battle.deck.budget, Array.isArray(r.bench) ? r.bench.filter(known) : []);
    return { leader, sub, picks: skip.length === battle.deck.pick ? skip : autoPicks(leader, sub, owned) };
  }
  const picks = r.picks.filter((c, i, a): c is string => known(c) && c !== leader && c !== sub && a.indexOf(c) === i).slice(0, battle.deck.pick);
  return { leader, sub, picks };
}
// A gained card can end the loaners' room (they fill in only while the account owns too few cards): a deck that now
// borrows too many keeps its owned picks and fills the rest the autoPicks way. Any other deck is left as it is.
export function healTeam(t: Team, owned: readonly string[]): Team {
  if (validateDeck(t, owned) !== 'tooManyLoaners') return t;
  const keep = t.picks.filter((c) => owned.includes(c)), auto = autoPicks(t.leader, t.sub, owned);
  return { ...t, picks: fillPicks(t.leader, t.sub, [...keep, ...auto], owned) };
}
// The saved decks: DECK_SLOTS named teams. A save from before saved decks keeps its one team in the first slot; the others
// start from the same leaders with nothing picked.
export function fixDecks(raw: unknown, legacy: unknown, owned: readonly string[], home: string | null): SavedDeck[] {
  const list = Array.isArray(raw) ? raw : [];
  const first = fixTeam(list.length > 0 ? (list[0] as { team?: unknown })?.team : legacy, owned, home);
  return Array.from({ length: DECK_SLOTS }, (_, i) => {
    const d = (list[i] && typeof list[i] === 'object' ? list[i] : {}) as Record<string, unknown>;
    const name = typeof d.name === 'string' && d.name.trim() !== '' ? d.name.trim().slice(0, DECK_NAME_MAX) : deckName(i);
    return { name, team: i === 0 ? first : d.team ? fixTeam(d.team, owned, home) : { leader: first.leader, sub: first.sub, picks: [] } };
  });
}

// The AI's side in ศึกทั่วไป: the sect after our leader's, its battle.json sectTeams leaders and a legal hand of that sect's
// disciples in a seeded order, so a match's seed gives the same hand on the versus screen and in the match, and the next
// match a different one. Not a rule: the sim checks nothing about it.
export function aiSetup(t: { leader: string }, seed: number): BattleSetup {
  const ids = [...battle.sectTeams.keys()], next = ids[(ids.indexOf(sectOf(t.leader)) + 1) % ids.length]!;
  const lead = battle.sectTeams.get(next)!, cards = sectCards(next), r = { rng: (seed * 2654435761) >>> 0 }, order = [...cards];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(nextRandom(r) * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
  const picks = fillPicks(lead.leader, lead.sub, order, cards);
  return picks.length === battle.deck.pick ? { leader: lead.leader, sub: lead.sub, picks } : sectSetup(next);
}

// Dev and shots: ?deck=<sect>|all|mixed|<card,card,...>&leader=<card>&sub=<card> picks the cards a match picks from (instead
// of the save's collection) and its leaders, with the autoPicks hand; null without a known deck.
export function resolveTeam(q: URLSearchParams): { team: Team; cards: string[] } | null {
  const id = q.get('deck');
  if (!id) return null;
  const list = id.split(',').filter((c) => battleUnits.has(c));
  const sect = battle.sectTeams.get(id);
  const cards = sect ? sectCards(id) : id === 'all' || id === 'mixed' ? battleCardIds : list.length > 0 ? battleCardIds.filter((c) => list.includes(c) || isBasic(c)) : null;
  if (!cards) return null;
  const d = sect ?? battle.sectTeams.get('wood')!;
  const t = fixTeam({ leader: q.get('leader') ?? (list.length > 0 ? list[0] : d.leader), sub: q.get('sub') ?? (list.length > 1 ? list[1] : d.sub), picks: [] }, [...cards], null);
  return { team: autoFill(t, casualRules([...cards])), cards: [...cards] };
}
