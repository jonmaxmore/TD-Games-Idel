// Castle-battle progression (progression.json, deck-and-realms.md §5): card levels and realms, castle level, forge, town
// tiers, match rewards and the power score (matchmaking.md §5). The stat formula lives here so a server re-runs it; a normalized (ranked) match never reads
// a side's progress. Integers only; lookups are Maps, anything iterated is an array in data order.
import progressionJson from '../../../docs/data/progression.json';
import { battle as B, battleUnits, TILE, type BattleUnitDef } from './data';
import { div } from './core';
import { handOf, type BattleSetup } from './battle';

/* eslint-disable @typescript-eslint/no-explicit-any */
const P = progressionJson as any;
const CL = P.cardLevel;

export interface Realm { id: string; from: number; to: number; nameTh: string; descTh: string; color: string }
export interface ForgeSlot { id: string; nameTh: string; itemTh: string; coins: number; buildSec: number; hpPct: number; dmgPct: number }
export interface Reward { xp: number; coins: number; gold: number }

export const progression = {
  maxLevel: CL.max as number, statPctPerLevel: CL.statPctPerLevel as number, xpToNext: CL.xpToNext as number[],
  abilityAt: CL.abilityAt as number, abilityLevel: CL.abilityLevel as number,
  realms: P.realms.bands as Realm[],
  castleLevels: (P.castleLevel.levels as any[]).map((l) => ({ cardLevels: l.cardLevels as number, eggPoints: l.eggPoints as number, unlockTh: (l.unlockTh ?? null) as string | null })),
  forge: P.forge.slots as ForgeSlot[],
  cannonNameTh: P.town.cannon.nameTh as string, wallNameTh: P.town.walls.nameTh as string,
  cannonTiers: (P.town.cannon.tiers as any[]).map((t) => ({ gold: t.gold as number, dmg: t.dmg as number, push: Math.round(t.pushTiles * TILE) })),
  wallTiers: (P.town.walls.tiers as any[]).map((t) => ({ gold: t.gold as number, hp: t.castleHp as number })),
  rewards: { win: new Map<string, Reward>(Object.entries(P.matchRewards.win as Record<string, Reward>)), draw: P.matchRewards.draw as Reward, loss: P.matchRewards.loss as Reward },
};
const forgeSlot = new Map(progression.forge.map((f) => [f.id, f]));

// What one side brings from its account: card levels (missing = 1), the forge items built per card (slot ids) and its town
// tiers (0 = none). Only ids and counts: the bonuses come from progression.json, so a server re-runs them.
export interface Progress { levels?: Readonly<Record<string, number>>; gear?: Readonly<Record<string, readonly string[]>>; town?: { cannon: number; wall: number } }

const clampInt = (x: unknown, lo: number, hi: number) => (typeof x === 'number' && Number.isInteger(x) ? Math.min(hi, Math.max(lo, x)) : lo);
export const levelOf = (p: Progress | null, card: string) => clampInt(p?.levels?.[card] ?? 1, 1, progression.maxLevel);
export const realmOf = (level: number): Realm => progression.realms.find((r) => level >= r.from && level <= r.to) ?? progression.realms[0]!;

// A card's % of its base hp and dmg: its level, plus every distinct forge item it has built.
export function statPct(p: Progress | null, card: string): { hp: number; dmg: number } {
  const lv = (levelOf(p, card) - 1) * progression.statPctPerLevel;
  let hp = 100 + lv, dmg = 100 + lv;
  for (const f of progression.forge) if (p?.gear?.[card]?.includes(f.id)) { hp += f.hpPct; dmg += f.dmgPct; }
  return { hp, dmg };
}
export function cardStats(def: BattleUnitDef, p: Progress | null): { hp: number; dmg: number } {
  const k = statPct(p, def.id);
  return { hp: div(def.hp * k.hp, 100), dmg: div(def.dmg * k.dmg, 100) };
}
export const abilityUnlocked = (p: Progress | null, card: string) => levelOf(p, card) >= progression.abilityAt;

// Town: the cannon's added damage and push (milli-tiles), the walls' added castle HP, for the tiers held.
export function townBonus(p: Progress | null): { cannonDmg: number; cannonPush: number; castleHp: number } {
  const c = progression.cannonTiers[clampInt(p?.town?.cannon ?? 0, 0, progression.cannonTiers.length) - 1];
  const w = progression.wallTiers[clampInt(p?.town?.wall ?? 0, 0, progression.wallTiers.length) - 1];
  return { cannonDmg: c?.dmg ?? 0, cannonPush: c?.push ?? 0, castleHp: w?.hp ?? 0 };
}

// Card xp: adds xp to (level, xp) and levels up while it covers xpToNext; at the cap the xp stops.
export function addXp(level: number, xp: number, gained: number): { level: number; xp: number } {
  let l = level, x = xp + gained;
  while (l < progression.maxLevel && x >= progression.xpToNext[l - 1]!) { x -= progression.xpToNext[l - 1]!; l++; }
  return { level: l, xp: l >= progression.maxLevel ? 0 : x };
}

// Castle level (1-based) for a sum of card levels.
export function castleLevelOf(sum: number): number {
  let lv = 1;
  progression.castleLevels.forEach((c, i) => { if (sum >= c.cardLevels) lv = i + 1; });
  return lv;
}

// พลังทัพ (matchmaking.md §5, progression.json > matchmaking.powerScore): round(base x A x K) in integers. A: each hand
// card's hp% x dmg%, weighted max(n, drawSlots) for the fixed three and drawSlots for each of the n picks (the doc's 1 and
// min(1, drawSlots/n) times max(n, drawSlots); with deck.pick = drawSlots every hand card weighs the same); K: the town's
// added castle HP and cannon damage.
const PS = P.matchmaking.powerScore;
export function powerScore(setup: BattleSetup): number {
  const p = setup.progress ?? null, hand = handOf(setup), pool = hand.filter((c) => setup.picks.includes(c)), fixed = hand.filter((c) => !pool.includes(c));
  const wFixed = PS.fixedWeight * Math.max(pool.length, PS.drawSlots), v = (c: string) => { const k = statPct(p, c); return k.hp * k.dmg; };
  let num = 0, den = 0;
  for (const c of fixed) { num += wFixed * v(c); den += wFixed * 10000; }
  for (const c of pool) { num += PS.drawSlots * v(c); den += PS.drawSlots * 10000; }
  const a6 = div(num * 1000000, den), t = townBonus(p);
  const kDen = 100 * B.castle.hp * B.cannon.dmg, kNum = kDen + PS.castleHpWeightPct * t.castleHp * B.cannon.dmg + PS.cannonDmgWeightPct * t.cannonDmg * B.castle.hp;
  const x = a6 * kNum, y = kDen * div(1000000, PS.base);
  return div(2 * x + y, 2 * y);
}
// The card level (1..max) for a side whose power at each level is powerAt(level): the one closest to target, and its ratio
// max/min as integer % (the casual AI, matchmaking.md §5.4: kept under progression.json matchmaking.casual.powerRatioMaxPct).
export const powerRatioMaxPct = P.matchmaking.casual.powerRatioMaxPct as number;
export function matchLevel(target: number, powerAt: (level: number) => number): { level: number; power: number; ratioPct: number } {
  let best = { level: 1, power: powerAt(1), ratioPct: 0 };
  const ratio = (a: number) => div(100 * Math.max(a, target), Math.max(1, Math.min(a, target)));
  best.ratioPct = ratio(best.power);
  for (let lv = 2; lv <= progression.maxLevel; lv++) {
    const pw = powerAt(lv), r = ratio(pw);
    if (r < best.ratioPct) best = { level: lv, power: pw, ratioPct: r };
  }
  return best;
}

// What a match pays the player: won true/false, null for a draw; type is the battle.json results key of a win.
export const rewardFor = (won: boolean | null, type: string): Reward =>
  won === null ? progression.rewards.draw : won ? progression.rewards.win.get(type) ?? progression.rewards.draw : progression.rewards.loss;
export const forgeOf = (id: string) => forgeSlot.get(id);

// ศึกฝีมือ ladder (progression.json > ranked): league (index), division (divisions..1, 1 the top), stars in the division,
// the win streak, and points in a league without stars (เทพยุทธ์). The hidden MMR, mmrBoost and star protection wait for
// the M1 server.
export interface League { id: string; nameTh: string; divisions: number; stars: number; loseStars: boolean; streakBonus: boolean; floor: boolean }
export interface Rank { league: number; div: number; stars: number; streak: number; points: number }
const R = P.ranked;
export const leagues = R.leagues as League[];
export const startRank = (): Rank => ({ league: 0, div: leagues[0]!.divisions, stars: 0, streak: 0, points: 0 });

export function rankAfter(r: Rank, won: boolean | null): Rank {
  const n = { ...r };
  if (won === null) { n.streak = 0; return n; }
  const L = leagues[n.league]!;
  if (won) {
    n.streak++;
    if (L.stars === 0) { n.points += R.legendPoints.win as number; return n; }
    const gain = 1 + (L.streakBonus && n.streak >= (R.streakLength as number) ? 1 : 0);
    for (let i = 0; i < gain; i++) {
      const cur = leagues[n.league]!;
      if (cur.stars === 0) break;
      if (++n.stars <= cur.stars) continue;
      if (n.div > 1) { n.div--; n.stars = 1; continue; }
      if (n.league + 1 >= leagues.length) { n.stars = cur.stars; break; }
      n.league++;
      n.div = leagues[n.league]!.divisions;
      n.stars = leagues[n.league]!.stars === 0 ? 0 : 1;
    }
    return n;
  }
  n.streak = 0;
  if (L.stars === 0) { n.points = Math.max(0, n.points + (R.legendPoints.loss as number)); return n; }
  if (!L.loseStars) return n;
  if (n.stars > 0) n.stars--;
  else if (n.div < L.divisions) { n.div++; n.stars = L.stars - 1; }
  else if (!L.floor && n.league > 0) { n.league--; n.div = 1; n.stars = leagues[n.league]!.stars - 1; }
  return n;
}
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
export const rankName = (r: Rank) => { const L = leagues[r.league]!; return L.stars === 0 ? `${L.nameTh} ${r.points} แต้ม` : `${L.nameTh} ${ROMAN[r.div]} · ${r.stars}/${L.stars} ดาว`; };
