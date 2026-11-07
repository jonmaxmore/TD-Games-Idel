// What the ค่ายฝึก screen and the result screen do to the account: level a card up with its xp, build forge items with coins
// and real time, buy town tiers with gold, buy eggs with egg points, and pay a match out. Castle levels are paid in egg points
// once each. All numbers come from progression.json through packages/sim; nothing here costs real money.
import { battleCardIds, castleLevelOf, forgeOf, progression, rewardFor, rollEgg, type Progress, type Reward } from '@five-sects/sim';
import { levelSum, type Profile } from './profile';

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

// A match result for the player: its reward, xp to every card of the hand, coins and gold.
export function payMatch(p: Profile, hand: readonly string[], won: boolean | null, type: string): Reward {
  const r = rewardFor(won, type);
  for (const c of new Set(hand)) if (p.cards[c]) giveXp(p, c, r.xp);
  p.coins += r.coins;
  p.gold += r.gold;
  return r;
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

// One egg: costs egg points, rolls a card with the shop's seeded RNG, the duplicate becomes that card's xp.
export function buyEgg(p: Profile, id: string): { card: string; xp: number } | string {
  const egg = progression.eggs.find((e) => e.id === id);
  if (!egg) return 'ไม่มีไข่นี้';
  if (p.eggPoints < egg.cost) return 'แต้มไข่ไม่พอ';
  p.eggPoints -= egg.cost;
  const r = { rng: p.eggRng }, card = rollEgg(egg, r);
  p.eggRng = r.rng;
  p.cards[card]!.dupes++;
  giveXp(p, card, egg.dupeXp);
  return { card, xp: egg.dupeXp };
}

// The account as the sim takes it: levels, the forge items finished by now, town tiers.
export function progressOf(p: Profile, now: number): Progress {
  const gear: Record<string, string[]> = {};
  for (const id of battleCardIds) {
    const built = progression.forge.filter((f) => forgeState(p, id, f.id, now).k === 'built').map((f) => f.id);
    if (built.length > 0) gear[id] = built;
  }
  return { levels: Object.fromEntries(battleCardIds.map((id) => [id, p.cards[id]!.level])), gear, town: { ...p.town } };
}
// The AI's side in a casual match: every card at the player's average card level, no forge, no town.
export function aiProgress(p: Profile): Progress {
  const avg = Math.floor(levelSum(p) / battleCardIds.length);
  return { levels: Object.fromEntries(battleCardIds.map((id) => [id, avg])) };
}
