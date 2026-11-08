// ศึกปราบ stages (campaign.json, SPEC-castle-battle §13): each stage's enemy team at its level, the rules createBattle takes
// (both sides' start mana, the fort bonus, the enemy's regen, the fort layout, the gimmicks), its three star goals and what
// it pays. Integer sim units, like data.ts.
import campaignJson from '../../../docs/data/campaign.json';
import { battle as B, battleCardIds, battleUnits, ticks, TILE, type BattleUnitDef } from './data';
import { fixedHand, sectCards, type BattleSetup, type BattleState, type StageRules, type Wave } from './battle';
import type { Reward } from './progression';

/* eslint-disable @typescript-eslint/no-explicit-any */
const C = campaignJson as any;

// A star goal; each needs the win. castleHp: our castle ends with at least pct % of its max HP; under: won before sec;
// total: won with every fort ours (battle.json results.total); kills: won with at least n enemy units killed.
export type StarGoal = { kind: 'win' } | { kind: 'castleHp'; pct: number } | { kind: 'under'; sec: number } | { kind: 'total' } | { kind: 'kills'; n: number };
// What a first clear pays: a card, the home sect's card of a role (collection.json homeRoleCards), or egg points.
export type FirstClear = { card: string } | { homeRole: string } | { eggPoints: number };
export interface Gimmick { kind: string; nameTh: string; descTh: string }
export interface Stage {
  id: string; nameTh: string; briefTh: string; teachTh: string; boss: boolean; gimmicks: Gimmick[];
  level: number; enemy: BattleSetup; rules: StageRules; stars: [StarGoal, StarGoal, StarGoal];
  rewards: { win: Reward; firstClear: FirstClear };
}
export const chapter = C.chapter as { id: string; nameTh: string };
const starNames = C.starNamesTh as Record<string, string>;
export const starName = (g: StarGoal) => starNames[g.kind]!.replace('{pct}', String((g as any).pct)).replace('{sec}', String((g as any).sec)).replace('{n}', String((g as any).n));

// A wave entry: count units of card from sec (own depth tiles, each next one 0.5 tiles further back), again every everySec
// while the match runs; warnSec: the warning before each.
function waves(list: any[]): Wave[] {
  const out: Wave[] = [];
  for (const w of list)
    for (let sec = w.sec; ticks(sec) < B.matchTicks; sec += w.everySec ?? B.matchTicks) {
      for (let k = 0; k < (w.count ?? 1); k++) out.push({ tick: ticks(sec), card: w.card, d: Math.round(((w.tiles ?? 1) + k * 0.5) * TILE), warn: ticks(w.warnSec ?? 0) });
      if (w.everySec == null) break;
    }
  return out.sort((a, b) => a.tick - b.tick);
}

function rules(s: any): StageRules {
  const g = (kind: string, side?: string) => (s.gimmicks as any[]).find((x) => x.kind === kind && (side == null || (x.side ?? 'enemy') === side));
  for (const x of s.gimmicks as any[]) if (!['castle', 'waves', 'noCannon', 'bloodMoon'].includes(x.kind)) throw new Error(`campaign.json ${s.id}: unknown gimmick ${x.kind}`);
  return {
    manaStart: [s.mana.start, s.mana.enemyStart], regenPct: s.mana.enemyRegenPct, fortBonus: s.mana.fortBonus, fortsAtPct: s.fortsAtPct,
    castleHpPct: [g('castle', 'player')?.hpPct ?? 100, g('castle', 'enemy')?.hpPct ?? 100],
    waves: waves(g('waves')?.waves ?? []), noCannon: g('noCannon') != null, enemyDmgPct: g('bloodMoon')?.dmgPct ?? 100,
  };
}

export const stages: Stage[] = (C.stages as any[]).map((s) => {
  const cards: string[] = typeof s.enemy.cards === 'string' ? sectCards(s.enemy.cards) : s.enemy.cards;
  return {
    id: s.id, nameTh: s.nameTh, briefTh: s.briefTh, teachTh: s.teachTh, boss: s.boss === true, level: s.enemy.level,
    gimmicks: (s.gimmicks as any[]).map((x) => ({ kind: x.kind, nameTh: x.nameTh, descTh: x.descTh })),
    enemy: { ...(s.enemy.leader ? { leader: s.enemy.leader, sub: s.enemy.sub, collection: cards, bench: [] } : fixedHand(cards)), progress: { levels: Object.fromEntries(battleCardIds.map((c) => [c, s.enemy.level])) } },
    rules: rules(s), stars: (s.stars ?? C.stars) as [StarGoal, StarGoal, StarGoal],
    rewards: { win: s.rewards.win as Reward, firstClear: s.rewards.firstClear as FirstClear },
  };
});
export const stageOf = (id: string) => stages.find((s) => s.id === id);
export const gimmickNames = (st: Stage) => st.gimmicks.map((g) => g.nameTh).join(' · ');
// Every card a stage names, for the data check: the enemy's leaders and cards, and its wave units.
export function stageCards(st: Stage): BattleUnitDef[] {
  return [st.enemy.leader, st.enemy.sub, ...st.enemy.collection, ...st.rules.waves.map((w) => w.card)].filter((c) => c !== '').map((c) => battleUnits.get(c)!);
}

// The stars a finished stage match earns the player (side 0), one per goal of the stage.
export function starsOf(s: BattleState, st: Stage): [boolean, boolean, boolean] {
  const won = s.winner === 0, c = s.castles[0];
  const met = (g: StarGoal): boolean => {
    if (!won) return false;
    if (g.kind === 'castleHp') return c.hp * 100 >= g.pct * c.maxHp;
    if (g.kind === 'under') return s.tick < ticks(g.sec);
    if (g.kind === 'total') return s.forts.every((f) => f.owner === 0);
    if (g.kind === 'kills') return s.kills[0] >= g.n;
    return true;
  };
  return st.stars.map(met) as [boolean, boolean, boolean];
}
