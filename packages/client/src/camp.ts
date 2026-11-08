// What the screens do to the account: pick the home sect, level a card up with its xp, build forge items with coins and real
// time, buy town tiers with gold, buy a chosen card (or a training egg) with egg points, pay a match out and claim first-clear
// and chapter-star rewards. Castle levels are paid in egg points once each. All numbers come from progression.json and
// collection.json through packages/sim; nothing here costs real money.
import {
  battleCardIds, castleLevelOf, chapter, firstClearPay, forgeOf, matchLevel, powerScore, progression, rankAfter, rewardFor, shopBlock, stages,
  starRewards, starterCards, starterTeam, tierOf, type Account, type BattleSetup, type Progress, type Rank, type Reward, type Stage,
} from '@five-sects/sim';
import { fixDecks, healTeam, setupOf } from './decks';
import { levelSum, teamOf, type Profile } from './profile';

export const xpNeed = (level: number) => (level >= progression.maxLevel ? null : progression.xpToNext[level - 1]!);
export const canLevel = (p: Profile, card: string) => { const n = xpNeed(p.cards[card]!.level); return n != null && p.cards[card]!.xp >= n; };

// Pays egg points for every castle level reached since the last payout; returns the levels newly reached.
function payCastle(p: Profile): number[] {
  const now = castleLevelOf(levelSum(p)), got: number[] = [];
  for (let lv = p.castleLevel + 1; lv <= now; lv++) { p.eggPoints += progression.castleLevels[lv - 1]!.eggPoints; got.push(lv); }
  p.castleLevel = Math.max(p.castleLevel, now);
  return got;
}

export function levelUp(p: Profile, card: string): { castle: number[] } | null {
  if (!canLevel(p, card)) return null;
  const c = p.cards[card]!;
  c.xp -= xpNeed(c.level)!;
  c.level++;
  if (c.level >= progression.maxLevel) c.xp = 0;
  return { castle: payCastle(p) };
}

const giveXp = (p: Profile, card: string, xp: number) => { const c = p.cards[card]!; if (c.level < progression.maxLevel) c.xp += xp; };

// A match result for the player: its reward (a stage's own on a win), xp to every card of the hand, coins and gold.
export function payMatch(p: Profile, hand: readonly string[], won: boolean | null, type: string, stage?: Stage): Reward {
  const r = won === true && stage ? stage.rewards.win : rewardFor(won, type);
  for (const c of new Set(hand)) if (p.owned.includes(c)) giveXp(p, c, r.xp); // a ranked hand or a loaner is not owned
  p.coins += r.coins;
  p.gold += r.gold;
  return r;
}

// A finished stage: every star goal reached now is kept, and the fastest win. Returns the stars that are new.
export function recordStage(p: Profile, id: string, stars: [boolean, boolean, boolean], sec: number): boolean[] {
  const was = p.campaign[id] ?? { stars: [false, false, false], bestSec: null };
  const fresh = stars.map((x, i) => x && !was.stars[i]);
  p.campaign[id] = { stars: stars.map((x, i) => x || was.stars[i]!) as [boolean, boolean, boolean], bestSec: stars[0] ? Math.min(sec, was.bestSec ?? sec) : was.bestSec };
  return fresh;
}
// A stage is open once the one before it has been won (the first always is).
export const stageOpen = (p: Profile, ids: readonly string[], i: number) => i === 0 || p.campaign[ids[i - 1]!]?.stars[0] === true;
// A ranked result moves the rank; returns the rank before and after.
export function recordRanked(p: Profile, won: boolean | null): { before: Rank; after: Rank } {
  const before = p.rank;
  p.rank = rankAfter(before, won);
  return { before, after: p.rank };
}

export type ForgeState = { k: 'none' } | { k: 'building'; leftSec: number } | { k: 'built' };
export function forgeState(p: Profile, card: string, slot: string, now: number): ForgeState {
  const done = p.forge[card]?.[slot];
  if (done == null) return { k: 'none' };
  return done <= now ? { k: 'built' } : { k: 'building', leftSec: Math.ceil((done - now) / 1000) };
}
export function build(p: Profile, card: string, slot: string, now: number): string | null {
  const f = forgeOf(slot);
  if (!f || !p.cards[card]) return 'ไม่มีช่องนี้';
  if (forgeState(p, card, slot, now).k !== 'none') return 'หลอมไปแล้ว';
  if (p.coins < f.coins) return 'เหรียญไม่พอ';
  p.coins -= f.coins;
  (p.forge[card] ??= {})[slot] = now + f.buildSec * 1000;
  return null;
}

export type TownKey = 'cannon' | 'wall';
export const townTiers = (k: TownKey) => (k === 'cannon' ? progression.cannonTiers : progression.wallTiers);
export function upgradeTown(p: Profile, k: TownKey): string | null {
  const next = townTiers(k)[p.town[k]];
  if (!next) return 'ระดับสูงสุดแล้ว';
  if (p.gold < next.gold) return 'ทองคำไม่พอ';
  p.gold -= next.gold;
  p.town[k]++;
  return null;
}

// A card joins the collection; a saved deck that borrowed in its place gives the loaner back (decks.ts healTeam).
const own = (p: Profile, card: string) => {
  if (p.owned.includes(card)) return;
  p.owned = battleCardIds.filter((c) => c === card || p.owned.includes(c));
  p.decks = p.decks.map((d) => ({ ...d, team: healTeam(d.team, p.owned) }));
};
export const won = (p: Profile, stage: string) => p.campaign[stage]?.stars[0] === true;
export const account = (p: Profile): Account => ({ home: p.home ?? '', owned: p.owned, castleLevel: castleLevelOf(levelSum(p)), eggPoints: p.eggPoints, won: (s) => won(p, s) });
export const SHOP_WHY: Record<string, string> = { notForSale: 'ไม่ขายในร้านไข่', shopClosed: 'ร้านไข่เปิดเมื่อผ่านด่าน 1-10', castleLevel: 'ปราสาทยังไม่ถึง', eggPoints: 'แต้มไข่ไม่พอ' };

// The egg shop (collection.json): a chosen card for its tier's egg points, owned at Lv1 at once (no hatch timer); a card
// already owned is a training egg: its tier's dupeXp as card xp.
export function buyCard(p: Profile, card: string): { card: string; xp: number } | string {
  const why = shopBlock(account(p), card);
  if (why) return SHOP_WHY[why]!;
  const t = tierOf(card);
  p.eggPoints -= t.eggPoints!;
  if (!p.owned.includes(card)) { own(p, card); return { card, xp: 0 }; }
  p.cards[card]!.dupes++;
  giveXp(p, card, t.dupeXp);
  return { card, xp: t.dupeXp };
}

// เลือกสำนักแรก: the home sect's starter cards join the collection, its starter team leads, and stages won before the pick
// (an older save) pay their first clears.
export function chooseHome(p: Profile, home: string): void {
  if (p.home) return;
  p.home = home;
  for (const c of starterCards(home)) own(p, c);
  p.decks = fixDecks(null, starterTeam(home), p.owned, home);
  p.deck = 0;
  claim(p);
}

// Pays every reward the save has earned and not been paid: each won stage's first clear (a new card, or egg points), then
// the chapter's star totals. Idempotent: what it pays goes into claimed. Waits for the home sect (a home role needs one).
export interface Claimed { stage?: string; stars?: string; card: string | null; eggPoints: number }
export function claim(p: Profile): Claimed[] {
  if (!p.home) return [];
  const got: Claimed[] = [];
  for (const st of stages) {
    if (!won(p, st.id) || p.claimed.includes(st.id)) continue;
    const pay = firstClearPay(st, p.home, p.owned);
    if (pay.card) own(p, pay.card);
    p.eggPoints += pay.eggPoints;
    p.claimed.push(st.id);
    got.push({ stage: st.id, ...pay });
  }
  const stars = stages.reduce((a, st) => a + (p.campaign[st.id]?.stars.filter(Boolean).length ?? 0), 0);
  for (const r of starRewards(chapter.id, stars)) {
    if (p.claimed.includes(r.key)) continue;
    if (r.card) own(p, r.card);
    p.eggPoints += r.eggPoints;
    p.claimed.push(r.key);
    got.push({ stars: r.key, card: r.card, eggPoints: r.eggPoints });
  }
  payCastle(p);
  return got;
}

// The account as the sim takes it: levels, the forge items finished by now, town tiers.
export function progressOf(p: Profile, now: number): Progress {
  const gear: Record<string, string[]> = {};
  for (const id of battleCardIds) {
    const built = progression.forge.filter((f) => forgeState(p, id, f.id, now).k === 'built').map((f) => f.id);
    if (built.length > 0) gear[id] = built;
  }
  // A card the account does not own is a loaner (SPEC-deck-budget §4): level 1, whatever its save entry holds.
  return { levels: Object.fromEntries(battleCardIds.map((id) => [id, p.owned.includes(id) ? p.cards[id]!.level : 1])), gear, town: { ...p.town } };
}
// The player's พลังทัพ (matchmaking.md §5): the current team over the owned cards with the account's progress.
export const playerPower = (p: Profile, now: number) => powerScore({ ...setupOf(teamOf(p)), progress: progressOf(p, now) });
// The AI's side in a casual match: every card at the one level whose power score is closest to the player's (the ratio is
// held under progression.json matchmaking.casual.powerRatioMaxPct), no forge, no town.
export function aiProgress(p: Profile, ai: BattleSetup, now: number): Progress & { ratioPct: number } {
  const at = (lv: number): Progress => ({ levels: Object.fromEntries(battleCardIds.map((id) => [id, lv])) });
  const m = matchLevel(playerPower(p, now), (lv) => powerScore({ ...ai, progress: at(lv) }));
  return { ...at(m.level), ratioPct: m.ratioPct };
}
