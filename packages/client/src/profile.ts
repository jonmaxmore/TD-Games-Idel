// The player's save: settings, the home sect (เลือกสำนักแรก), the cards owned, the saved decks and which one is in use, the match mode, the
// account (card levels and xp, forge items, town tiers, coins, gold, egg points), ศึกปราบ stars and best times, the rewards
// already paid (first clears, chapter stars), the ศึกฝีมือ rank and the last ranked match for its replay. Anything stored
// that no longer fits the data (an old TD save, an old deck save, a renamed card, a bad number) falls back to defaults field
// by field instead of a broken screen.
import { battleCardIds, castleLevelOf, collection, homeSects, leagues, progression, stages, starterCards, startRank, type BattleRecord, type Rank } from '@five-sects/sim';
import { DECK_SLOTS, fixDecks, healTeam, type SavedDeck, type Team } from './decks';

export type Mode = 'casual' | 'ranked'; // ศึกทั่วไป (progression applies) | ศึกฝีมือ (normalized)
export interface CardProgress { level: number; xp: number; dupes: number } // dupes: training eggs bought
export interface StageBest { stars: [boolean, boolean, boolean]; bestSec: number | null } // stars: each goal ever reached; bestSec: fastest win
export interface Profile {
  v: 7;
  home: string | null; // the home sect, null until the first-run pick
  owned: string[]; // the cards the account owns, in data order
  claimed: string[]; // rewards already paid: stage ids (first clear) and chapter-star keys ("ch1:15")
  decks: SavedDeck[]; // DECK_SLOTS named teams, saved as they are edited
  deck: number; // the saved deck in use
  settings: Settings;
  mode: Mode;
  cards: Record<string, CardProgress>; // every card, by id (owned or not)
  forge: Record<string, Record<string, number>>; // card -> slot -> epoch ms the item is done (built once that time passes)
  town: { cannon: number; wall: number };
  coins: number; gold: number; eggPoints: number;
  castleLevel: number; // the highest castle level already paid out in egg points
  campaign: Record<string, StageBest>; // stages played, by id
  rank: Rank;
  lastRanked: RankedSave | null;
}
export type RankedSave = BattleRecord & { hash: string; endTick?: number }; // the last ranked match, the hash it ended on, the tick of a surrender

export interface Settings { volume: number; muted: boolean; shake: boolean } // volume 0..100

const obj = (x: unknown) => (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
const int = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi ? x : d);
const BIG = 1e9;

// v6 and older had every card: such a save keeps the starter set plus every card it levelled, played (xp), trained or forged.
function legacyOwned(cards: Record<string, CardProgress>, forge: Record<string, unknown>): string[] {
  return battleCardIds.filter((c) => cards[c]!.level > 1 || cards[c]!.xp > 0 || cards[c]!.dupes > 0 || c in forge);
}

export function migrate(raw: unknown): Profile {
  const r = obj(raw), st = obj(r.settings), vol = st.volume, cards = obj(r.cards), forge = obj(r.forge), town = obj(r.town);
  const v7 = r.v === 7, home = typeof r.home === 'string' && homeSects.includes(r.home) ? r.home : null;
  const p: Profile = {
    v: 7, home, owned: [], claimed: [],
    decks: [], deck: 0,
    settings: { volume: typeof vol === 'number' && vol >= 0 && vol <= 100 ? Math.round(vol) : 70, muted: st.muted === true, shake: st.shake !== false },
    mode: r.mode === 'ranked' ? 'ranked' : 'casual',
    cards: Object.fromEntries(battleCardIds.map((id) => {
      const c = obj(cards[id]), level = int(c.level, 1, progression.maxLevel, 1);
      return [id, { level, xp: level >= progression.maxLevel ? 0 : int(c.xp, 0, BIG, 0), dupes: int(c.dupes, 0, BIG, 0) }];
    })),
    forge: Object.fromEntries(battleCardIds.flatMap((id) => {
      const f = obj(forge[id]), slots = progression.forge.filter((s) => typeof f[s.id] === 'number' && Number.isFinite(f[s.id])).map((s) => [s.id, f[s.id] as number]);
      return slots.length > 0 ? [[id, Object.fromEntries(slots)]] : [];
    })),
    town: { cannon: int(town.cannon, 0, progression.cannonTiers.length, 0), wall: int(town.wall, 0, progression.wallTiers.length, 0) },
    coins: int(r.coins, 0, BIG, 0), gold: int(r.gold, 0, BIG, 0), eggPoints: int(r.eggPoints, 0, BIG, 0),
    castleLevel: 1,
    campaign: Object.fromEntries(stages.flatMap((s) => {
      const c = obj(obj(r.campaign)[s.id]), stars = Array.isArray(c.stars) ? c.stars : [];
      if (stars.length !== 3) return [];
      return [[s.id, { stars: stars.map((x) => x === true) as [boolean, boolean, boolean], bestSec: int(c.bestSec, 0, BIG, -1) < 0 ? null : (c.bestSec as number) }]];
    })),
    rank: fixRank(r.rank),
    lastRanked: fixRecord(r.lastRanked),
  };
  const kept = v7 && Array.isArray(r.owned) ? r.owned : legacyOwned(p.cards, p.forge);
  const own = new Set([...collection.starter, ...(home ? starterCards(home) : []), ...kept.filter((c): c is string => typeof c === 'string')]);
  p.owned = battleCardIds.filter((c) => own.has(c));
  p.claimed = v7 && Array.isArray(r.claimed) ? r.claimed.filter((x): x is string => typeof x === 'string') : [];
  p.decks = fixDecks(r.decks, r.team, p.owned, home).map((d) => ({ ...d, team: healTeam(d.team, p.owned) }));
  p.deck = int(r.deck, 0, DECK_SLOTS - 1, 0);
  p.castleLevel = Math.min(int(r.castleLevel, 1, progression.castleLevels.length, 1), castleLevelOf(levelSum(p)));
  return p;
}
// A rank inside the ladder's bounds, else the starting rank.
function fixRank(raw: unknown): Rank {
  const r = obj(raw), league = int(r.league, 0, leagues.length - 1, -1);
  if (league < 0) return startRank();
  const L = leagues[league]!;
  return { league, div: int(r.div, 1, L.divisions, L.divisions), stars: int(r.stars, 0, L.stars, 0), streak: int(r.streak, 0, BIG, 0), points: int(r.points, 0, BIG, 0) };
}
// The saved match is replayed as stored; one that is not even shaped like a record is dropped.
function fixRecord(raw: unknown): RankedSave | null {
  const r = obj(raw);
  const ok = typeof r.seed === 'number' && Array.isArray(r.setups) && r.setups.length === 2 && r.setups.every((s) => Array.isArray(obj(s).picks)) && r.commands && typeof r.commands === 'object' && r.opts && typeof r.opts === 'object' && typeof r.hash === 'string';
  if (!ok) return null;
  const { endTick, ...rest } = r;
  return { ...(rest as unknown as RankedSave), ...(Number.isInteger(endTick) && (endTick as number) >= 0 ? { endTick: endTick as number } : {}) };
}
// The team of the saved deck in use, and setting it (the caller saves).
export const teamOf = (p: Profile): Team => p.decks[p.deck]!.team;
export const setTeam = (p: Profile, t: Team) => { p.decks[p.deck] = { ...p.decks[p.deck]!, team: t }; };
// The castle level's card-level sum: every owned card's level.
export const levelSum = (p: Profile) => p.owned.reduce((a, id) => a + p.cards[id]!.level, 0);

const KEY = 'five-sects.profile';
let memory: string | null = null; // private mode can make localStorage throw; the save then lives for this page only

export function load(): Profile {
  let text = memory;
  try { text = localStorage.getItem(KEY); } catch { /* use memory */ }
  try { return migrate(text ? JSON.parse(text) : null); } catch { return migrate(null); }
}

export function save(p: Profile): void {
  memory = JSON.stringify(p);
  try { localStorage.setItem(KEY, memory); } catch { /* memory only */ }
}
