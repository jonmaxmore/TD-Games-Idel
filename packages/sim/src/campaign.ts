// ศึกปราบ stages (campaign.json, SPEC-castle-battle §13): each stage's enemy team at its level, the rules createBattle takes
// (enemy mana, fort layout, gimmick), its star goals and what a win pays. Integer sim units, like data.ts.
import campaignJson from '../../../docs/data/campaign.json';
import { battleCardIds, battleUnits, ticks, TILE, type BattleUnitDef } from './data';
import { sectCards, type BattleSetup, type BattleState, type Gimmick, type StageRules } from './battle';
import type { Reward } from './progression';

/* eslint-disable @typescript-eslint/no-explicit-any */
const C = campaignJson as any;

export interface Stage {
  id: string; nameTh: string; briefTh: string; gimmickTh: string; gimmickDescTh: string;
  level: number; enemy: BattleSetup; rules: StageRules; rewards: { win: Reward };
}
export const STARS = C.stars as { castleHpPct: number; winUnderSec: number; namesTh: [string, string, string] };
export const chapter = C.chapter as { id: string; nameTh: string };

function gimmick(g: any): Gimmick {
  if (g.kind === 'castle') return { kind: 'castle', hpPct: g.hpPct };
  if (g.kind === 'noCannon') return { kind: 'noCannon' };
  if (g.kind === 'bloodMoon') return { kind: 'bloodMoon', dmgPct: g.dmgPct };
  if (g.kind === 'waves') return { kind: 'waves', waves: (g.waves as any[]).map((w) => ({ tick: ticks(w.sec), card: w.card, d: Math.round(w.tiles * TILE) })) };
  throw new Error(`campaign.json: unknown gimmick ${g.kind}`);
}

export const stages: Stage[] = (C.stages as any[]).map((s) => {
  const cards: string[] = typeof s.enemy.cards === 'string' ? sectCards(s.enemy.cards) : s.enemy.cards;
  return {
    id: s.id, nameTh: s.nameTh, briefTh: s.briefTh, gimmickTh: s.gimmick.nameTh, gimmickDescTh: s.gimmick.descTh, level: s.enemy.level,
    enemy: { leader: s.enemy.leader, sub: s.enemy.sub, collection: cards, bench: [], progress: { levels: Object.fromEntries(battleCardIds.map((c) => [c, s.enemy.level])) } },
    rules: { manaStart: s.mana.start, regenPct: s.mana.regenPct, fortsAtPct: s.fortsAtPct, gimmick: gimmick(s.gimmick) },
    rewards: { win: s.rewards.win as Reward },
  };
});
export const stageOf = (id: string) => stages.find((s) => s.id === id);
// Every card a stage names, for the data check: the enemy's leaders and cards, and its wave units.
export function stageCards(st: Stage): BattleUnitDef[] {
  const g = st.rules.gimmick, ids = [st.enemy.leader, st.enemy.sub, ...st.enemy.collection, ...(g.kind === 'waves' ? g.waves.map((w) => w.card) : [])];
  return ids.map((c) => battleUnits.get(c)!);
}

// The stars a finished stage match earns the player (side 0): won; won with our castle at castleHpPct or more; won before
// winUnderSec.
export function starsOf(s: BattleState): [boolean, boolean, boolean] {
  const won = s.winner === 0, c = s.castles[0];
  return [won, won && c.hp * 100 >= STARS.castleHpPct * c.maxHp, won && s.tick < ticks(STARS.winUnderSec)];
}
