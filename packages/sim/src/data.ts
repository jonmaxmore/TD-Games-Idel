// Loads docs/data and converts to integer sim units:
// distance = milli-tiles, time = ticks (20 Hz), speed = milli-tiles per tick.
import sectsJson from '../../../docs/data/sects.json';
import enemiesJson from '../../../docs/data/enemies.json';
import stagesJson from '../../../docs/data/stages.json';
import economyJson from '../../../docs/data/economy.json';
import itemsJson from '../../../docs/data/items.json';

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
  traitTh: string;
  leakCost: number;
  boss: BossMechanics | null;
}

export interface BossMechanics {
  effect: 'disable' | 'seal' | 'absorb';
  phasesPct: number[];
  count: number;
  ticks: number;
}

export interface WaveRecipe { id: string; nameTh: string; types: string[]; countPct: number; hpPct: number }

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
  variant?: string;
  waves?: number;
  startSilver?: number;
  enemies: string[];
  stars: string[];
  unlocksSect?: string;
  unlockAll?: boolean;
  guestSects?: string[];
  scriptedWaves?: Record<string, string>;
  wavePool?: string[];
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

export const MERGE_FEE: number = sectsJson.comboTechniques.mergeFee;

export const UPGRADE = {
  levels: sectsJson.upgrade.levels,
  names: sectsJson.upgrade.names,
  // percent multipliers, e.g. [100, 150, 225]
  costPct: sectsJson.upgrade.costMultiplier.map((m) => Math.round(m * 100)),
  statPct: sectsJson.upgrade.statMultiplier.map((m) => Math.round(m * 100)),
};

function bossMechanics(m: Record<string, unknown>): BossMechanics {
  return {
    effect: m.effect as BossMechanics['effect'],
    phasesPct: (m.phasesPct as number[]) ?? [],
    count: Number(m.count ?? 1),
    ticks: ticks(Number(m.sec ?? 0)),
  };
}

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
      traitTh: 'traitTh' in e ? String(e.traitTh) : '',
      leakCost: 'leakCost' in e ? (e.leakCost as number) : 1,
      boss: 'mechanics' in e ? bossMechanics(e.mechanics as Record<string, unknown>) : null,
    },
  ]),
);

// Wave shapes (enemies.json waveRecipes), in file order; `mixed` is the fallback.
export const WAVE_RECIPES: WaveRecipe[] = Object.entries(enemiesJson.waveRecipes)
  .filter(([k]) => !k.startsWith('_'))
  .map(([id, v]) => {
    const r = v as { nameTh: string; types: string[]; countPct: number; hpPct: number };
    return { id, nameTh: r.nameTh, types: r.types, countPct: r.countPct, hpPct: r.hpPct };
  });

export const STAGES: Record<string, StageDef> = Object.fromEntries(
  (stagesJson.stages as StageDef[]).map((s) => [s.id, s]),
);

const inRun = economyJson.inRun;
export const ECONOMY = {
  startLives: inRun.startLives,
  interestPct: inRun.interestPct,
  interestCap: inRun.interestCap,
  interestCapPerWave: inRun.interestCapPerWave,
  earlyCallPct: inRun.earlyCallPct,
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

export interface ArtDef {
  id: string;
  nameTh: string;
  glyph: string;
  effect: string;
  effectTh: string;
  type: 'strike' | 'slowAll' | 'bountyMult' | 'stunAll';
  cooldown: number;
  dmg: number;
  radius: number;
  pct: number;
  mult: number;
  duration: number;
  charges: number;
  rechargeSilver: number;
}

export const ARTS: ArtDef[] = itemsJson.secretArts.items.map((a) => {
  const x = a as Record<string, unknown>;
  return {
    id: a.id,
    nameTh: a.nameTh,
    glyph: String(x.glyph ?? ''),
    effect: a.effect,
    effectTh: String(x.effectTh ?? a.effect),
    type: x.effectType as ArtDef['type'],
    cooldown: ticks(a.cooldown),
    dmg: Number(x.dmg ?? 0),
    radius: Math.round(Number(x.radius ?? 0) * TILE),
    pct: Number(x.pct ?? 0),
    mult: Number(x.mult ?? 1),
    duration: ticks(Number(x.durationSec ?? 0)),
    charges: Number(x.charges ?? 0),
    rechargeSilver: Number(x.rechargeSilver ?? 0),
  };
});

export interface CardDef {
  id: string;
  nameTh: string;
  effect: string;
  effectTh: string;
  kind: string;
  element?: Element;
  needs?: Element;
  pct: number;
  value: number;
}

const m = itemsJson.manuals;
export const CARDS: CardDef[] = [...m.damage, ...m.economy, ...m.ruleBender]
  .map((c) => {
    const x = c as Record<string, unknown>;
    return {
      id: c.id, nameTh: c.nameTh, effect: c.effect, effectTh: String(x.effectTh ?? c.effect), kind: String(x.kind),
      element: x.element as Element | undefined, needs: x.needs as Element | undefined,
      pct: Number(x.pct ?? 0), value: Number(x.value ?? 0),
    };
  })
  .filter((c) => c.kind !== 'disabled');

export const CARD_EVERY_WAVES = 5;
export const CARD_AUTO_PICK = ticks(15);

export interface EliteAffix { id: string; nameTh: string; traitTh: string; hpPct: number; speedPct: number; regenPct: number; outline: string }
const el = enemiesJson.elites;
export const ELITES = {
  fromWave: el.eliteFromWave,
  chancePct: el.eliteChancePct,
  bountyMult: el.bountyMult,
  affixes: el.affixes.map((a) => ({
    id: a.id, nameTh: a.nameTh, traitTh: a.traitTh, hpPct: a.hpPct, speedPct: a.speedPct, regenPct: a.regenPctPerSec, outline: a.outline,
  })) as EliteAffix[],
};

export const TARGET_MODES = ['first', 'strong', 'weak', 'close'] as const;
export type TargetMode = (typeof TARGET_MODES)[number];
