// Loads docs/data and converts to integer sim units:
// distance = milli-tiles, time = ticks (20 Hz), speed = milli-tiles per tick.
import sectsJson from '../../../docs/data/sects.json';
import enemiesJson from '../../../docs/data/enemies.json';
import stagesJson from '../../../docs/data/stages.json';
import economyJson from '../../../docs/data/economy.json';

export const TICK_HZ = 20;
export const TILE = 1000;

export type Wuxing = 'metal' | 'wood' | 'water' | 'fire' | 'earth';
export type Element = Wuxing | 'yinyang';

export interface SectDef {
  element: Element;
  nameTh: string;
  color: string;
  cost: number;
  dmg: number;
  cooldown: number;
  range: number;
  hitsAir: boolean;
  hitsGround: boolean;
}

export interface EnemyDef {
  id: string;
  nameTh: string;
  element: Element;
  air: boolean;
  hp: number;
  speed: number;
  bounty: number;
}

export interface ComboDef {
  id: string;
  nameTh: string;
  from: [Wuxing, Wuxing];
}

export interface StageDef {
  id: string;
  chapter: number;
  type: string;
  title?: string;
  layout?: string;
  waves?: number;
  startSilver?: number;
  enemies: string[];
  stars: string[];
  unlocksSect?: string;
  unlockAll?: boolean;
}

const ticks = (sec: number) => Math.round(sec * TICK_HZ);

export const SECTS: Record<Element, SectDef> = Object.fromEntries(
  sectsJson.sects.map((s) => [
    s.element,
    {
      element: s.element as Element,
      nameTh: s.nameTh,
      color: s.color,
      cost: s.cost,
      dmg: s.dmg,
      cooldown: ticks(1 / s.rate),
      range: Math.round(s.range * TILE),
      hitsAir: s.target.includes('air'),
      hitsGround: s.target.includes('ground'),
    },
  ]),
) as Record<Element, SectDef>;

export const SECT_ORDER: Element[] = sectsJson.sects.map((s) => s.element as Element);

export const GENERATES = sectsJson.wuxing.generates as Record<Wuxing, Wuxing>;
export const OVERCOMES = sectsJson.wuxing.overcomes as Record<Wuxing, Wuxing>;

export const COMBOS: ComboDef[] = sectsJson.comboTechniques.items.map((c) => ({
  id: c.id,
  nameTh: c.nameTh,
  from: c.from as [Wuxing, Wuxing],
}));

export const UPGRADE = {
  levels: sectsJson.upgrade.levels,
  // percent multipliers, e.g. [100, 150, 225]
  costPct: sectsJson.upgrade.costMultiplier.map((m) => Math.round(m * 100)),
  statPct: sectsJson.upgrade.statMultiplier.map((m) => Math.round(m * 100)),
};

const allEnemies = [...enemiesJson.enemies, ...enemiesJson.bosses];
export const ENEMIES: Record<string, EnemyDef> = Object.fromEntries(
  allEnemies.map((e) => [
    e.id,
    {
      id: e.id,
      nameTh: e.nameTh,
      element: e.element as Element,
      air: 'layer' in e && e.layer === 'air',
      hp: e.hp,
      speed: Math.round((e.speed * TILE) / TICK_HZ),
      bounty: 'bounty' in e ? (e.bounty as number) : 50,
    },
  ]),
);

export const STAGES: Record<string, StageDef> = Object.fromEntries(
  (stagesJson.stages as StageDef[]).map((s) => [s.id, s]),
);

const inRun = economyJson.inRun;
export const ECONOMY = {
  startLives: inRun.startLives,
  interestPct: inRun.interestPct,
  interestCap: inRun.interestCap,
  sellRefundPct: inRun.sellRefundPct,
  waveBreak: ticks(inRun.waveBreakSec),
  spawnInterval: ticks(inRun.spawnIntervalSec),
  earlyCallBonus: inRun.earlyCallBonusSilver,
  bountyGrowthPct: inRun.bountyGrowthPctPerWave,
};

// HP at wave w (1-based): hp * (1 + 0.18w) * 1.06^max(0, w-10), in integer math (no Math.pow).
export function waveHp(baseHp: number, wave: number): number {
  let bp = 10000 + 1800 * wave;
  for (let i = 10; i < wave; i++) bp = Math.floor((bp * 106) / 100);
  return Math.floor((baseHp * bp) / 10000);
}
