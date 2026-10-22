import { ARTS, CARD_AUTO_PICK, CARD_EVERY_WAVES, CARDS, COMBOS, ECONOMY, ENEMIES, MERGE_FEE, SECTS, SECT_ORDER, STAGES, TICK_HZ, TILE, UPGRADE, WAVE_RECIPES, waveHp, type CardDef, type Element, ELITES } from './data';
import { blockedTiles, GRID_H, GRID_W, resolveLayout, tilesOnPath } from './layouts';
import { pathLength, pointAt, toMilli, within } from './path';
import { nextRandom, rollPct } from './rng';
import { validCommand } from './commands';
import type { Command, DefendState, Disciple, Enemy, QueuedEnemy, SimEvent } from './types';
import { isGenerated, overcomePct } from './wuxing';

const MAX_LEVEL = UPGRADE.levels;
const AUTO_START_TICKS = 30 * TICK_HZ;
const DOT_EVERY = TICK_HZ / 2;

// Effect timings (ticks) and sizes (milli-tiles), from sects.json skill text.
const FX = {
  metalCritPct: 15,
  metalEvery: 6,
  woodPoisonDps: 10,
  woodPoisonTicks: 3 * TICK_HZ,
  woodRootEvery: 8 * TICK_HZ,
  woodRootTicks: 1 * TICK_HZ,
  woodVulnPct: 25,
  waterSlowPct: 30,
  waterSlowTicks: 2 * TICK_HZ,
  waterFreezeEvery: 5,
  waterFreezeTicks: Math.round(1.2 * TICK_HZ),
  waterPushEvery: 12 * TICK_HZ,
  fireBurnDps: 6,
  fireBurnTicks: 3 * TICK_HZ,
  fireSplash: 800,
  fireExplodeDmg: 30,
  earthSplash: TILE,
  earthBellEvery: 10 * TICK_HZ,
  earthBellTicks: 2 * TICK_HZ,
  earthQuakeTicks: 1 * TICK_HZ,
  yyReveal: 3 * TILE,
  yyRatePct: 120,
  dashEvery: 4 * TICK_HZ,
  dashDist: 2 * TILE,
  healEvery: TICK_HZ,
  healRange: 1500,
  healPct: 5,
  mimicTicks: 3 * TICK_HZ,
  bruteArmor: 5,
  adjacencyPct: 115,
};

export function createDefend(stageId: string, seed: number): DefendState {
  const stage = STAGES[stageId];
  if (!stage || !stage.layout) throw new Error(`unknown defend stage ${stageId}`);
  const layout = resolveLayout(stage.layout, stage.variant);
  if (!layout || layout.kind !== 'defend') throw new Error(`layout ${stage.layout} is not a defend layout`);
  const path = toMilli(layout.path);
  return {
    kind: 'defend',
    stageId,
    tick: 0,
    rng: seed >>> 0,
    silver: stage.startSilver ?? 100,
    lives: ECONOMY.startLives,
    wave: 0,
    totalWaves: stage.waves ?? 10,
    phase: 'build',
    spawnQueue: [],
    recipe: 'mixed',
    nextRecipe: 'mixed',
    cardsOffered: 0,
    sealEl: null,
    sealT: 0,
    artCharges: ARTS.map((a) => a.charges),
    spawnT: 0,
    breakT: 0,
    disciples: [],
    enemies: [],
    nextId: 1,
    unlocked: unlockedSects(stageId),
    path,
    pathLen: pathLength(path),
    pathTiles: [...tilesOnPath(layout.path)].sort(),
    blockedTiles: blockedTiles(layout),
    livesLost: 0,
    combosMade: 0,
    peakDisciples: 0,
    artCd: ARTS.map(() => 0),
    bountyMultT: 0,
    revealAllT: 0,
    cards: [],
    offer: null,
    offerT: 0,
    seenTypes: [],
    stars: null,
  };
}

// Sects unlocked up to and including this stage (story order), or all for the training ground.
export function unlockedSects(stageId: string): Element[] {
  const stage = STAGES[stageId];
  if (stage?.unlockAll) return [...SECT_ORDER];
  const out: Element[] = [];
  for (const s of Object.values(STAGES)) {
    if (s.chapter > (stage?.chapter ?? 0)) continue;
    if (s.unlocksSect && compareStage(s.id, stageId) <= 0) out.push(s.unlocksSect as Element);
  }
  for (const g of stage?.guestSects ?? []) if (!out.includes(g as Element)) out.push(g as Element);
  return out;
}

function compareStage(a: string, b: string): number {
  const [ac, as] = a.split('-').map(Number);
  const [bc, bs] = b.split('-').map(Number);
  return (ac ?? 0) - (bc ?? 0) || (as ?? 0) - (bs ?? 0);
}

export function placeCost(sect: Element): number {
  return SECTS[sect].cost;
}

export function upgradeCost(d: Disciple): number {
  if (d.combo || d.level >= MAX_LEVEL) return 0;
  const base = SECTS[d.els[0]!].cost;
  return Math.floor((base * UPGRADE.costPct[d.level]!) / 100);
}

const card = (s: DefendState, kind: string): CardDef | undefined =>
  CARDS.find((c) => c.kind === kind && s.cards.includes(c.id));

export function sellValue(d: Disciple, s?: DefendState): number {
  const pct = (s && card(s, 'sellRefundPct')?.value) || ECONOMY.sellRefundPct;
  return Math.floor((d.spent * pct) / 100);
}

export function canBuild(s: DefendState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return false;
  if (s.pathTiles.includes(`${tx},${ty}`) || s.blockedTiles.includes(`${tx},${ty}`)) return false;
  return !s.disciples.some((d) => d.tx === tx && d.ty === ty);
}

export function findCombo(a: Element, b: Element) {
  return COMBOS.find((c) => (c.from[0] === a && c.from[1] === b) || (c.from[0] === b && c.from[1] === a));
}

const adjacent = (a: Disciple, b: Disciple) => a !== b && Math.abs(a.tx - b.tx) <= 1 && Math.abs(a.ty - b.ty) <= 1;

function applyCommand(s: DefendState, c: Command, ev: SimEvent[]) {
  const err = (msg: string) => ev.push({ e: 'error', msg });
  if (!validCommand(c)) return err('invalid command');
  switch (c.t) {
    case 'place': {
      if (!s.unlocked.includes(c.sect)) return err('sect locked');
      if (!canBuild(s, c.tx, c.ty)) return err('cannot build here');
      const cost = placeCost(c.sect);
      if (s.silver < cost) return err('not enough silver');
      s.silver -= cost;
      const id = s.nextId++;
      s.disciples.push({
        id, els: [c.sect], combo: null, level: 1, tx: c.tx, ty: c.ty,
        x: c.tx * TILE + TILE / 2, y: c.ty * TILE + TILE / 2, cd: 0, hits: 0, spent: cost, rootT: 0, pushT: 0, bellT: 0, target: 'first', offT: 0,
      });
      s.peakDisciples = Math.max(s.peakDisciples, s.disciples.length);
      ev.push({ e: 'placed', id });
      return;
    }
    case 'upgrade': {
      const d = s.disciples.find((x) => x.id === c.id);
      if (!d || d.combo || d.level >= MAX_LEVEL) return err('cannot upgrade');
      const cost = upgradeCost(d);
      if (s.silver < cost) return err('not enough silver');
      s.silver -= cost;
      d.spent += cost;
      d.level++;
      return;
    }
    case 'sell': {
      const i = s.disciples.findIndex((x) => x.id === c.id);
      if (i < 0) return err('no such disciple');
      s.silver += sellValue(s.disciples[i]!, s);
      s.disciples.splice(i, 1);
      return;
    }
    case 'merge': {
      const a = s.disciples.find((x) => x.id === c.a);
      const b = s.disciples.find((x) => x.id === c.b);
      if (!a || !b || !adjacent(a, b)) return err('merge needs two adjacent disciples');
      if (a.combo || b.combo || a.level < MAX_LEVEL || b.level < MAX_LEVEL) return err('both must be max level');
      const combo = findCombo(a.els[0]!, b.els[0]!);
      if (!combo) return err('no combo for this pair');
      if (s.silver < MERGE_FEE) return err('not enough silver');
      s.silver -= MERGE_FEE;
      a.els = [a.els[0]!, b.els[0]!];
      a.combo = combo.id;
      a.spent += b.spent + MERGE_FEE;
      a.cd = 0;
      s.disciples.splice(s.disciples.indexOf(b), 1);
      s.combosMade++;
      ev.push({ e: 'combo', id: a.id, combo: combo.id, nameTh: combo.nameTh });
      return;
    }
    case 'nextWave': {
      if (s.wave >= s.totalWaves) return err('no more waves');
      if (s.phase === 'build') startWave(s, ev);
      else if (s.phase === 'break') {
        s.silver += ECONOMY.earlyCallBonus;
        startWave(s, ev);
      } else if (s.phase === 'spawning' || s.phase === 'clearing') {
        // Calling while enemies are still alive overlaps two waves; the bonus pays for that risk.
        const atStake = s.enemies.reduce((sum, e) => sum + (e.hp > 0 ? e.bounty : 0), 0);
        s.silver += ECONOMY.earlyCallBonus + Math.floor((atStake * ECONOMY.earlyCallPct) / 100);
        startWave(s, ev);
      } else return err('cannot call a wave now');
      return;
    }
    case 'cast': return castArt(s, c.art, ev, err);
    case 'target': {
      const d = s.disciples.find((x) => x.id === c.id);
      if (!d) return err('no such disciple');
      d.target = c.mode;
      return;
    }
    case 'pick': {
      if (s.phase !== 'picking' || !s.offer?.includes(c.card)) return err('no such card on offer');
      pickCard(s, c.card, ev);
      return;
    }
    default:
      return err('command not valid in defend stage');
  }
}

function castArt(s: DefendState, id: string, ev: SimEvent[], err: (m: string) => void) {
  const i = ARTS.findIndex((a) => a.id === id);
  const art = ARTS[i]!;
  if (s.artCd[i]! > 0) return err('art on cooldown');
  const alive = s.enemies.filter((e) => e.hp > 0);
  if (alive.length === 0) return err('no enemies');
  // Free charges first, then each cast costs silver.
  if (s.artCharges[i]! > 0) s.artCharges[i]!--;
  else if (s.silver >= art.rechargeSilver) s.silver -= art.rechargeSilver;
  else return err('not enough silver');
  let x = 0, y = 0;
  switch (art.type) {
    case 'strike': {
      const lead = alive.reduce((a, b) => (b.d > a.d ? b : a));
      x = lead.x; y = lead.y;
      for (const e of alive) if (within(x, y, e.x, e.y, art.radius)) e.hp -= art.dmg;
      break;
    }
    case 'slowAll':
      for (const e of alive) { e.slowT = Math.max(e.slowT, art.duration); e.slowPct = Math.max(e.slowPct, art.pct); }
      break;
    case 'bountyMult':
      s.bountyMultT = art.duration;
      break;
    case 'stunAll':
      for (const e of alive) e.stunT = Math.max(e.stunT, art.duration);
      s.revealAllT = art.duration;
      break;
  }
  s.artCd[i] = art.cooldown;
  ev.push({ e: 'art', art: art.id, x, y });
}

function offerCards(s: DefendState, ev: SimEvent[]) {
  const pool = CARDS.filter((c) => !s.cards.includes(c.id) && (!c.needs || s.unlocked.includes(c.needs)));
  const offer: string[] = [];
  while (offer.length < 3 && pool.length > 0) offer.push(pool.splice(Math.floor(nextRandom(s) * pool.length), 1)[0]!.id);
  if (offer.length === 0) { s.phase = 'break'; s.breakT = ECONOMY.waveBreak; return; }
  s.offer = offer;
  s.offerT = CARD_AUTO_PICK;
  s.phase = 'picking';
  ev.push({ e: 'offer', cards: offer });
}

function pickCard(s: DefendState, id: string, ev: SimEvent[]) {
  s.cards.push(id);
  s.offer = null;
  s.phase = 'break';
  s.breakT = ECONOMY.waveBreak;
  ev.push({ e: 'picked', card: id });
}

const recipeById = (id: string) => WAVE_RECIPES.find((r) => r.id === id) ?? WAVE_RECIPES[0]!;

// Regular enemy types unlocked by this wave, in the stage's order (a new one every 2 waves). Bosses only come
// from scriptedWaves.
function availableTypes(stageId: string, wave: number): string[] {
  const types = STAGES[stageId]!.enemies.filter((t) => ENEMIES[t] && !ENEMIES[t]!.boss);
  if (types.length === 0) throw new Error(`stage ${stageId} has no regular enemies`);
  return types.slice(0, Math.min(types.length, 1 + Math.floor((wave - 1) / 2)));
}

const recipeTypes = (stageId: string, wave: number, recipeId: string) => {
  const avail = availableTypes(stageId, wave);
  const r = recipeById(recipeId);
  const picked = r.types.length ? avail.filter((t) => r.types.includes(t)) : avail;
  return picked.length ? picked : avail;
};

// Seeded choice of the next wave's shape: the first two waves teach (mixed), boss waves are mixed + boss,
// and the same shape never repeats twice in a row when there is a choice.
function rollRecipe(s: DefendState, wave: number): string {
  const stage = STAGES[s.stageId]!;
  if (wave <= 2 || stage.scriptedWaves?.[String(wave)]) return 'mixed';
  const avail = availableTypes(s.stageId, wave);
  const pool = (stage.wavePool ?? WAVE_RECIPES.map((r) => r.id)).filter((id) => {
    const r = recipeById(id);
    return r.types.length === 0 || r.types.some((t) => avail.includes(t));
  });
  const choices = pool.length > 1 ? pool.filter((id) => id !== s.recipe) : pool;
  return choices[Math.floor(nextRandom(s) * choices.length)] ?? 'mixed';
}

// Enemies of one wave, in spawn order.
export function waveEntries(stageId: string, wave: number, recipeId: string): QueuedEnemy[] {
  const r = recipeById(recipeId);
  const types = recipeTypes(stageId, wave, recipeId);
  const n = Math.max(1, Math.floor(((4 + wave) * r.countPct) / 100));
  const out: QueuedEnemy[] = [];
  for (let i = 0; i < n; i++) out.push({ type: types[(i + wave) % types.length]!, wave, hpPct: r.hpPct });
  const boss = STAGES[stageId]!.scriptedWaves?.[String(wave)];
  if (boss) out.push({ type: boss, wave, hpPct: 100 });
  return out;
}

// Kept for tools/tests: enemy types of a wave with its default (mixed) shape.
export function waveTypes(stageId: string, wave: number): string[] {
  return waveEntries(stageId, wave, 'mixed').map((q) => q.type);
}

// Next wave summary for the HUD: [type, count] in first-seen order, using the already rolled shape.
export function previewWave(s: DefendState): [string, number][] {
  if (s.wave >= s.totalWaves) return [];
  const counts: [string, number][] = [];
  for (const { type: t } of waveEntries(s.stageId, s.wave + 1, s.nextRecipe)) {
    const row = counts.find((c) => c[0] === t);
    if (row) row[1]++; else counts.push([t, 1]);
  }
  return counts;
}

// Interest is paid when a wave is called: saving is rewarded, but capped by how far you are.
function payInterest(s: DefendState, ev: SimEvent[]) {
  const pct = ECONOMY.interestPct + (hasLevel(s, 'yinyang', 3) ? 1 : 0) + (card(s, 'interestPct')?.value ?? 0);
  const cap = ECONOMY.interestCap + ECONOMY.interestCapPerWave * s.wave;
  const interest = Math.min(cap, Math.floor((s.silver * pct) / 100));
  s.silver += interest;
  ev.push({ e: 'interest', amount: interest });
}

function startWave(s: DefendState, ev: SimEvent[]) {
  payInterest(s, ev);
  s.wave++;
  s.recipe = s.nextRecipe;
  s.spawnQueue.push(...waveEntries(s.stageId, s.wave, s.recipe));
  if (s.phase !== 'spawning') { s.spawnT = 0; s.phase = 'spawning'; }
  if (s.wave < s.totalWaves) s.nextRecipe = rollRecipe(s, s.wave + 1);
  ev.push({ e: 'wave', wave: s.wave });
}

function spawn(s: DefendState, q: QueuedEnemy, ev: SimEvent[], at = 0, small = false): Enemy {
  const type = q.type;
  const def = ENEMIES[type]!;
  // Bosses use their data HP as-is (it is already tuned for their wave); regular enemies scale with the wave curve.
  const base = def.boss ? def.hp : Math.floor((waveHp(def.hp, q.wave) * q.hpPct) / 100);
  let hp = small ? Math.max(1, Math.floor(base / 4)) : Math.max(1, base);
  let speed = def.speed;
  let bounty = small ? 1 : Math.floor((def.bounty * (100 + ECONOMY.bountyGrowthPct * (q.wave - 1))) / 100);
  let elite: (typeof ELITES.affixes)[number] | null = null;
  if (!small && !def.boss && q.wave >= ELITES.fromWave && rollPct(s) < ELITES.chancePct) {
    elite = ELITES.affixes[Math.floor(nextRandom(s) * ELITES.affixes.length)]!;
    hp = Math.floor((hp * elite.hpPct) / 100);
    speed = Math.floor((speed * elite.speedPct) / 100);
    bounty *= ELITES.bountyMult;
  }
  const [x, y] = pointAt(s.path, at);
  const e: Enemy = {
    id: s.nextId++, type, el: def.element, air: def.air, hp, maxHp: hp, d: at, speed,
    bounty, x, y, slowT: 0, slowPct: 0, burnT: 0, burnDps: 0, poison: 0, poisonT: 0,
    poisonDps: 0, stunT: 0, revealed: false, lastEl: null, lastElT: 0, small, age: 0,
    elite: elite?.id ?? null, regenPct: elite?.regenPct ?? 0, phase: 0,
  };
  s.enemies.push(e);
  ev.push({ e: 'spawn', id: e.id });
  if (!small && !s.seenTypes.includes(type)) { s.seenTypes.push(type); ev.push({ e: 'newEnemy', type }); }
  return e;
}

const statPct = (level: number) => UPGRADE.statPct[level - 1]!;

// Poison/burn per second, scaled by level and by the Wu Xing match at the moment it is applied.
const dotDps = (d: Disciple, e: Enemy, base: number, lvl: number) =>
  Math.floor((Math.floor((base * statPct(lvl)) / 100) * overcomePct(d.els, e.el)) / 100);

function discipleStats(s: DefendState, d: Disciple) {
  const defs = d.els.map((el) => SECTS[el]);
  let dmg = d.combo ? defs.reduce((sum, x) => sum + x.dmg, 0) : defs[0]!.dmg;
  dmg = Math.floor((dmg * statPct(d.level)) / 100);
  const neighbours = s.disciples.filter((o) => adjacent(d, o));
  if (isGenerated(d.els, neighbours.map((n) => n.els)))
    dmg = Math.floor((dmg * (card(s, 'adjacencyPct')?.value || FX.adjacencyPct)) / 100);
  const el = card(s, 'elementDmg');
  if (el?.element && d.els.includes(el.element)) dmg = Math.floor((dmg * (100 + el.pct)) / 100);
  const mono = card(s, 'monoSectPct');
  if (mono && s.disciples.every((o) => o.els[0] === s.disciples[0]!.els[0])) dmg = Math.floor((dmg * (100 + mono.pct)) / 100);
  let cooldown = Math.min(...defs.map((x) => x.cooldown));
  if (neighbours.some((n) => n.els.includes('yinyang') && n.level >= 2)) cooldown = Math.floor((cooldown * 100) / FX.yyRatePct);
  return {
    dmg,
    cooldown: Math.max(1, cooldown),
    range: Math.max(...defs.map((x) => x.range)),
    hitsAir: defs.some((x) => x.hitsAir),
    hitsGround: defs.some((x) => x.hitsGround),
  };
}

const canTarget = (e: Enemy, air: boolean, ground: boolean) =>
  e.hp > 0 && (e.air ? air : ground) && (e.type !== 'assassin' || e.revealed);

function dealDamage(s: DefendState, d: Disciple, e: Enemy, raw: number, crit: boolean, ev: SimEvent[]) {
  let pct = overcomePct(d.els, e.el);
  let dmg = Math.floor((raw * pct) / 100);
  if (e.poison > 0 && hasLevel(s, 'wood', 3)) dmg = Math.floor((dmg * (100 + FX.woodVulnPct)) / 100);
  if (e.type === 'mimic' && e.lastElT > 0 && e.lastEl && d.els.includes(e.lastEl)) dmg = Math.floor(dmg / 2);
  const freeze = card(s, 'slowedVuln');
  if (freeze && e.slowT > 0) dmg = Math.floor((dmg * (100 + freeze.pct)) / 100);
  const heavy = card(s, 'vsHeavyPct');
  if (heavy && (e.type === 'brute' || e.type.startsWith('boss'))) dmg = Math.floor((dmg * (100 + heavy.pct)) / 100);
  if (e.type === 'brute' && d.combo !== 'molten_edge') dmg -= FX.bruteArmor;
  dmg = Math.max(1, dmg);
  e.hp -= dmg;
  e.lastEl = d.els[0]!;
  e.lastElT = FX.mimicTicks;
  ev.push({ e: 'hit', from: d.id, to: e.id, dmg, pct, crit, el: d.els[0]! });
}

function hasLevel(s: DefendState, el: Element, level: number) {
  return s.disciples.some((d) => d.els.includes(el) && d.level >= level);
}

const dist2 = (d: Disciple, e: Enemy) => (d.x - e.x) ** 2 + (d.y - e.y) ** 2;

// Target priority chosen per disciple; ties keep the earlier enemy (deterministic).
function better(d: Disciple, e: Enemy, cur: Enemy): boolean {
  switch (d.target) {
    case 'strong': return e.hp > cur.hp;
    case 'weak': return e.hp < cur.hp;
    case 'close': return dist2(d, e) < dist2(d, cur);
    default: return e.d > cur.d;
  }
}

function attack(s: DefendState, d: Disciple, ev: SimEvent[]) {
  if (d.offT > 0) { d.offT--; return; }
  if (s.sealT > 0 && s.sealEl && d.els.includes(s.sealEl)) return;
  d.rootT++; d.pushT++; d.bellT++;
  const st = discipleStats(s, d);
  const lvl = d.level;

  // Timed area skills (earth bell / quake, water push).
  const bellEvery = (card(s, 'bellEverySec')?.value ?? 0) * TICK_HZ || FX.earthBellEvery;
  if (d.els.includes('earth') && lvl >= 2 && d.bellT >= bellEvery) {
    d.bellT = 0;
    const r = lvl >= 3 ? 2 * TILE : TILE;
    const t = d.combo === 'iron_mountain' ? FX.earthBellTicks + TICK_HZ : lvl >= 3 ? FX.earthQuakeTicks : FX.earthBellTicks;
    for (const e of s.enemies)
      if (!e.air && e.hp > 0 && within(d.x, d.y, e.x, e.y, r)) {
        e.stunT = Math.max(e.stunT, t);
        if (d.combo === 'root_quake') { e.poison = Math.min(3, e.poison + 1); e.poisonT = FX.woodPoisonTicks; e.poisonDps = Math.max(e.poisonDps, FX.woodPoisonDps); }
        ev.push({ e: 'stun', id: e.id, by: d.id });
      }
  }

  if (d.cd > 0) { d.cd--; return; }
  let target: Enemy | null = null;
  for (const e of s.enemies) {
    if (!canTarget(e, st.hitsAir, st.hitsGround) || !within(d.x, d.y, e.x, e.y, st.range)) continue;
    if (!target || better(d, e, target)) target = e;
  }
  if (!target) return;
  d.cd = st.cooldown - 1;
  d.hits++;

  let crit = false;
  if (d.els.includes('metal')) crit = rollPct(s) < FX.metalCritPct + (card(s, 'critChance')?.pct ?? 0) || (lvl >= 2 && d.hits % FX.metalEvery === 0);
  if (d.combo === 'frozen_blade' && target.stunT > 0) crit = true;
  const raw = crit ? st.dmg * 2 : st.dmg;
  dealDamage(s, d, target, raw, crit, ev);

  for (const el of d.els) {
    switch (el) {
      case 'metal':
        if (crit && lvl >= 3) {
          const second = s.enemies.find((e) => e !== target && canTarget(e, st.hitsAir, st.hitsGround) && within(d.x, d.y, e.x, e.y, st.range));
          if (second) dealDamage(s, d, second, raw, true, ev);
        }
        break;
      case 'wood':
        target.poison = Math.min(3, target.poison + 1);
        target.poisonT = FX.woodPoisonTicks;
        target.poisonDps = Math.max(target.poisonDps, dotDps(d, target, FX.woodPoisonDps, lvl));
        if (lvl >= 2 && d.rootT >= FX.woodRootEvery) {
          d.rootT = 0;
          target.stunT = Math.max(target.stunT, FX.woodRootTicks);
          ev.push({ e: 'stun', id: target.id, by: d.id });
        }
        break;
      case 'water':
        target.slowT = FX.waterSlowTicks;
        target.slowPct = Math.max(target.slowPct, FX.waterSlowPct);
        if (lvl >= 2 && d.hits % FX.waterFreezeEvery === 0) {
          target.stunT = Math.max(target.stunT, FX.waterFreezeTicks);
          ev.push({ e: 'stun', id: target.id, by: d.id });
        }
        if (lvl >= 3 && d.pushT >= FX.waterPushEvery) { d.pushT = 0; target.d = Math.max(0, target.d - TILE); }
        break;
      case 'fire': {
        for (const e of s.enemies)
          if (e.hp > 0 && (e === target || within(target.x, target.y, e.x, e.y, FX.fireSplash))) {
            e.burnT = FX.fireBurnTicks;
            e.burnDps = Math.max(e.burnDps, dotDps(d, e, FX.fireBurnDps, lvl));
          }
        break;
      }
      case 'earth': {
        const volcano = d.combo === 'volcano_fist';
        const r = volcano ? (FX.earthSplash * 3) / 2 : FX.earthSplash;
        for (const e of s.enemies)
          if (e !== target && !e.air && e.hp > 0 && within(target.x, target.y, e.x, e.y, r))
            dealDamage(s, d, e, volcano ? raw : Math.floor(raw / 2), false, ev);
        break;
      }
      case 'yinyang':
        break;
    }
  }
  if (d.combo) comboOnHit(s, d, target, crit);
}

// Simplified signature effect of each combo technique (sects.json comboTechniques). Effects that
// act outside a hit live where they trigger: iron_mountain/root_quake in the bell, molten_edge in
// dealDamage, frozen_blade in the crit roll, volcano_fist in the earth splash, wildfire_flute on death.
export const COMBO_EFFECTS = [
  'frozen_blade', 'thorn_sword', 'molten_edge', 'iron_mountain', 'spring_rain',
  'steam_palm', 'quicksand', 'wildfire_flute', 'root_quake', 'volcano_fist',
] as const;

function comboOnHit(s: DefendState, d: Disciple, target: Enemy, crit: boolean) {
  const splash = (r: number, f: (e: Enemy) => void) => {
    for (const e of s.enemies) if (e.hp > 0 && (e === target || within(target.x, target.y, e.x, e.y, r))) f(e);
  };
  switch (d.combo) {
    case 'thorn_sword':
      if (crit) { target.poison = 3; target.poisonT = FX.woodPoisonTicks; target.poisonDps = Math.max(target.poisonDps, FX.woodPoisonDps); }
      break;
    case 'spring_rain':
      splash(TILE, (e) => {
        e.slowT = FX.waterSlowTicks; e.slowPct = Math.max(e.slowPct, FX.waterSlowPct);
        e.poison = Math.min(3, e.poison + 1); e.poisonT = FX.woodPoisonTicks; e.poisonDps = Math.max(e.poisonDps, FX.woodPoisonDps);
      });
      break;
    case 'steam_palm':
      splash(FX.fireSplash, (e) => { e.slowT = FX.waterSlowTicks; e.slowPct = Math.max(e.slowPct, FX.waterSlowPct); });
      break;
    case 'quicksand':
      target.slowPct = Math.max(target.slowPct, 50);
      break;
  }
}

function moveEnemies(s: DefendState, ev: SimEvent[]) {
  const yy = s.disciples.filter((d) => d.els.includes('yinyang'));
  for (const e of s.enemies) {
    e.age++;
    // Assassins show up when stunned/slowed (any sect can answer them), near a Taiji disciple, or by Lion's Roar.
    e.revealed = s.revealAllT > 0 || e.stunT > 0 || e.slowT > 0 || yy.some((d) => within(d.x, d.y, e.x, e.y, FX.yyReveal));
    if (e.lastElT > 0) e.lastElT--;
    if (e.age % DOT_EVERY === 0) {
      const armour = e.type === 'brute' ? 2 : 1; // Iron Shirt halves damage over time too
      if (e.burnT > 0) e.hp -= Math.max(1, Math.floor(e.burnDps / 2 / armour));
      if (e.poisonT > 0 && e.poison > 0) e.hp -= Math.max(1, Math.floor((e.poison * e.poisonDps) / 2 / armour));
    }
    if (e.burnT > 0) e.burnT--;
    if (e.poisonT > 0) e.poisonT--; else e.poison = 0;
    if (e.regenPct > 0 && e.age % TICK_HZ === 0) e.hp = Math.min(e.maxHp, e.hp + Math.floor((e.maxHp * e.regenPct) / 100));
    if (e.type === 'healer' && e.age % FX.healEvery === 0)
      for (const o of s.enemies)
        if (o !== e && o.hp > 0 && within(e.x, e.y, o.x, o.y, FX.healRange))
          o.hp = Math.min(o.maxHp, o.hp + Math.floor((o.maxHp * FX.healPct) / 100));
    if (e.stunT > 0) { e.stunT--; continue; }
    let sp = e.speed;
    if (e.slowT > 0) { e.slowT--; sp = Math.floor((sp * (100 - e.slowPct)) / 100); } else e.slowPct = 0;
    e.d += sp;
    if (e.type === 'runner' && e.age % FX.dashEvery === 0) e.d += FX.dashDist;
    [e.x, e.y] = pointAt(s.path, e.d);
  }
  // Leaks.
  for (const e of s.enemies)
    if (e.hp > 0 && e.d >= s.pathLen) {
      e.hp = 0;
      e.bounty = 0;
      const cost = ENEMIES[e.type]!.leakCost;
      s.lives = Math.max(0, s.lives - cost);
      s.livesLost += cost;
      ev.push({ e: 'leak', id: e.id });
    }
}

// Boss mechanics fire once per HP threshold (enemies.json bosses[].mechanics).
function bossPhases(s: DefendState, ev: SimEvent[]) {
  for (const e of s.enemies) {
    const m = ENEMIES[e.type]!.boss;
    if (!m || e.hp <= 0) continue;
    while (e.phase < m.phasesPct.length && e.hp * 100 <= e.maxHp * m.phasesPct[e.phase]!) {
      e.phase++;
      if (m.effect === 'disable') {
        for (let k = 0; k < m.count; k++) {
          const free = s.disciples.filter((d) => d.offT === 0);
          if (free.length === 0) break;
          const d = free[Math.floor(nextRandom(s) * free.length)]!;
          d.offT = m.ticks;
          ev.push({ e: 'disable', id: d.id, by: e.id });
        }
      } else if (m.effect === 'seal' && s.disciples.length > 0) {
        // Seal the sect the player leans on most (ties: sect order), so one-sect builds must adapt.
        let best: Element | null = null, bestN = 0;
        for (const el of SECT_ORDER) {
          const n = s.disciples.filter((d) => d.els[0] === el).length;
          if (n > bestN) { best = el; bestN = n; }
        }
        s.sealEl = best;
        s.sealT = m.ticks;
        ev.push({ e: 'seal', el: best!, by: e.id });
      }
    }
  }
}

function resolveDeaths(s: DefendState, ev: SimEvent[]) {
  const dead = s.enemies.filter((e) => e.hp <= 0);
  if (dead.length === 0) return;
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  const yy3 = s.disciples.filter((d) => d.els.includes('yinyang') && d.level >= 3);
  const fireExplodes = hasLevel(s, 'fire', 2);
  for (const e of dead) {
    if (e.bounty === 0 && e.d >= s.pathLen) continue; // leaked
    let bounty = e.bounty;
    if (yy3.some((d) => within(d.x, d.y, e.x, e.y, FX.yyReveal))) bounty++;
    bounty += card(s, 'bountyFlat')?.value ?? 0;
    if (s.bountyMultT > 0) bounty *= 2;
    s.silver += bounty;
    ev.push({ e: 'kill', id: e.id, x: e.x, y: e.y, bounty });
    if (e.type === 'puppet' && !e.small) for (let i = 0; i < 3; i++) spawn(s, { type: 'puppet', wave: s.wave, hpPct: 100 }, ev, Math.max(0, e.d - i * 300), true);
    if (e.burnT > 0 && s.disciples.some((q) => q.combo === 'wildfire_flute')) {
      const near = s.enemies.filter((o) => o.hp > 0 && within(e.x, e.y, o.x, o.y, 1500)).slice(0, 2);
      for (const o of near) { o.burnT = FX.fireBurnTicks; o.burnDps = Math.max(o.burnDps, e.burnDps); }
    }
    if (fireExplodes && e.burnT > 0)
      for (const o of s.enemies) if (within(e.x, e.y, o.x, o.y, TILE)) o.hp -= FX.fireExplodeDmg;
  }
}

function waveFlow(s: DefendState, ev: SimEvent[]) {
  switch (s.phase) {
    case 'build':
      if (s.tick >= AUTO_START_TICKS) startWave(s, ev);
      break;
    case 'spawning':
      if (s.spawnT > 0) s.spawnT--;
      else {
        const q = s.spawnQueue.shift();
        if (q) spawn(s, q, ev);
        s.spawnT = ECONOMY.spawnInterval - 1;
        if (s.spawnQueue.length === 0) s.phase = 'clearing';
      }
      break;
    case 'clearing':
      if (s.enemies.length === 0) {
        if (s.wave >= s.totalWaves) finish(s, true, ev);
        else if (Math.floor(s.wave / CARD_EVERY_WAVES) > s.cardsOffered) {
          s.cardsOffered = Math.floor(s.wave / CARD_EVERY_WAVES);
          offerCards(s, ev);
        } else { s.phase = 'break'; s.breakT = ECONOMY.waveBreak; }
      }
      break;
    case 'break':
      if (--s.breakT <= 0) startWave(s, ev);
      break;
    case 'picking':
      if (--s.offerT <= 0 && s.offer) pickCard(s, s.offer[0]!, ev); // idle-friendly auto pick
      break;
  }
}

export function evaluateStars(s: DefendState, won: boolean): boolean[] {
  const stage = STAGES[s.stageId]!;
  return stage.stars.map((key) => {
    if (!won) return false;
    switch (key) {
      case 'clear': return true;
      case 'no_life_lost': return s.livesLost === 0;
      case 'under_3min': return s.tick <= 3 * 60 * TICK_HZ;
      case 'hold_200_silver': return s.silver >= 200;
      case 'max_6_disciples': return s.peakDisciples <= 6;
      case 'use_combo': return s.combosMade > 0;
      default: return false;
    }
  });
}

function finish(s: DefendState, won: boolean, ev: SimEvent[]) {
  s.phase = won ? 'won' : 'lost';
  s.stars = evaluateStars(s, won);
  ev.push({ e: 'end', won, stars: s.stars });
}

export function stepDefend(s: DefendState, commands: Command[]): SimEvent[] {
  const ev: SimEvent[] = [];
  if (s.phase === 'won' || s.phase === 'lost') return ev;
  for (const c of commands) applyCommand(s, c, ev);
  for (let i = 0; i < s.artCd.length; i++) if (s.artCd[i]! > 0) s.artCd[i]!--;
  if (s.bountyMultT > 0) s.bountyMultT--;
  if (s.revealAllT > 0) s.revealAllT--;
  if (s.sealT > 0 && --s.sealT === 0) s.sealEl = null;
  waveFlow(s, ev);
  moveEnemies(s, ev);
  for (const d of s.disciples) attack(s, d, ev);
  bossPhases(s, ev);
  resolveDeaths(s, ev);
  s.tick++;
  if (s.lives <= 0) finish(s, false, ev);
  return ev;
}
