// Defend mode rules: one tick at a time, integer math, seeded RNG. Every loop runs over arrays in a fixed order;
// the golden replays (packages/sim/goldens) pin the outcome tick by tick.
import {
  arts, biomes, branchB, cardAutoPick, CARD_EVERY_WAVES, cards as allCards, combos, comboDmgPct, defOf, economy, elites, enemies as enemyDefs, grid, layouts,
  mergeFee, roles, roleUnlocks, rosterSects, sectOrder, sectRules, sects, stageList, stages, statPct as statPcts, TICK_HZ, TILE,
  units, unitList, upgradeLevels, costPct, waveHp, waveRecipes, generates, hasBranchB, propOnPath, type BiomeRule, type Branch, type CardDef, type ComboDef, type MapLayout, type Pt, type SectDef, type WaveRecipe,
} from './data';
import { blockedTiles, div, isGenerated, nextRandom, pathLength, pointAt, resolveLayout, rollPct, tileKey, tilesOnPath, toMilli, within, wuxingPct } from './core';

export interface Command {
  t: 'place' | 'upgrade' | 'sell' | 'merge' | 'nextWave' | 'cast' | 'pick' | 'target';
  sect?: string; art?: string; card?: string; mode?: string;
  tx?: number; ty?: number; id?: number; a?: number; b?: number;
  branch?: Branch; // upgrade to tier 3: the branch chosen (absent = a, the original technique)
}

// e: hit | kill | leak | spawn | placed | combo | wave | interest | stun | error | art | offer | picked | newEnemy | disable | seal | phoenix | leap | melt | end
export interface SimEvent {
  e: string;
  from?: number; to?: number; id?: number; dmg?: number; pct?: number; x?: number; y?: number; amount?: number; wave?: number;
  crit?: boolean; won?: boolean; el?: string | null; msg?: string; name?: string; type?: string; cards?: string[]; stars?: boolean[];
  kind?: FxKind; // view only (not in the canonical hash): which technique a hit or stun came from, for its own effect
}
export type FxKind = 'execute' | 'wildfire' | 'root' | 'bell' | 'freeze';

export interface Disciple {
  id: number; level: number; tx: number; ty: number; x: number; y: number; cd: number; hits: number; spent: number;
  rootT: number; pushT: number; bellT: number; offT: number;
  els: string[];
  combo: string | null; unit: string | null; el: string | null; // unit: roster unit id; el: its sect element (null = legacy)
  target: string;
  branch: Branch | null; // tier-3 branch, set on the upgrade to tier 3 and fixed after
}

export interface Enemy {
  id: number; hp: number; maxHp: number; d: number; speed: number; bounty: number; x: number; y: number;
  path: number; // index into DefendState.paths; d is the distance walked along it
  slowT: number; slowPct: number; burnT: number; burnDps: number; burnAge: number; poison: number; poisonT: number; poisonDps: number;
  stunT: number; lastElT: number; age: number; regenPct: number; phase: number;
  rootedT: number; // held by Binding Roots (wood tier 3 b): takes more damage from every hit while it lasts
  type: string; el: string; lastEl: string | null; elite: string | null;
  air: boolean; revealed: boolean; small: boolean;
}

export interface QueuedEnemy { type: string; wave: number; hpPct: number; path: number }

export interface DefendState {
  stageId: string; phase: string;
  tick: number; silver: number; lives: number; wave: number; totalWaves: number; spawnT: number; breakT: number; nextId: number;
  livesLost: number; combosMade: number; peakDisciples: number; bountyMultT: number; revealAllT: number; offerT: number;
  rng: number;
  spawnQueue: QueuedEnemy[];
  recipe: string; nextRecipe: string; sealEl: string | null; sect: string | null; // sect: the player's sect when it has a roster
  cardsOffered: number; sealT: number;
  artCharges: number[]; artCd: number[];
  disciples: Disciple[]; enemies: Enemy[];
  unlocked: string[];
  paths: Pt[][]; pathLens: number[]; pathTiles: Set<string>; blocked: Set<string>; layout: MapLayout; // pathTiles: every path's tiles
  cards: string[]; offer: string[] | null; seenTypes: string[]; stars: boolean[] | null;
  sectsUsed: string[]; // distinct sect elements ever placed (max_2_sects star)
  // Biome rule (SPEC-pc-v2 §3): roofs hold disciples; roofEdge = path tiles beside a roof; ice = path tiles still frozen.
  rule: BiomeRule; roofs: Set<string>; roofEdge: Set<string>; ice: Set<string>;
  duel: string | null; // boss duel (SPEC-pc-v2 §4): killing this boss wins, its reaching the gate loses
}

export const isOver = (s: DefendState) => s.phase === 'won' || s.phase === 'lost';

const Hz = TICK_HZ;
export const AUTO_START_TICKS = 30 * Hz; // the HUD shows the countdown
const DOT_EVERY = Hz / 2;

const METAL_CRIT_PCT = 15, METAL_EVERY = 6, WOOD_POISON_DPS = 10, WOOD_VULN_PCT = 25, WATER_SLOW_PCT = 30, WATER_FREEZE_EVERY = 5;
export const FIRE_BURN_DPS = 6, FIRE_SPLASH = 800, FIRE_EXPLODE_DMG = 30, EARTH_SPLASH = TILE, YY_REVEAL = 3 * TILE, YY_RATE_PCT = 120;
const DASH_DIST = 2 * TILE, HEAL_RANGE = 1500, HEAL_PCT = 5, HEAL_BOSS_PCT = 1, BRUTE_ARMOR = 5, ADJACENCY_PCT = 115;
const WOOD_POISON_TICKS = 3 * Hz, WOOD_ROOT_EVERY = 8 * Hz, WOOD_ROOT_TICKS = 1 * Hz, WATER_SLOW_TICKS = 2 * Hz;
const WATER_FREEZE_TICKS = Math.round(1.2 * Hz), WATER_PUSH_EVERY = 12 * Hz, FIRE_BURN_TICKS = 3 * Hz;
const PHOENIX_EVERY = 20 * Hz, EARTH_BELL_EVERY = 10 * Hz, EARTH_BELL_TICKS = 2 * Hz, EARTH_QUAKE_TICKS = 1 * Hz, DASH_EVERY = 4 * Hz;
const HEAL_EVERY = Hz, MIMIC_TICKS = 3 * Hz;
const MAX_LEVEL = upgradeLevels;

export function createDefend(stageId: string, seed: number, sect: string | null = null): DefendState {
  const rosterSect = sect != null && rosterSects.includes(sect) ? sect : null;
  const stage = stages.get(stageId);
  if (!stage) throw new Error(`unknown stage ${stageId}`);
  const layout = resolveLayout(stage.layout!, stage.variant);
  const paths = layout.paths.map(toMilli);
  const rule = { ...biomes.get(layout.biome)!.rule };
  const pathTiles = new Set(layout.paths.flatMap((p) => [...tilesOnPath(p)]));
  const roofAt = rule.roofRangePct > 0 || rule.leap > 0 ? layout.props.filter((p) => p.type === 'roof').map((p) => p.at) : [];
  const roofs = new Set(roofAt.map((p) => tileKey(p.x, p.y)));
  const roofEdge = new Set<string>();
  for (const p of roofAt)
    for (const k of [tileKey(p.x + 1, p.y), tileKey(p.x - 1, p.y), tileKey(p.x, p.y + 1), tileKey(p.x, p.y - 1)]) if (pathTiles.has(k)) roofEdge.add(k);
  return {
    stageId, phase: 'build', tick: 0, silver: stage.startSilver ?? 100, lives: stage.startLives ?? economy.startLives, wave: 0,
    totalWaves: stage.waves ?? 10, spawnT: 0, breakT: 0, nextId: 1, livesLost: 0, combosMade: 0,
    peakDisciples: 0, bountyMultT: 0, revealAllT: 0, offerT: 0, rng: seed >>> 0, spawnQueue: [], recipe: 'mixed', nextRecipe: 'mixed',
    sealEl: null, sect: rosterSect, cardsOffered: 0, sealT: 0, artCharges: arts.map((a) => a.charges), artCd: arts.map(() => 0),
    disciples: [], enemies: [], unlocked: rosterSect != null ? unlockedUnits(rosterSect, stageId) : unlockedSects(stageId),
    paths, pathLens: paths.map(pathLength), pathTiles, blocked: blockedTiles(layout), layout,
    cards: [], offer: null, seenTypes: [], stars: null, sectsUsed: [],
    duel: stage.bossDuel, rule, roofs, roofEdge, ice: new Set(rule.iceSpeedPct > 0 ? layout.props.filter((p) => propOnPath.get(p.type)).map((p) => tileKey(p.at.x, p.at.y)) : []),
  };
}

// The one open road in a wave (null when every road is open): a stage's lanes entry first, then city gates
// (waves 1..N use road 0, the next N road 1, ...).
export function openPath(stageId: string, wave: number): number | null {
  const stage = stages.get(stageId)!;
  const lane = stage.lanes.get(wave);
  if (lane != null) return lane;
  const l = layouts.get(stage.layout!)!;
  const every = biomes.get(l.biome)!.rule.gateEveryWaves;
  return every > 0 ? div(wave - 1, every) % l.paths.length : null;
}

// Blood moon: every moonEveryWaves waves the enemies' elements move one step round the generating cycle
// (wood -> fire -> earth -> metal -> water -> wood). Phase 0 is the enemies' own element.
export const moonPhase = (rule: BiomeRule, wave: number) => (rule.moonEveryWaves > 0 ? div(Math.max(0, wave - 1), rule.moonEveryWaves) : 0);
export function moonElement(el: string, phase: number): string {
  let o = el;
  for (let i = 0; i < phase % 5; i++) o = generates.get(o) ?? o;
  return o;
}

// Range on a tile: a roof adds roofRangePct, fog caps it at fogSight unless the disciple is of the wood sect.
export function tileRange(s: DefendState, range: number, sectEls: string[], tx: number, ty: number): number {
  let r = s.roofs.has(tileKey(tx, ty)) ? div(range * (100 + s.rule.roofRangePct), 100) : range;
  if (s.rule.fogSight > 0 && !sectEls.includes('wood')) r = Math.min(r, s.rule.fogSight);
  return r;
}

export function unlockedSects(stageId: string): string[] {
  const stage = stages.get(stageId)!;
  if (stage.unlockAll) return [...sectOrder];
  const o: string[] = [];
  for (const s of stageList) {
    if (s.chapter > stage.chapter) continue;
    if (s.unlocksSect != null && compareStage(s.id, stageId) <= 0) o.push(s.unlocksSect);
  }
  for (const g of stage.guestSects) if (!o.includes(g)) o.push(g);
  return o;
}

const int = (x: string | undefined): number | null => (x != null && /^\d+$/.test(x) ? Number(x) : null);

// "chapter-stage" ids; a non-numeric part (T-0, T-1) is never "earlier" than anything.
export function compareStage(a: string, b: string): number {
  const pa = a.split('-'), pb = b.split('-');
  const ac = int(pa[0]), bc = int(pb[0]);
  if (ac != null && bc != null && ac !== bc) return ac - bc;
  const as = int(pa[1]), bs = int(pb[1]);
  if (as == null || bs == null) return 1;
  return as - bs;
}

export const placeCost = (key: string) => defOf(key).cost;

// Roster units of a sect unlocked up to this stage (sects.json > roster.roleUnlocks), in role order.
export function unlockedUnits(sect: string, stageId: string): string[] {
  const all = stages.get(stageId)?.unlockAll ?? false;
  const got = new Set<string>();
  for (const [k, rs] of roleUnlocks) if (all || compareStage(k, stageId) <= 0) for (const r of rs) got.add(r);
  const o: string[] = [];
  for (const r of roles) if (got.has(r)) for (const u of unitList) if (u.sect === sect && u.roleId === r) o.push(u.id);
  return o;
}

const defsOf = (d: Disciple): SectDef[] => (d.unit != null ? [units.get(d.unit)!] : d.els.map((el) => sects.get(el)!));
// Wu Xing elements of a disciple: a roster unit counts as its sect's element, whatever its kit.
const wux = (d: Disciple): string[] => (d.el != null ? [d.el] : d.els);
const dotKind = (d: Disciple) => (d.unit != null ? units.get(d.unit)!.dot : null);

export function upgradeCost(d: Disciple): number {
  if (d.combo != null || d.level >= MAX_LEVEL) return 0;
  return div(defsOf(d)[0]!.cost * costPct[d.level]!, 100);
}

const card = (s: DefendState, kind: string): CardDef | undefined => allCards.find((c) => c.kind === kind && s.cards.includes(c.id));

export function sellValue(d: Disciple, s: DefendState): number {
  const v = card(s, 'sellRefundPct')?.value ?? 0;
  return div(d.spent * (v !== 0 ? v : economy.sellRefundPct), 100);
}

export function canBuild(s: DefendState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return false;
  if (s.pathTiles.has(tileKey(tx, ty)) || s.blocked.has(tileKey(tx, ty))) return false;
  return !s.disciples.some((d) => d.tx === tx && d.ty === ty);
}

export const findCombo = (a: string, b: string): ComboDef | undefined => combos.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));

const adjacent = (a: Disciple, b: Disciple) => a !== b && Math.abs(a.tx - b.tx) <= 1 && Math.abs(a.ty - b.ty) <= 1;

function valid(c: Command): boolean {
  switch (c.t) {
    case 'place': return c.sect != null && (sectOrder.includes(c.sect) || units.has(c.sect));
    case 'upgrade': return c.branch == null || c.branch === 'a' || c.branch === 'b';
    case 'sell': case 'nextWave': return true;
    case 'target': return c.mode === 'first' || c.mode === 'strong' || c.mode === 'weak' || c.mode === 'close';
    case 'merge': return (c.a ?? 0) !== (c.b ?? 0);
    case 'cast': return arts.some((a) => a.id === c.art);
    case 'pick': return allCards.some((k) => k.id === c.card);
    default: return false;
  }
}

const err = (ev: SimEvent[], msg: string) => ev.push({ e: 'error', msg });

function apply(s: DefendState, c: Command, ev: SimEvent[]): void {
  if (!valid(c)) { err(ev, 'invalid command'); return; }
  switch (c.t) {
    case 'place': {
      const key = c.sect!, tx = c.tx ?? 0, ty = c.ty ?? 0;
      if (!s.unlocked.includes(key)) { err(ev, 'sect locked'); return; }
      if (!canBuild(s, tx, ty)) { err(ev, 'cannot build here'); return; }
      const cost = placeCost(key);
      if (s.silver < cost) { err(ev, 'not enough silver'); return; }
      s.silver -= cost;
      const id = s.nextId++;
      const d: Disciple = {
        id, level: 1, tx, ty, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, cd: 0, hits: 0, spent: cost,
        rootT: 0, pushT: 0, bellT: 0, offT: 0, els: [], combo: null, unit: null, el: null, target: 'first', branch: null,
      };
      const unit = units.get(key);
      if (unit) { d.els.push(unit.element); d.unit = unit.id; d.el = unit.sect; } else d.els.push(key);
      s.disciples.push(d);
      s.peakDisciples = Math.max(s.peakDisciples, s.disciples.length);
      if (!s.sectsUsed.includes(wux(d)[0]!)) s.sectsUsed.push(wux(d)[0]!);
      ev.push({ e: 'placed', id });
      return;
    }
    case 'upgrade': {
      const d = s.disciples.find((x) => x.id === (c.id ?? 0));
      if (!d || d.combo != null || d.level >= MAX_LEVEL) { err(ev, 'cannot upgrade'); return; }
      const branch = d.level + 1 === MAX_LEVEL ? c.branch ?? 'a' : null;
      if (branch === 'b' && !hasBranchB(d.els[0]!)) { err(ev, 'no such branch'); return; }
      const cost = upgradeCost(d);
      if (s.silver < cost) { err(ev, 'not enough silver'); return; }
      s.silver -= cost; d.spent += cost; d.level++;
      if (branch != null) d.branch = branch;
      return;
    }
    case 'sell': {
      const i = s.disciples.findIndex((x) => x.id === (c.id ?? 0));
      if (i < 0) { err(ev, 'no such disciple'); return; }
      s.silver += sellValue(s.disciples[i]!, s);
      s.disciples.splice(i, 1);
      return;
    }
    case 'merge': {
      const a = s.disciples.find((x) => x.id === (c.a ?? 0));
      const b = s.disciples.find((x) => x.id === (c.b ?? 0));
      if (!a || !b || !adjacent(a, b)) { err(ev, 'merge needs two adjacent disciples'); return; }
      if (a.combo != null || b.combo != null || a.level < MAX_LEVEL || b.level < MAX_LEVEL) { err(ev, 'both must be max level'); return; }
      if (a.unit != null || b.unit != null) { err(ev, 'roster disciples cannot merge yet'); return; }
      const combo = findCombo(a.els[0]!, b.els[0]!);
      if (!combo) { err(ev, 'no combo for this pair'); return; }
      if (s.silver < mergeFee) { err(ev, 'not enough silver'); return; }
      s.silver -= mergeFee;
      a.els = [a.els[0]!, b.els[0]!];
      a.combo = combo.id; a.spent += b.spent + mergeFee; a.cd = 0;
      s.disciples.splice(s.disciples.indexOf(b), 1);
      s.combosMade++;
      ev.push({ e: 'combo', id: a.id, name: combo.nameTh, type: combo.id });
      return;
    }
    case 'nextWave':
      if (s.wave >= s.totalWaves) { err(ev, 'no more waves'); return; }
      if (s.phase === 'build') startWave(s, ev);
      else if (s.phase === 'break') { s.silver += economy.earlyCallBonus; startWave(s, ev); }
      else if (s.phase === 'spawning' || s.phase === 'clearing') {
        // Calling while enemies are still alive overlaps two waves; the bonus pays for that risk.
        let atStake = 0;
        for (const e of s.enemies) if (e.hp > 0 && e.type !== s.duel) atStake += e.bounty;
        s.silver += economy.earlyCallBonus + div(atStake * economy.earlyCallPct, 100);
        startWave(s, ev);
      } else err(ev, 'cannot call a wave now');
      return;
    case 'cast': castArt(s, c.art!, ev); return;
    case 'target': {
      const d = s.disciples.find((x) => x.id === (c.id ?? 0));
      if (!d) { err(ev, 'no such disciple'); return; }
      d.target = c.mode!;
      return;
    }
    case 'pick':
      if (s.phase !== 'picking' || s.offer == null || !s.offer.includes(c.card!)) { err(ev, 'no such card on offer'); return; }
      pickCard(s, c.card!, ev);
      return;
  }
}

function castArt(s: DefendState, id: string, ev: SimEvent[]): void {
  const i = arts.findIndex((a) => a.id === id);
  const art = arts[i]!;
  if (s.artCd[i]! > 0) { err(ev, 'art on cooldown'); return; }
  const alive = s.enemies.filter((e) => e.hp > 0);
  if (alive.length === 0) { err(ev, 'no enemies'); return; }
  // Free charges first, then each cast costs silver.
  if (s.artCharges[i]! > 0) s.artCharges[i]!--;
  else if (s.silver >= art.rechargeSilver) s.silver -= art.rechargeSilver;
  else { err(ev, 'not enough silver'); return; }
  let x = 0, y = 0;
  switch (art.type) {
    case 'strike': {
      let lead = alive[0]!;
      for (const e of alive) if (toGo(s, e) < toGo(s, lead)) lead = e;
      x = lead.x; y = lead.y;
      for (const e of alive) if (within(x, y, e.x, e.y, art.radius)) e.hp -= art.dmg;
      break;
    }
    case 'slowAll':
      for (const e of alive) { e.slowT = Math.max(e.slowT, art.duration); e.slowPct = Math.max(e.slowPct, art.pct); }
      break;
    case 'bountyMult': s.bountyMultT = art.duration; break;
    case 'stunAll':
      for (const e of alive) e.stunT = Math.max(e.stunT, art.duration);
      s.revealAllT = art.duration;
      break;
  }
  s.artCd[i] = art.cooldown;
  ev.push({ e: 'art', name: art.id, x, y });
}

function offerCards(s: DefendState, ev: SimEvent[]): void {
  // Sect-locked cards follow the player's sect in a roster game (unlocked then holds unit ids, not elements);
  // cards built on mixing sects (roster false) are never offered there.
  const pool = allCards.filter((c) => !s.cards.includes(c.id)
    && (c.needs == null || (s.sect != null ? c.needs === s.sect : s.unlocked.includes(c.needs)))
    && (s.sect == null || c.roster));
  const offer: string[] = [];
  while (offer.length < 3 && pool.length > 0) {
    const i = Math.floor(nextRandom(s) * pool.length);
    offer.push(pool[i]!.id);
    pool.splice(i, 1);
  }
  if (offer.length === 0) { s.phase = 'break'; s.breakT = economy.waveBreak; return; }
  s.offer = offer; s.offerT = cardAutoPick; s.phase = 'picking';
  ev.push({ e: 'offer', cards: offer });
}

function pickCard(s: DefendState, id: string, ev: SimEvent[]): void {
  s.cards.push(id); s.offer = null; s.phase = 'break'; s.breakT = economy.waveBreak;
  ev.push({ e: 'picked', name: id });
}

export const recipeById = (id: string): WaveRecipe => waveRecipes.find((r) => r.id === id) ?? waveRecipes[0]!;

function availableTypes(stageId: string, wave: number): string[] {
  const types = stages.get(stageId)!.enemies.filter((t) => enemyDefs.has(t) && enemyDefs.get(t)!.boss == null);
  if (types.length === 0) throw new Error(`stage ${stageId} has no regular enemies`);
  return types.slice(0, Math.min(types.length, 1 + Math.floor((wave - 1) / 2)));
}

function recipeTypes(stageId: string, wave: number, recipeId: string): string[] {
  const avail = availableTypes(stageId, wave);
  const r = recipeById(recipeId);
  const picked = r.types.length > 0 ? avail.filter((t) => r.types.includes(t)) : avail;
  return picked.length > 0 ? picked : avail;
}

function rollRecipe(s: DefendState, wave: number): string {
  const stage = stages.get(s.stageId)!;
  if (wave <= 2 || stage.scriptedWaves.has(String(wave))) return 'mixed';
  const avail = availableTypes(s.stageId, wave);
  const pool = (stage.wavePool ?? waveRecipes.map((r) => r.id)).filter((id) => {
    const r = recipeById(id);
    return (r.types.length === 0 || r.types.some((t) => avail.includes(t))) && answerable(s, r);
  });
  const choices = pool.length > 1 ? pool.filter((id) => id !== s.recipe) : pool;
  if (choices.length === 0) return 'mixed';
  return choices[Math.floor(nextRandom(s) * choices.length)]!;
}

// A roster player must hold at least one of the roles a wave shape asks for ("air": any unit that hits air).
function answerable(s: DefendState, r: WaveRecipe): boolean {
  if (s.sect == null || r.needsRoles.length === 0) return true;
  const us = s.unlocked.filter((k) => units.has(k)).map((k) => units.get(k)!);
  return r.needsRoles.some((n) => (n === 'air' ? us.some((u) => u.hitsAir) : us.some((u) => u.roleId === n)));
}

export function waveEntries(stageId: string, wave: number, recipeId: string): QueuedEnemy[] {
  const r = recipeById(recipeId);
  const types = recipeTypes(stageId, wave, recipeId);
  const n = Math.max(1, div((4 + wave) * r.countPct, 100));
  const stage = stages.get(stageId)!;
  const paths = layouts.get(stage.layout!)!.paths.length;
  const gate = openPath(stageId, wave);
  const road = (i: number) => gate ?? i % paths;
  const o: QueuedEnemy[] = [];
  // Enemies take the open spawn gates in turn, in queue order.
  for (let i = 0; i < n; i++) o.push({ type: types[(i + wave) % types.length]!, wave, hpPct: r.hpPct, path: road(i) });
  const boss = stage.scriptedWaves.get(String(wave)) ?? (wave === 1 ? stage.bossDuel : null);
  if (boss != null) o.push({ type: boss, wave, hpPct: 100, path: road(n) });
  return o;
}

export const waveTypes = (stageId: string, wave: number) => waveEntries(stageId, wave, 'mixed').map((q) => q.type);

// Interest is paid once per wave, when the field is clear, capped by how far the run is. Calling the next wave
// before the field is clear skips it: that is the price of the early-call bonus.
function payInterest(s: DefendState, ev: SimEvent[]): void {
  const pct = economy.interestPct + (hasLevel(s, 'yinyang', 3) ? 1 : 0) + (card(s, 'interestPct')?.value ?? 0);
  const cap = economy.interestCap + economy.interestCapPerWave * s.wave;
  const interest = Math.min(cap, div(s.silver * pct, 100));
  s.silver += interest;
  ev.push({ e: 'interest', amount: interest });
}

function startWave(s: DefendState, ev: SimEvent[]): void {
  s.wave++;
  s.recipe = s.nextRecipe;
  s.spawnQueue.push(...waveEntries(s.stageId, s.wave, s.recipe));
  if (s.phase !== 'spawning') { s.spawnT = 0; s.phase = 'spawning'; }
  if (s.wave < s.totalWaves) s.nextRecipe = rollRecipe(s, s.wave + 1);
  ev.push({ e: 'wave', wave: s.wave });
}

function spawn(s: DefendState, q: QueuedEnemy, ev: SimEvent[], at = 0, small = false): Enemy {
  const type = q.type;
  const def = enemyDefs.get(type)!;
  // Bosses use their data HP; regular enemies scale with the wave curve. A duel boss is scaled by its stage's knobs.
  const stage = stages.get(s.stageId)!;
  const duel = type === s.duel;
  const bas = def.boss == null ? div(waveHp(def.hp, q.wave) * q.hpPct * stage.hpPct, 100 * 100) : duel ? div(def.hp * stage.bossHpPct, 100) : def.hp;
  let hp = small ? Math.max(1, div(bas, 4)) : Math.max(1, bas);
  let speed = duel ? div(def.speed * stage.bossSpeedPct, 100) : def.speed;
  let bounty = small ? 1 : div(def.bounty * (100 + economy.bountyGrowthPct * (q.wave - 1)), 100);
  let elite = null;
  if (!small && def.boss == null && q.wave >= elites.fromWave && rollPct(s) < elites.chancePct) {
    elite = elites.affixes[Math.floor(nextRandom(s) * elites.affixes.length)]!;
    hp = div(hp * elite.hpPct, 100);
    speed = div(speed * elite.speedPct, 100);
    bounty *= elites.bountyMult;
  }
  const p = pointAt(s.paths[q.path]!, at);
  const e: Enemy = {
    id: s.nextId++, type, el: moonElement(def.element, moonPhase(s.rule, q.wave)), air: def.air, hp, maxHp: hp, d: at, path: q.path, speed, bounty, x: p.x, y: p.y, small,
    elite: elite?.id ?? null, regenPct: elite?.regenPct ?? 0,
    slowT: 0, slowPct: 0, burnT: 0, burnDps: 0, burnAge: 0, poison: 0, poisonT: 0, poisonDps: 0, stunT: 0, rootedT: 0, lastElT: 0, age: 0, phase: 0,
    lastEl: null, revealed: false,
  };
  s.enemies.push(e);
  ev.push({ e: 'spawn', id: e.id });
  if (!small && !s.seenTypes.includes(type)) { s.seenTypes.push(type); ev.push({ e: 'newEnemy', type }); }
  return e;
}

const statPct = (level: number) => statPcts[level - 1]!;

// Poison/burn per second, scaled by level and by the Wu Xing match when applied.
const dotDps = (d: Disciple, e: Enemy, bas: number, lvl: number) => div(div(bas * statPct(lvl), 100) * wuxingPct(wux(d), e.el), 100);

export interface Stats { dmg: number; cooldown: number; range: number; hitsAir: boolean; hitsGround: boolean }

export function discipleStats(s: DefendState, d: Disciple): Stats {
  const defs = defsOf(d);
  // Merged form: summed damage x comboDmgPct, attacking at the average cooldown.
  let dmg = d.combo != null ? div(defs.reduce((a, x) => a + x.dmg, 0) * comboDmgPct, 100) : defs[0]!.dmg;
  dmg = div(dmg * statPct(d.level), 100);
  const neighbours = s.disciples.filter((o) => adjacent(d, o));
  if (isGenerated(wux(d), neighbours.map(wux))) {
    const v = card(s, 'adjacencyPct')?.value ?? 0;
    dmg = div(dmg * (v !== 0 ? v : ADJACENCY_PCT), 100);
  }
  const el = card(s, 'elementDmg');
  if (el && el.element != null && wux(d).includes(el.element)) dmg = div(dmg * (100 + el.pct), 100);
  const mono = card(s, 'monoSectPct');
  if (mono && s.disciples.every((o) => wux(o)[0] === wux(s.disciples[0]!)[0])) dmg = div(dmg * (100 + mono.pct), 100);
  let cooldown = d.combo != null ? div(defs.reduce((a, x) => a + x.cooldown, 0), defs.length) : defs[0]!.cooldown;
  if (neighbours.some((n) => n.els.includes('yinyang') && n.level >= 2)) cooldown = div(cooldown * 100, YY_RATE_PCT);
  return {
    dmg, cooldown: Math.max(1, cooldown), range: tileRange(s, Math.max(...defs.map((x) => x.range)), wux(d), d.tx, d.ty),
    hitsAir: defs.some((x) => x.hitsAir), hitsGround: defs.some((x) => x.hitsGround),
  };
}

const canTarget = (e: Enemy, air: boolean, ground: boolean) => e.hp > 0 && (e.air ? air : ground) && (e.type !== 'assassin' || e.revealed);

const hasLevel = (s: DefendState, el: string, level: number) => s.disciples.some((d) => d.els.includes(el) && d.level >= level);
// Tier-3 branch b of its kit (a disciple at tier 3 with no branch recorded plays branch a).
const isB = (d: Disciple) => d.level >= MAX_LEVEL && d.branch === 'b';

function dealDamage(s: DefendState, d: Disciple, e: Enemy, raw: number, crit: boolean, ev: SimEvent[], kind?: FxKind): void {
  const pct = wuxingPct(wux(d), e.el);
  let dmg = div(raw * pct, 100);
  if (s.disciples.some((o) => o.els.includes('wood') && o.level >= 3 && !isB(o)) && (s.sect === 'fire' ? e.burnT > 0 : e.poison > 0)) dmg = div(dmg * (100 + WOOD_VULN_PCT), 100); // roster: the sect DoT
  if (e.rootedT > 0) dmg = div(dmg * (100 + branchB.rootTakenPct), 100);
  if (e.type === 'mimic' && e.lastElT > 0 && e.lastEl != null && wux(d).includes(e.lastEl)) dmg = div(dmg, 2);
  const freeze = card(s, 'slowedVuln');
  if (freeze && e.slowT > 0) dmg = div(dmg * (100 + freeze.pct), 100);
  const heavy = card(s, 'vsHeavyPct');
  if (heavy && (e.type === 'brute' || e.type.startsWith('boss'))) dmg = div(dmg * (100 + heavy.pct), 100);
  if (e.type === 'brute' && d.combo !== 'molten_edge') dmg -= BRUTE_ARMOR;
  dmg = Math.max(1, dmg);
  e.hp -= dmg;
  e.lastEl = wux(d)[0]!;
  e.lastElT = MIMIC_TICKS;
  ev.push({ e: 'hit', from: d.id, to: e.id, dmg, pct, crit, el: wux(d)[0]!, kind });
}

const dist2 = (d: Disciple, e: Enemy) => { const dx = d.x - e.x, dy = d.y - e.y; return dx * dx + dy * dy; };

const toGo = (s: DefendState, e: Enemy) => s.pathLens[e.path]! - e.d;

function better(s: DefendState, d: Disciple, e: Enemy, cur: Enemy): boolean {
  switch (d.target) {
    case 'strong': return e.hp > cur.hp;
    case 'weak': return e.hp < cur.hp;
    case 'close': return dist2(d, e) < dist2(d, cur);
    default: return toGo(s, e) < toGo(s, cur);
  }
}

function addPoison(e: Enemy, dps: number, t = WOOD_POISON_TICKS) {
  e.poison = Math.min(3, e.poison + 1);
  e.poisonT = Math.max(e.poisonT, t);
  e.poisonDps = Math.max(e.poisonDps, dps);
}

function attack(s: DefendState, d: Disciple, ev: SimEvent[]): void {
  if (d.offT > 0) { d.offT--; return; }
  if (s.sealT > 0 && s.sealEl != null && d.els.includes(s.sealEl)) return;
  d.rootT++; d.pushT++; d.bellT++;
  const st = discipleStats(s, d);
  const lvl = d.level;

  const bellCard = card(s, 'bellEverySec')?.value ?? 0;
  const bellEvery = bellCard * Hz !== 0 ? bellCard * Hz : EARTH_BELL_EVERY;
  if (d.els.includes('earth') && lvl >= 2 && d.bellT >= bellEvery) {
    d.bellT = 0;
    // Tier 3: branch a widens the bell into a quake (r 2, shorter stun); branch b keeps r 1 and stuns longer.
    const quake = lvl >= 3 && !isB(d);
    const r = quake ? 2 * TILE : TILE;
    const t = d.combo === 'iron_mountain' ? EARTH_BELL_TICKS + Hz : quake ? EARTH_QUAKE_TICKS : isB(d) ? div(EARTH_BELL_TICKS * branchB.bellStunPct, 100) : EARTH_BELL_TICKS;
    for (const e of s.enemies)
      if (!e.air && e.hp > 0 && within(d.x, d.y, e.x, e.y, r)) {
        e.stunT = Math.max(e.stunT, t);
        if (d.combo === 'root_quake') addPoison(e, WOOD_POISON_DPS);
        ev.push({ e: 'stun', id: e.id, from: d.id, kind: 'bell' });
      }
  }

  // Fire tier 3 "เพลิงคืนชีพ": every 20 s a phoenix sweeps the path; every enemy on it is hit and set burning.
  // pushT doubles as its timer (only the water kit uses pushT otherwise).
  if (d.combo == null && d.els.includes('fire') && lvl >= 3 && !isB(d) && d.pushT >= PHOENIX_EVERY) {
    d.pushT = 0;
    ev.push({ e: 'phoenix', from: d.id });
    for (const e of [...s.enemies])
      if (e.hp > 0 && (e.type !== 'assassin' || e.revealed)) {
        dealDamage(s, d, e, st.dmg, false, ev);
        e.burnT = FIRE_BURN_TICKS;
        e.burnDps = Math.max(e.burnDps, dotDps(d, e, FIRE_BURN_DPS * 2, lvl));
      }
  }

  if (d.cd > 0) { d.cd--; return; }
  let target: Enemy | null = null;
  for (const e of s.enemies) {
    if (!canTarget(e, st.hitsAir, st.hitsGround) || !within(d.x, d.y, e.x, e.y, st.range)) continue;
    if (target == null || better(s, d, e, target)) target = e;
  }
  if (target == null) return;
  const tg = target;
  d.cd = st.cooldown - 1;
  d.hits++;

  let crit = false;
  if (d.els.includes('metal'))
    crit = rollPct(s) < METAL_CRIT_PCT + (card(s, 'critChance')?.pct ?? 0) || (lvl >= 2 && d.hits % METAL_EVERY === 0);
  if (d.combo === 'frozen_blade' && tg.stunT > 0) crit = true;
  let raw = crit ? st.dmg * 2 : st.dmg;
  // Metal tier 3 branch b: an execution stroke on a target below executeBelowPct HP.
  const execute = isB(d) && d.els.includes('metal') && tg.hp * 100 < tg.maxHp * branchB.executeBelowPct;
  if (execute) raw = div(raw * branchB.executeDmgPct, 100);
  dealDamage(s, d, tg, raw, crit, ev, execute ? 'execute' : isB(d) && d.els.includes('fire') ? 'wildfire' : undefined);

  for (const el of d.els) {
    switch (el) {
      case 'metal':
        // A roster striker's crit feeds its sect's damage over time (fire burn, wood poison), so it plays
        // into the sect rule instead of being a generic sword.
        if (crit && dotKind(d) === 'burn') { tg.burnT = FIRE_BURN_TICKS; tg.burnDps = Math.max(tg.burnDps, dotDps(d, tg, FIRE_BURN_DPS, lvl)); }
        else if (crit && dotKind(d) === 'poison') addPoison(tg, dotDps(d, tg, WOOD_POISON_DPS, lvl));
        if (crit && lvl >= 3 && !isB(d)) {
          const second = s.enemies.find((e) => e !== tg && canTarget(e, st.hitsAir, st.hitsGround) && within(d.x, d.y, e.x, e.y, st.range));
          if (second) dealDamage(s, d, second, raw, true, ev);
        }
        break;
      case 'wood':
        if (dotKind(d) === 'burn') {
          // Fire-sect stacker: its damage over time is a burn, worth two poison stacks, that the sect rule ramps.
          tg.burnT = WOOD_POISON_TICKS;
          tg.burnDps = Math.max(tg.burnDps, dotDps(d, tg, WOOD_POISON_DPS * 2, lvl));
        } else addPoison(tg, dotDps(d, tg, WOOD_POISON_DPS, lvl));
        if (isB(d) && d.rootT >= branchB.rootEvery) {
          // Tier 3 branch b: the roots bind every enemy in range, not just the target, and leave it open to every hit.
          d.rootT = 0;
          for (const e of s.enemies)
            if (canTarget(e, st.hitsAir, st.hitsGround) && within(d.x, d.y, e.x, e.y, st.range)) {
              e.stunT = Math.max(e.stunT, branchB.rootTicks);
              e.rootedT = Math.max(e.rootedT, branchB.rootTicks);
              ev.push({ e: 'stun', id: e.id, from: d.id, kind: 'root' });
            }
        } else if (lvl >= 2 && d.rootT >= WOOD_ROOT_EVERY) {
          d.rootT = 0;
          tg.stunT = Math.max(tg.stunT, WOOD_ROOT_TICKS);
          ev.push({ e: 'stun', id: tg.id, from: d.id, kind: 'root' });
        }
        break;
      case 'water':
        tg.slowT = WATER_SLOW_TICKS;
        tg.slowPct = Math.max(tg.slowPct, WATER_SLOW_PCT);
        if (lvl >= 2 && d.hits % (isB(d) ? branchB.freezeEvery : WATER_FREEZE_EVERY) === 0) {
          tg.stunT = Math.max(tg.stunT, WATER_FREEZE_TICKS);
          ev.push({ e: 'stun', id: tg.id, from: d.id, kind: 'freeze' });
        }
        if (lvl >= 3 && !isB(d) && d.pushT >= WATER_PUSH_EVERY) { d.pushT = 0; tg.d = Math.max(0, tg.d - TILE); }
        break;
      case 'fire': {
        // Tier 3 branch b (wildfire): a wider splash whose damage over time lasts longer.
        const wild = isB(d) ? branchB : null;
        const splash = wild ? div(FIRE_SPLASH * wild.splashPct, 100) : FIRE_SPLASH;
        const dotPct = wild ? wild.burnPct : 100;
        for (const e of s.enemies)
          if (e.hp > 0 && (e === tg || within(tg.x, tg.y, e.x, e.y, splash))) {
            // Wood-sect burst: the splash poisons (one stack) instead of burning.
            if (dotKind(d) === 'poison') addPoison(e, dotDps(d, e, WOOD_POISON_DPS, lvl), div(WOOD_POISON_TICKS * dotPct, 100));
            else { e.burnT = Math.max(e.burnT, div(FIRE_BURN_TICKS * dotPct, 100)); e.burnDps = Math.max(e.burnDps, dotDps(d, e, FIRE_BURN_DPS, lvl)); }
          }
        break;
      }
      case 'earth': {
        const volcano = d.combo === 'volcano_fist';
        const r = volcano ? div(EARTH_SPLASH * 3, 2) : EARTH_SPLASH;
        for (const e of [...s.enemies])
          if (e !== tg && !e.air && e.hp > 0 && within(tg.x, tg.y, e.x, e.y, r))
            dealDamage(s, d, e, volcano ? raw : div(raw, 2), false, ev);
        break;
      }
    }
  }
  if (d.combo != null) comboOnHit(s, d, tg, crit);
}

function comboOnHit(s: DefendState, d: Disciple, target: Enemy, crit: boolean): void {
  const splash = (r: number, f: (e: Enemy) => void) => {
    for (const e of s.enemies) if (e.hp > 0 && (e === target || within(target.x, target.y, e.x, e.y, r))) f(e);
  };
  switch (d.combo) {
    case 'thorn_sword':
      if (crit) { target.poison = 3; target.poisonT = WOOD_POISON_TICKS; target.poisonDps = Math.max(target.poisonDps, WOOD_POISON_DPS); }
      break;
    case 'spring_rain':
      splash(TILE, (e) => {
        e.slowT = WATER_SLOW_TICKS; e.slowPct = Math.max(e.slowPct, WATER_SLOW_PCT);
        addPoison(e, WOOD_POISON_DPS);
      });
      break;
    case 'steam_palm':
      splash(FIRE_SPLASH, (e) => { e.slowT = WATER_SLOW_TICKS; e.slowPct = Math.max(e.slowPct, WATER_SLOW_PCT); });
      break;
    case 'quicksand':
      target.slowPct = Math.max(target.slowPct, 50);
      break;
  }
}

function moveEnemies(s: DefendState, ev: SimEvent[]): void {
  const yy = s.disciples.filter((d) => d.els.includes('yinyang'));
  for (const e of s.enemies) {
    e.age++;
    e.revealed = s.revealAllT > 0 || e.stunT > 0 || e.slowT > 0 || yy.some((d) => within(d.x, d.y, e.x, e.y, YY_REVEAL));
    if (e.lastElT > 0) e.lastElT--;
    if (e.rootedT > 0) e.rootedT--;
    if (e.age % DOT_EVERY === 0) {
      const armour = e.type === 'brute' ? 2 : 1; // Iron Shirt halves damage over time too
      // Fire sect rule: a burn that keeps going hits harder, +rampPctPerSec per second up to +rampMaxPct.
      const ramp = s.sect === 'fire' ? Math.min(sectRules.fireRampMaxPct, Math.floor(e.burnAge / Hz) * sectRules.fireRampPctPerSec) : 0;
      if (e.burnT > 0) e.hp -= Math.max(1, div(e.burnDps * (100 + ramp), 200 * armour));
      // Wood sect rule: its poison seeps through Iron Shirt (brute armour does not halve it).
      const poisonArmour = s.sect === 'wood' ? 1 : armour;
      if (e.poisonT > 0 && e.poison > 0) e.hp -= Math.max(1, div(e.poison * e.poisonDps, 2 * poisonArmour));
    }
    if (e.burnT > 0) { e.burnT--; e.burnAge++; } else e.burnAge = 0;
    if (e.poisonT > 0) e.poisonT--; else e.poison = 0;
    if (e.regenPct > 0 && e.age % Hz === 0) e.hp = Math.min(e.maxHp, e.hp + div(e.maxHp * e.regenPct, 100));
    // Healers mend allies nearby; burning or poisoned allies cannot be healed (SPEC-core §3.2), bosses only 1%.
    if (e.type === 'healer' && e.age % HEAL_EVERY === 0 && e.burnT === 0 && e.poisonT === 0)
      for (const o of s.enemies)
        if (o !== e && o.hp > 0 && o.burnT === 0 && o.poisonT === 0 && within(e.x, e.y, o.x, o.y, HEAL_RANGE))
          o.hp = Math.min(o.maxHp, o.hp + div(o.maxHp * (enemyDefs.get(o.type)!.boss != null ? HEAL_BOSS_PCT : HEAL_PCT), 100));
    const tile = tileKey(div(e.x, TILE), div(e.y, TILE));
    // Ice: a burning enemy melts the ice under it for the rest of the stage.
    if (e.burnT > 0 && !e.air && s.ice.delete(tile)) ev.push({ e: 'melt', x: e.x, y: e.y });
    if (e.stunT > 0) { e.stunT--; continue; }
    let sp = e.speed;
    if (e.slowT > 0) { e.slowT--; sp = div(sp * (100 - e.slowPct), 100); } else e.slowPct = 0;
    if (!e.air && s.ice.has(tile)) sp = div(sp * (100 + s.rule.iceSpeedPct), 100);
    e.d += sp;
    if (e.type === 'runner' && e.age % DASH_EVERY === 0) e.d += DASH_DIST;
    let p = pointAt(s.paths[e.path]!, e.d);
    // Rooftops: a leaper reaching a roof line jumps leap ahead (once per line: it must come from a tile beside no roof).
    if (e.type === 'leaper' && s.rule.leap > 0 && !s.roofEdge.has(tile) && s.roofEdge.has(tileKey(div(p.x, TILE), div(p.y, TILE)))) {
      e.d += s.rule.leap;
      p = pointAt(s.paths[e.path]!, e.d);
      ev.push({ e: 'leap', id: e.id });
    }
    e.x = p.x; e.y = p.y;
  }
  for (const e of s.enemies)
    if (e.hp > 0 && e.d >= s.pathLens[e.path]!) {
      e.hp = 0; e.bounty = 0;
      const cost = e.type === s.duel ? s.lives : enemyDefs.get(e.type)!.leakCost;
      s.lives = Math.max(0, s.lives - cost);
      s.livesLost += cost;
      ev.push({ e: 'leak', id: e.id });
    }
}

// Boss mechanics fire once per HP threshold (enemies.json bosses[].mechanics).
function bossPhases(s: DefendState, ev: SimEvent[]): void {
  for (const e of s.enemies) {
    const m = enemyDefs.get(e.type)!.boss;
    if (m == null || e.hp <= 0) continue;
    while (e.phase < m.phasesPct.length && e.hp * 100 <= e.maxHp * m.phasesPct[e.phase]!) {
      e.phase++;
      if (m.effect === 'disable') {
        for (let k = 0; k < m.count; k++) {
          const free = s.disciples.filter((d) => d.offT === 0);
          if (free.length === 0) break;
          const d = free[Math.floor(nextRandom(s) * free.length)]!;
          d.offT = m.ticks;
          ev.push({ e: 'disable', id: d.id, from: e.id });
        }
      } else if (m.effect === 'seal' && s.disciples.length > 0) {
        let best: string | null = null, bestN = 0;
        for (const el of sectOrder) {
          const n = s.disciples.filter((d) => d.els[0] === el).length;
          if (n > bestN) { best = el; bestN = n; }
        }
        s.sealEl = best; s.sealT = m.ticks;
        ev.push({ e: 'seal', el: best, from: e.id });
      }
    }
  }
}

function resolveDeaths(s: DefendState, ev: SimEvent[]): void {
  const dead = s.enemies.filter((e) => e.hp <= 0);
  if (dead.length === 0) return;
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  const yy3 = s.disciples.filter((d) => d.els.includes('yinyang') && d.level >= 3);
  const fireExplodes = hasLevel(s, 'fire', 2);
  let won = false;
  for (const e of dead) {
    if (e.bounty === 0 && e.d >= s.pathLens[e.path]!) continue; // leaked
    if (e.type === s.duel) won = true;
    let bounty = e.bounty;
    if (yy3.some((d) => within(d.x, d.y, e.x, e.y, YY_REVEAL))) bounty++;
    bounty += card(s, 'bountyFlat')?.value ?? 0;
    if (s.bountyMultT > 0) bounty *= 2;
    s.silver += bounty;
    ev.push({ e: 'kill', id: e.id, x: e.x, y: e.y, amount: bounty });
    if (e.type === 'puppet' && !e.small) for (let i = 0; i < 3; i++) spawn(s, { type: 'puppet', wave: s.wave, hpPct: 100, path: e.path }, ev, Math.max(0, e.d - i * 300), true);
    if (e.burnT > 0 && s.disciples.some((q) => q.combo === 'wildfire_flute'))
      for (const o of s.enemies.filter((o) => o.hp > 0 && within(e.x, e.y, o.x, o.y, 1500)).slice(0, 2)) { o.burnT = FIRE_BURN_TICKS; o.burnDps = Math.max(o.burnDps, e.burnDps); }
    // Wood sect rule: a poisoned enemy that dies passes its poison to everything near it.
    if (s.sect === 'wood' && e.poison > 0)
      for (const o of s.enemies)
        if (o.hp > 0 && within(e.x, e.y, o.x, o.y, sectRules.woodSpreadRange)) {
          o.poison = Math.min(3, o.poison + sectRules.woodSpreadStacks);
          o.poisonT = WOOD_POISON_TICKS;
          o.poisonDps = Math.max(o.poisonDps, e.poisonDps);
        }
    if (fireExplodes && (e.burnT > 0 || (s.sect === 'wood' && e.poison > 0))) // roster: the sect DoT
      for (const o of s.enemies) if (within(e.x, e.y, o.x, o.y, TILE)) o.hp -= FIRE_EXPLODE_DMG;
  }
  if (won) finish(s, true, ev);
}

function waveFlow(s: DefendState, ev: SimEvent[]): void {
  switch (s.phase) {
    case 'build':
      if (s.tick >= AUTO_START_TICKS) startWave(s, ev);
      break;
    case 'spawning':
      if (s.spawnT > 0) s.spawnT--;
      else {
        const q = s.spawnQueue.shift();
        if (q) spawn(s, q, ev);
        s.spawnT = economy.spawnInterval - 1;
        if (s.spawnQueue.length === 0) s.phase = 'clearing';
      }
      break;
    case 'clearing':
      // In a duel the boss does not hold the next wave back, and running out of waves does not end the stage.
      if (s.duel != null ? s.wave < s.totalWaves && s.enemies.every((e) => e.type === s.duel) : s.enemies.length === 0) {
        payInterest(s, ev);
        if (s.wave >= s.totalWaves) finish(s, true, ev);
        else if (Math.floor(s.wave / CARD_EVERY_WAVES) > s.cardsOffered) {
          s.cardsOffered = Math.floor(s.wave / CARD_EVERY_WAVES);
          offerCards(s, ev);
        } else { s.phase = 'break'; s.breakT = economy.waveBreak; }
      }
      break;
    case 'break':
      if (--s.breakT <= 0) startWave(s, ev);
      break;
    case 'picking':
      if (--s.offerT <= 0 && s.offer != null) pickCard(s, s.offer[0]!, ev);
      break;
  }
}

export function evaluateStars(s: DefendState, won: boolean): boolean[] {
  return stages.get(s.stageId)!.stars.map((key) => {
    if (!won) return false;
    switch (key) {
      case 'clear': return true;
      case 'no_life_lost': return s.livesLost === 0;
      case 'under_3min': return s.tick <= 3 * 60 * Hz;
      case 'hold_200_silver': return s.silver >= 200;
      case 'max_6_disciples': return s.peakDisciples <= 6;
      case 'max_2_sects': return s.sectsUsed.length <= 2;
      case 'use_combo': return s.combosMade > 0;
      default: return false;
    }
  });
}

function finish(s: DefendState, won: boolean, ev: SimEvent[]): void {
  s.phase = won ? 'won' : 'lost';
  s.stars = evaluateStars(s, won);
  ev.push({ e: 'end', won, stars: s.stars });
}

// Advances exactly one tick (1/20 s). Commands apply at the start of the tick.
export function stepDefend(s: DefendState, commands: readonly Command[] = []): SimEvent[] {
  const ev: SimEvent[] = [];
  if (isOver(s)) return ev;
  for (const c of commands) apply(s, c, ev);
  for (let i = 0; i < s.artCd.length; i++) if (s.artCd[i]! > 0) s.artCd[i]!--;
  if (s.bountyMultT > 0) s.bountyMultT--;
  if (s.revealAllT > 0) s.revealAllT--;
  if (s.sealT > 0 && --s.sealT === 0) s.sealEl = null;
  waveFlow(s, ev);
  moveEnemies(s, ev);
  for (const d of [...s.disciples]) attack(s, d, ev);
  bossPhases(s, ev);
  resolveDeaths(s, ev);
  s.tick++;
  if (s.lives <= 0 && !isOver(s)) finish(s, false, ev);
  return ev;
}
