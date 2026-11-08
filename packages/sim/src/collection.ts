// Card acquisition (collection.json, docs/design/acquisition.md): which cards an account owns from the start, the one route
// each other card comes by, and the egg shop's prices and gates. Out-of-match account rules, here so a server re-runs them.
// Lookups are Maps; anything iterated is an array in data order.
import collectionJson from '../../../docs/data/collection.json';
import { battleCardIds } from './data';
import { stages, type FirstClear, type Stage } from './campaign';

/* eslint-disable @typescript-eslint/no-explicit-any */
const K = collectionJson as any;

export type TierId = 'basic' | 'common' | 'adept' | 'elite' | 'legendary';
export interface Tier { id: TierId; nameTh: string; eggPoints: number | null; eggShopFromCastleLevel: number | null; dupeXp: number }
export const tiers = new Map<TierId, Tier>(Object.keys(K.tiers).map((id) => [id as TierId, { id: id as TierId, ...K.tiers[id] }]));
const cardTier = new Map<string, TierId>(Object.entries(K.cardTier as Record<string, TierId>));
export const tierOf = (card: string): Tier => tiers.get(cardTier.get(card)!)!;
export const homeSects: string[] = Object.keys(K.homeRoleCards);
const roleCards = new Map<string, Map<string, string>>(homeSects.map((h) => [h, new Map(Object.entries(K.homeRoleCards[h] as Record<string, string>))]));
export const homeCard = (home: string, role: string) => roleCards.get(home)?.get(role) ?? null;
export const collection = {
  starter: K.starter as string[], homeStarterRoles: K.homeStarterRoles as string[], starterTeam: K.starterTeam as { leader: string; sub: string },
  shopAfter: K.eggShop.opensAfterStage as string,
  chapterStars: new Map<string, { stars: number; eggPoints?: number; card?: string }[]>(Object.entries(K.chapterStars)),
  planned: new Map<string, string>(Object.entries(K.plannedRoutes as Record<string, string>).filter(([k]) => k !== '_notes')),
};
// Ranked ศึกฝีมือ draws from every card, whatever an account owns (collection.json rankedPool).
export const rankedPool: readonly string[] = battleCardIds;

// A new account's cards for its home sect: the starter set and the home sect's starter roles, in data order.
export function starterCards(home: string): string[] {
  const own = new Set([...collection.starter, ...collection.homeStarterRoles.map((r) => homeCard(home, r)!)]);
  return battleCardIds.filter((c) => own.has(c));
}
export const starterTeam = (home: string) => ({ leader: homeCard(home, collection.starterTeam.leader)!, sub: homeCard(home, collection.starterTeam.sub)! });

// The card a first clear names for a home sect (null: it pays egg points).
export function rewardCard(r: FirstClear, home: string): string | null {
  if ('card' in r) return r.card;
  if ('homeRole' in r) return homeCard(home, r.homeRole);
  return null;
}
// What the first clear of a stage pays an account that owns owned: a new card, or egg points (a reward of egg points, or a
// card already owned paying its tier's egg price).
export function firstClearPay(st: Stage, home: string, owned: readonly string[]): { card: string | null; eggPoints: number } {
  const r = st.rewards.firstClear, card = rewardCard(r, home);
  if (card == null) return { card: null, eggPoints: 'eggPoints' in r ? r.eggPoints : 0 };
  return owned.includes(card) ? { card: null, eggPoints: tierOf(card).eggPoints ?? 0 } : { card, eggPoints: 0 };
}
// The cards a home sect owns when it first plays stage i (every stage before it cleared once), in data order.
export function ownedAt(home: string, i: number): string[] {
  const own = starterCards(home);
  for (const st of stages.slice(0, i)) { const p = firstClearPay(st, home, own); if (p.card) own.push(p.card); }
  return battleCardIds.filter((c) => own.includes(c));
}

// How a card is got, for a home sect: starter (everyone), home (the home sect's starter roles), a stage's first clear, a
// chapter's star total, or the egg shop at its tier (planned: the route designed for it once that content exists).
export type Route =
  | { kind: 'starter' } | { kind: 'home' } | { kind: 'stage'; stage: string } | { kind: 'stars'; chapter: string; stars: number }
  | { kind: 'shop'; price: number; castleLevel: number; planned: string | null };
export function routeOf(card: string, home: string): Route {
  if (collection.starter.includes(card)) return { kind: 'starter' };
  if (collection.homeStarterRoles.some((r) => homeCard(home, r) === card)) return { kind: 'home' };
  const st = stages.find((s) => rewardCard(s.rewards.firstClear, home) === card);
  if (st) return { kind: 'stage', stage: st.id };
  for (const [ch, steps] of collection.chapterStars) for (const x of steps) if (x.card === card) return { kind: 'stars', chapter: ch, stars: x.stars };
  const t = tierOf(card);
  return { kind: 'shop', price: t.eggPoints!, castleLevel: t.eggShopFromCastleLevel!, planned: collection.planned.get(card) ?? null };
}

// Why a card cannot be bought now (null: it can). An owned card sells as a training egg (its tier's dupeXp) at the same
// price; a card with a non-shop route is only sold once owned.
export interface Account { home: string; owned: readonly string[]; castleLevel: number; eggPoints: number; won: (stage: string) => boolean }
export function shopBlock(a: Account, card: string): 'notForSale' | 'shopClosed' | 'castleLevel' | 'eggPoints' | null {
  const t = tierOf(card), owned = a.owned.includes(card);
  if (t.eggPoints == null || (!owned && routeOf(card, a.home).kind !== 'shop')) return 'notForSale';
  if (!a.won(collection.shopAfter)) return 'shopClosed';
  if (a.castleLevel < t.eggShopFromCastleLevel!) return 'castleLevel';
  if (a.eggPoints < t.eggPoints) return 'eggPoints';
  return null;
}
// Chapter star rewards an account with this many stars in the chapter has reached, as keys "ch:stars" and their pay.
export function starRewards(chapter: string, stars: number): { key: string; eggPoints: number; card: string | null }[] {
  return (collection.chapterStars.get(chapter) ?? []).filter((x) => stars >= x.stars).map((x) => ({ key: `${chapter}:${x.stars}`, eggPoints: x.eggPoints ?? 0, card: x.card ?? null }));
}
