// Loads docs/data (the source of truth for numbers and names) and converts it to integer sim units:
// distance = milli-tiles, time = ticks (20 Hz), speed = milli-tiles per tick.
// Lookups are Maps (never iterated for game logic); anything the rules iterate is an array in data order.
import sectsJson from '../../../docs/data/sects.json';
import enemiesJson from '../../../docs/data/enemies.json';
import stagesJson from '../../../docs/data/stages.json';
import economyJson from '../../../docs/data/economy.json';
import itemsJson from '../../../docs/data/items.json';
import mapsJson from '../../../docs/data/maps.json';
import effectsJson from '../../../docs/data/effects.json';

export const TICK_HZ = 20;
export const TILE = 1000;
export const ticks = (sec: number) => Math.round(sec * TICK_HZ);

export interface SectDef {
  element: string; nameTh: string; nameEn: string; color: string; role: string;
  cost: number; dmg: number; cooldown: number; range: number; hitsAir: boolean; hitsGround: boolean;
}
// Sect x role disciple (sects.json > roster): fights with its kit's mechanic (element), counts as its sect for Wu Xing.
export interface UnitDef extends SectDef { id: string; sect: string; roleId: string; dot: string | null; descTh: string; descEn: string }
// Tier 3 is a choice between branch a (the original technique) and b, made on the upgrade (SPEC-pc-v2 §5).
export type Branch = 'a' | 'b';
export interface SkillDef { lvl: number; branch: Branch | null; name: string; nameTh: string; effect: string; effectTh: string } // view text
export interface BossMechanics { effect: string; phasesPct: number[]; count: number; ticks: number }
export interface EnemyDef {
  id: string; nameTh: string; nameEn: string; element: string; traitTh: string; traitEn: string;
  air: boolean; hp: number; speed: number; bounty: number; leakCost: number; boss: BossMechanics | null;
}
export interface WaveRecipe { id: string; nameTh: string; types: string[]; needsRoles: string[]; countPct: number; hpPct: number }
export interface RoleDef { id: string; nameTh: string; nameEn: string; doesTh: string; counters: string[] }
export interface ComboDef { id: string; nameTh: string; a: string; b: string }
export interface StageDef {
  id: string; type: string; layout: string | null; variant: string | null; unlocksSect: string | null; nameTh: string; nameEn: string;
  chapter: number; hpPct: number; waves: number | null; startSilver: number | null; startLives: number | null; unlockAll: boolean;
  enemies: string[]; stars: string[]; guestSects: string[]; scriptedWaves: Map<string, string>; wavePool: string[] | null;
  // lanes: wave -> the one lane (0-based path index) open that wave; bossDuel: the boss that comes in wave 1 and decides the stage;
  // bossHpPct, bossSpeedPct: that duel boss's HP and speed as a % of enemies.json (the same boss can appear elsewhere as-is).
  lanes: Map<number, number>; bossDuel: string | null; bossHpPct: number; bossSpeedPct: number;
}
export interface ArtDef {
  id: string; nameTh: string; glyph: string; type: string;
  cooldown: number; dmg: number; radius: number; pct: number; duration: number; charges: number; rechargeSilver: number;
}
// roster false: never offered to a one-sect roster game.
export interface CardDef { id: string; nameTh: string; effectTh: string; kind: string; element: string | null; needs: string | null; pct: number; value: number; roster: boolean }
export interface AllegianceDef { element: string; ruleTh: string; ruleEn: string; difficulty: number }
export interface UpcomingSectDef { id: string; nameTh: string; nameEn: string; opensMonth: number }
export interface EliteAffix { id: string; nameTh: string; hpPct: number; speedPct: number; regenPct: number }

export type Pt = { x: number; y: number };
export interface Prop { type: string; at: Pt }
// paths: every spawn gate's route to the one goal gate; enemies of a wave take them in turn.
export interface MapLayout { kind: string; biome: string; nameTh: string; goalGate: string | null; paths: Pt[][]; props: Prop[] }
// A biome's rule (maps.json > biomes.<id>.rule, SPEC-pc-v2 §3); 0 turns that part off. Distances in milli-tiles.
export interface BiomeRule { roofRangePct: number; leap: number; fogSight: number; iceSpeedPct: number; gateEveryWaves: number; moonEveryWaves: number }
export interface BiomeDef { nameTh: string; time: string; palette: string; moodTh: string; mechanicTh: string; spawnGate: string; goalGate: string; rule: BiomeRule }

/* eslint-disable @typescript-eslint/no-explicit-any */
const J = (x: unknown) => x as any;
const S = sectsJson as any, E = enemiesJson as any, ST = stagesJson as any, EC = economyJson as any, IT = itemsJson as any, M = mapsJson as any, FX = effectsJson as any;

function sectDef(s: any, el: string, color: string): SectDef {
  const target: string = s.target;
  return {
    element: el, nameTh: s.nameTh, nameEn: s.name ?? s.nameEn, color, role: s.role ?? '',
    cost: s.cost, dmg: s.dmg, cooldown: ticks(1.0 / s.rate), range: Math.round(s.range * TILE),
    hitsAir: target.includes('air'), hitsGround: target.includes('ground'),
  };
}

export const sects = new Map<string, SectDef>();
export const skills = new Map<string, SkillDef[]>(); // per element (kit), tiers 1..3
export const sectOrder: string[] = [];
for (const s of S.sects) {
  sects.set(s.element, sectDef(s, s.element, s.color));
  sectOrder.push(s.element);
  skills.set(s.element, (s.skills ?? []).map((k: any) => ({ lvl: k.lvl, branch: k.branch ?? null, name: k.name, nameTh: k.nameTh, effect: k.effect, effectTh: k.effectTh })));
}
export const hasBranchB = (kit: string) => (skills.get(kit) ?? []).some((k) => k.branch === 'b');
// Branch b's numbers (the lvl-3 "b" skill's rule), one kit each.
const ruleOf = (kit: string, branch: string) => S.sects.find((s: any) => s.element === kit).skills.find((k: any) => k.branch === branch).rule;
const ruleB = (kit: string) => ruleOf(kit, 'b');
// Song of Withering (wood tier 3 a): the vulnerability aura, bounded to the disciple's range x auraRangePct.
export const branchA = { woodVulnPct: ruleOf('wood', 'a').vulnPct as number, woodAuraRangePct: ruleOf('wood', 'a').auraRangePct as number };
export const branchB = {
  executeBelowPct: ruleB('metal').belowHpPct as number, executeDmgPct: ruleB('metal').dmgPct as number,
  rootEvery: ticks(ruleB('wood').everySec), rootTicks: ticks(ruleB('wood').rootSec), rootTakenPct: ruleB('wood').takenPct as number,
  freezeEvery: ruleB('water').freezeEvery as number,
  splashPct: ruleB('fire').splashPct as number, burnPct: ruleB('fire').burnPct as number, dpsPct: ruleB('fire').dpsPct as number,
  bellStunPct: ruleB('earth').stunPct as number,
};

export const units = new Map<string, UnitDef>();
export const unitList: UnitDef[] = [];
export const roles: string[] = [];
export const roleDefs = new Map<string, RoleDef>();
export const roleUnlocks: [string, string[]][] = []; // stage id -> roles that join in that stage, in data order
export const rosterSects: string[] = [];
export const sectRules = {
  fireRampPctPerSec: J(S.roster.rules.fire.burnRampPctPerSec) as number,
  fireRampMaxPct: J(S.roster.rules.fire.burnRampMaxPct) as number,
  fireExplodeDmg: J(S.roster.rules.fire.explodeDmg) as number, // the sect's blast when a burning enemy dies (the kit alone: 30)
  woodSpreadRange: Math.round(S.roster.rules.wood.spreadRange * TILE),
  woodSpreadStacks: J(S.roster.rules.wood.spreadStacks) as number,
};
for (const r of S.roster.roles) {
  roles.push(r.id);
  roleDefs.set(r.id, { id: r.id, nameTh: r.nameTh, nameEn: r.nameEn, doesTh: r.doesTh, counters: r.counters ?? [] });
}
for (const k of Object.keys(S.roster.roleUnlocks)) roleUnlocks.push([k, S.roster.roleUnlocks[k]]);
for (const u of S.roster.units) {
  const def: UnitDef = {
    ...sectDef({ ...u, name: u.nameEn }, u.kit, sects.get(u.sect)!.color),
    id: u.id, sect: u.sect, roleId: u.role, dot: u.dot ?? null, descTh: u.descTh, descEn: u.descEn,
  };
  units.set(def.id, def);
  unitList.push(def);
  if (!rosterSects.includes(u.sect)) rosterSects.push(u.sect);
}

export const allegiance: AllegianceDef[] = (S.allegiance?.launch ?? []).map((a: any) => ({ element: a.element, ruleTh: a.ruleTh, ruleEn: a.ruleEn, difficulty: a.difficulty }));
export const upcomingSects: UpcomingSectDef[] = (S.allegiance?.upcoming ?? []).map((u: any) => ({ id: u.id, nameTh: u.nameTh, nameEn: u.nameEn, opensMonth: u.opensMonth }));

export const generates = new Map<string, string>(Object.entries(S.wuxing.generates as Record<string, string>));
export const overcomes = new Map<string, string>(Object.entries(S.wuxing.overcomes as Record<string, string>));
export const overcomePct: number = S.wuxing.overcomePct;
export const overcomeByPct: number = S.wuxing.overcomeByPct;
export const combos: ComboDef[] = S.comboTechniques.items.map((c: any) => ({ id: c.id, nameTh: c.nameTh, a: c.from[0], b: c.from[1] }));
export const mergeFee: number = S.comboTechniques.mergeFee;
export const comboDmgPct: number = S.comboTechniques.comboDmgPct;
export const upgradeLevels: number = S.upgrade.levels;
export const upgradeNames: string[] = S.upgrade.names;
export const costPct: number[] = S.upgrade.costMultiplier.map((x: number) => Math.round(x * 100));
export const statPct: number[] = S.upgrade.statMultiplier.map((x: number) => Math.round(x * 100));

export const defOf = (key: string): SectDef => units.get(key) ?? sects.get(key)!;

export const enemies = new Map<string, EnemyDef>();
for (const e of [...E.enemies, ...E.bosses]) {
  const mech = e.mechanics;
  enemies.set(e.id, {
    id: e.id, nameTh: e.nameTh, nameEn: e.name, traitEn: e.trait, traitTh: e.traitTh ?? '', element: e.element,
    air: e.layer === 'air', hp: e.hp, speed: Math.round((e.speed * TILE) / TICK_HZ),
    bounty: e.bounty ?? 50, leakCost: e.leakCost ?? 1,
    boss: mech ? { effect: mech.effect, phasesPct: mech.phasesPct, count: mech.count ?? 1, ticks: ticks(mech.sec ?? 0) } : null,
  });
}
export const waveRecipes: WaveRecipe[] = Object.keys(E.waveRecipes).filter((k) => !k.startsWith('_')).map((k) => {
  const w = E.waveRecipes[k];
  return { id: k, nameTh: w.nameTh, types: w.types, countPct: w.countPct, hpPct: w.hpPct, needsRoles: w.needsRoles ?? [] };
});
export const elites = {
  fromWave: E.elites.eliteFromWave as number, chancePct: E.elites.eliteChancePct as number, bountyMult: E.elites.bountyMult as number,
  affixes: E.elites.affixes.map((a: any) => ({ id: a.id, nameTh: a.nameTh, hpPct: a.hpPct, speedPct: a.speedPct, regenPct: a.regenPctPerSec })) as EliteAffix[],
};

export const stageList: StageDef[] = ST.stages.map((s: any) => ({
  id: s.id, type: s.type, layout: s.layout ?? null, variant: s.variant ?? null, unlocksSect: s.unlocksSect ?? null,
  nameTh: s.nameTh, nameEn: s.nameEn, chapter: s.chapter, hpPct: s.hpPct ?? 100,
  waves: s.waves ?? null, startSilver: s.startSilver ?? null, startLives: s.startLives ?? null, unlockAll: s.unlockAll ?? false,
  enemies: s.enemies ?? [], stars: s.stars ?? [], guestSects: s.guestSects ?? [],
  scriptedWaves: new Map(Object.entries((s.scriptedWaves ?? {}) as Record<string, string>)), wavePool: s.wavePool ?? null,
  lanes: new Map(Object.entries((s.lanes ?? {}) as Record<string, number>).map(([w, lane]) => [Number(w), lane - 1])), bossDuel: s.bossDuel ?? null,
  bossHpPct: s.bossHpPct ?? 100, bossSpeedPct: s.bossSpeedPct ?? 100,
}));
export const stages = new Map<string, StageDef>(stageList.map((s) => [s.id, s]));

const P = (t: [number, number]): Pt => ({ x: t[0], y: t[1] });
export const grid = { w: M.grid[0] as number, h: M.grid[1] as number };
export const propBlocks = new Map<string, boolean>(Object.keys(M.propTypes).map((k) => [k, !!M.propTypes[k].block]));
export const propOnPath = new Map<string, boolean>(Object.keys(M.propTypes).map((k) => [k, !!M.propTypes[k].onPath]));
export const biomes = new Map<string, BiomeDef>(Object.keys(M.biomes).map((k) => {
  const b = M.biomes[k];
  const r = b.rule ?? {};
  const rule: BiomeRule = {
    roofRangePct: r.roofRangePct ?? 0, leap: Math.round((r.leapTiles ?? 0) * TILE), fogSight: Math.round((r.fogSightTiles ?? 0) * TILE),
    iceSpeedPct: r.iceSpeedPct ?? 0, gateEveryWaves: r.gateEveryWaves ?? 0, moonEveryWaves: r.moonEveryWaves ?? 0,
  };
  return [k, { nameTh: b.nameTh, time: b.time, palette: b.palette, moodTh: b.moodTh, mechanicTh: b.mechanicTh, spawnGate: b.spawnGate, goalGate: b.goalGate, rule }];
}));
export const layouts = new Map<string, MapLayout>(Object.keys(M.layouts).map((k) => {
  const v = M.layouts[k];
  return [k, { kind: v.kind, biome: v.biome, nameTh: v.nameTh, goalGate: v.goalGate ?? null, paths: (v.paths ?? []).map((p: any) => p.map(P)), props: v.props.map((p: any) => ({ type: p.type, at: P(p.at) })) }];
}));
export const palette = new Map<string, string[]>(Object.entries(FX.render.palette as Record<string, string[]>));

const inRun = EC.inRun;
export const economy = {
  startLives: inRun.startLives as number, interestPct: inRun.interestPct as number, interestCap: inRun.interestCap as number,
  sellRefundPct: inRun.sellRefundPct as number, waveBreak: ticks(inRun.waveBreakSec), spawnInterval: ticks(inRun.spawnIntervalSec),
  earlyCallBonus: inRun.earlyCallBonusSilver as number, bountyGrowthPct: inRun.bountyGrowthPctPerWave as number,
  interestCapPerWave: inRun.interestCapPerWave as number, earlyCallPct: inRun.earlyCallPct as number,
};

export const arts: ArtDef[] = IT.secretArts.items.map((a: any) => ({
  id: a.id, nameTh: a.nameTh, glyph: a.glyph ?? '', type: a.effectType,
  cooldown: ticks(a.cooldown), dmg: a.dmg ?? 0, radius: Math.round((a.radius ?? 0) * TILE),
  pct: a.pct ?? 0, duration: ticks(a.durationSec ?? 0), charges: a.charges ?? 0, rechargeSilver: a.rechargeSilver ?? 0,
}));
export const cards: CardDef[] = [];
for (const group of ['damage', 'economy', 'ruleBender'])
  for (const c of IT.manuals[group]) {
    if (c.kind === 'disabled') continue;
    cards.push({
      id: c.id, nameTh: c.nameTh, effectTh: c.effectTh ?? c.effect, kind: c.kind, element: c.element ?? null, needs: c.needs ?? null,
      pct: c.pct ?? 0, value: c.value ?? 0, roster: c.roster ?? true,
    });
  }
export const CARD_EVERY_WAVES = 5;
export const cardAutoPick = ticks(15);

// HP at wave w (1-based): +18% a wave, then x1.06 a wave from wave 11. Integer math.
export function waveHp(baseHp: number, wave: number): number {
  let bp = 10000 + 1800 * wave;
  for (let i = 10; i < wave; i++) bp = Math.floor((bp * 106) / 100);
  return Math.floor((baseHp * bp) / 10000);
}
