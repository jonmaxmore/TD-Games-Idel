// The player's save and the front-flow state machine (docs/specs/SPEC-front-flow.md §2, SPEC-core §6).
// route() is the only place that decides where a player belongs; every screen's "done" saves and calls it.
import { rosterSects, sects, stages } from '@five-sects/sim';

export const TUTORIAL = 'T-0';
export const PLAYLIST = ['1-1', '1-2', '1-4', '1-6', '1-12']; // chapter 1 story: only the defend stages exist yet

export interface Profile {
  v: 1;
  consented: boolean;
  birthYear: number | null; // null until the player picks one: never assume an adult
  introSeen: boolean;
  tutorialDone: boolean;
  sect: string | null;
  name: string | null;
  cleared: string[];
  stars: Record<string, number>; // best per stage
  settings: Settings;
}

export interface Settings { volume: number; muted: boolean; shake: boolean } // volume 0..100

export type LobbyTab = 'home' | 'battle' | 'disciples';
export type Screen =
  | { k: 'consent' }
  | { k: 'intro'; page: number }
  | { k: 'battle'; stageId: string }
  | { k: 'sectPick' }
  | { k: 'sectDetail'; sect: string; confirm: boolean }
  | { k: 'name' }
  | { k: 'lobby'; tab: LobbyTab };

export function route(p: Profile): Screen {
  if (!p.consented) return { k: 'consent' };
  if (!p.introSeen) return { k: 'intro', page: 0 };
  if (!p.tutorialDone) return { k: 'battle', stageId: TUTORIAL };
  if (!p.sect) return { k: 'sectPick' };
  if (!p.name) return { k: 'name' };
  return { k: 'lobby', tab: 'home' };
}

// Any stored value (old version, hand-edited, renamed data) to a valid Profile: unknown sects and stages are dropped,
// so the player lands back on the matching step instead of a broken screen.
export function migrate(raw: unknown): Profile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' && x.length > 0 ? x : null);
  const sect = str(r.sect);
  const stars: Record<string, number> = {};
  if (r.stars && typeof r.stars === 'object')
    for (const [id, n] of Object.entries(r.stars as Record<string, unknown>)) if (stages.has(id) && typeof n === 'number' && n > 0) stars[id] = n;
  const st = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>;
  const vol = st.volume;
  return {
    v: 1,
    consented: r.consented === true,
    birthYear: typeof r.birthYear === 'number' ? r.birthYear : null,
    introSeen: r.introSeen === true,
    tutorialDone: r.tutorialDone === true,
    sect: sect && sects.has(sect) && rosterSects.includes(sect) ? sect : null,
    name: str(r.name),
    cleared: Array.isArray(r.cleared) ? [...new Set(r.cleared.filter((id): id is string => typeof id === 'string' && stages.has(id)))] : [],
    stars,
    settings: { volume: typeof vol === 'number' && vol >= 0 && vol <= 100 ? Math.round(vol) : 70, muted: st.muted === true, shake: st.shake !== false },
  };
}

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

export function recordEnd(p: Profile, stageId: string, won: boolean, stars: boolean[]): void {
  if (stageId === TUTORIAL) { p.tutorialDone = true; return; }
  if (!won) return;
  if (!p.cleared.includes(stageId)) p.cleared.push(stageId);
  p.stars[stageId] = Math.max(p.stars[stageId] ?? 0, stars.filter(Boolean).length);
}

export const nextStage = (p: Profile) => PLAYLIST.find((id) => !p.cleared.includes(id)) ?? PLAYLIST[PLAYLIST.length - 1]!;
export const chapterStars = (p: Profile) => PLAYLIST.reduce((n, id) => n + (p.stars[id] ?? 0), 0);
export const chapterStarsMax = () => PLAYLIST.reduce((n, id) => n + stages.get(id)!.stars.length, 0);
