// Which lobby features a save has opened (progression.json > unlocks, ui-flow.md §4). Computed from the save every time:
// stage wins, the castle level, and evidence that an older save already used a feature. Nothing new is stored.
import { castleLevelOf, chapter, stages } from '@five-sects/sim';
import progressionJson from '../../../docs/data/progression.json';
import { levelSum, type Profile } from './profile';

export type Feature = 'levelUp' | 'casual' | 'forge' | 'eggShop' | 'town' | 'ranked';
export interface Unlock { id: Feature; nameTh: string; stage?: string; chapter?: string; castleLevel?: number }
export const UNLOCKS = progressionJson.unlocks.features as Unlock[];

export const won = (p: Profile, stage: string) => p.campaign[stage]?.stars[0] === true;
const chapterWon = (p: Profile) => stages.every((s) => won(p, s.id)); // one chapter so far: every stage is in it

const USED: Record<Feature, (p: Profile) => boolean> = {
  levelUp: (p) => Object.values(p.cards).some((c) => c.level > 1),
  casual: () => false,
  forge: (p) => Object.keys(p.forge).length > 0,
  eggShop: (p) => Object.values(p.cards).some((c) => c.dupes > 0),
  town: (p) => p.town.cannon + p.town.wall > 0,
  ranked: (p) => p.lastRanked != null,
};

function met(p: Profile, u: Unlock): boolean {
  if (u.stage != null && !won(p, u.stage)) return false;
  if (u.chapter != null && (u.chapter !== chapter.id || !chapterWon(p))) return false;
  if (u.castleLevel != null && castleLevelOf(levelSum(p)) < u.castleLevel) return false;
  return true;
}

// open: the features this save has; next: the first locked one, shown as a locked button with its condition.
export function unlockState(p: Profile): { open: Set<Feature>; next: Unlock | null } {
  const open = new Set(UNLOCKS.filter((u) => met(p, u) || USED[u.id](p)).map((u) => u.id));
  return { open, next: UNLOCKS.find((u) => !open.has(u.id)) ?? null };
}

export function conditionTh(u: Unlock): string {
  if (u.stage != null) return `ผ่านด่าน ${u.stage}`;
  if (u.chapter != null) return `ผ่าน${chapter.nameTh.split(' · ')[0]}`;
  return `ปราสาท Lv${u.castleLevel}`;
}

// The ศึกปราบ stage to play next: the first one not yet won, or null once the chapter is done.
export const nextStage = (p: Profile) => stages.find((s) => !won(p, s.id)) ?? null;
