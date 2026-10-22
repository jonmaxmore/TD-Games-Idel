import { COMBOS, ECONOMY, ENEMIES, SECTS, SECT_ORDER, STAGES, TICK_HZ, TILE, UPGRADE, waveHp, type Element } from './data';
import { GRID_H, GRID_W, LAYOUTS, tilesOnPath } from './layouts';
import { pathLength, pointAt, toMilli, within } from './path';
import { rollPct } from './rng';
import { validCommand } from './commands';
import type { Command, DefendState, Disciple, Enemy, SimEvent } from './types';
import { isGenerated, overcomePct } from './wuxing';

const MAX_LEVEL = UPGRADE.levels;
const AUTO_START_TICKS = 30 * TICK_HZ;
const DOT_EVERY = TICK_HZ / 2;

// Effect timings (ticks) and sizes (milli-tiles), from sects.json skill text.
const FX = {
  metalCritPct: 15,
  metalEvery: 6,
  woodPoisonDps: 8,
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
  const layout = LAYOUTS[stage.layout];
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
    spawnT: 0,
    breakT: 0,
    disciples: [],
    enemies: [],
    nextId: 1,
    unlocked: unlockedSects(stageId),
    path,
    pathLen: pathLength(path),
    pathTiles: [...tilesOnPath(layout.path)].sort(),
    livesLost: 0,
    combosMade: 0,
    peakDisciples: 0,
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

export function sellValue(d: Disciple): number {
  return Math.floor((d.spent * ECONOMY.sellRefundPct) / 100);
}

export function canBuild(s: DefendState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return false;
  if (s.pathTiles.includes(`${tx},${ty}`)) return false;
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
        x: c.tx * TILE + TILE / 2, y: c.ty * TILE + TILE / 2, cd: 0, hits: 0, spent: cost, rootT: 0, pushT: 0, bellT: 0,
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
      s.silver += sellValue(s.disciples[i]!);
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
      a.els = [a.els[0]!, b.els[0]!];
      a.combo = combo.id;
      a.spent += b.spent;
      a.cd = 0;
      s.disciples.splice(s.disciples.indexOf(b), 1);
      s.combosMade++;
      ev.push({ e: 'combo', id: a.id, combo: combo.id, nameTh: combo.nameTh });
      return;
    }
    case 'nextWave': {
      if (s.phase === 'build') startWave(s, ev);
      else if (s.phase === 'break') {
        s.silver += ECONOMY.earlyCallBonus;
        startWave(s, ev);
      }
      return;
    }
    default:
      return err('command not valid in defend stage');
  }
}

function startWave(s: DefendState, ev: SimEvent[]) {
  s.wave++;
  const stage = STAGES[s.stageId]!;
  const types = stage.enemies.filter((t) => ENEMIES[t] && !t.startsWith('boss'));
  if (types.length === 0) throw new Error(`stage ${s.stageId} has no regular enemies`);
  const available = types.slice(0, Math.min(types.length, 1 + Math.floor((s.wave - 1) / 2)));
  const count = 4 + s.wave;
  s.spawnQueue = [];
  for (let i = 0; i < count; i++) s.spawnQueue.push(available[(i + s.wave) % available.length]!);
  s.spawnT = 0;
  s.phase = 'spawning';
  ev.push({ e: 'wave', wave: s.wave });
}

function spawn(s: DefendState, type: string, ev: SimEvent[], at = 0, small = false): Enemy {
  const def = ENEMIES[type]!;
  const hp = small ? Math.max(1, Math.floor(waveHp(def.hp, s.wave) / 4)) : waveHp(def.hp, s.wave);
  const [x, y] = pointAt(s.path, at);
  const e: Enemy = {
    id: s.nextId++, type, el: def.element, air: def.air, hp, maxHp: hp, d: at, speed: def.speed,
    bounty: small ? 1 : Math.floor((def.bounty * (100 + ECONOMY.bountyGrowthPct * (s.wave - 1))) / 100), x, y, slowT: 0, slowPct: 0, burnT: 0, burnDps: 0, poison: 0, poisonT: 0,
    poisonDps: 0, stunT: 0, revealed: false, lastEl: null, lastElT: 0, small, age: 0,
  };
  s.enemies.push(e);
  ev.push({ e: 'spawn', id: e.id });
  return e;
}

const statPct = (level: number) => UPGRADE.statPct[level - 1]!;

function discipleStats(s: DefendState, d: Disciple) {
  const defs = d.els.map((el) => SECTS[el]);
  let dmg = d.combo ? defs.reduce((sum, x) => sum + x.dmg, 0) : defs[0]!.dmg;
  dmg = Math.floor((dmg * statPct(d.level)) / 100);
  const neighbours = s.disciples.filter((o) => adjacent(d, o));
  if (isGenerated(d.els, neighbours.map((n) => n.els))) dmg = Math.floor((dmg * FX.adjacencyPct) / 100);
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

function attack(s: DefendState, d: Disciple, ev: SimEvent[]) {
  d.rootT++; d.pushT++; d.bellT++;
  const st = discipleStats(s, d);
  const lvl = d.level;

  // Timed area skills (earth bell / quake, water push).
  if (d.els.includes('earth') && lvl >= 2 && d.bellT >= FX.earthBellEvery) {
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
    if (!target || e.d > target.d) target = e;
  }
  if (!target) return;
  d.cd = st.cooldown - 1;
  d.hits++;

  let crit = false;
  if (d.els.includes('metal')) crit = rollPct(s) < FX.metalCritPct || (lvl >= 2 && d.hits % FX.metalEvery === 0);
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
        target.poisonDps = Math.max(target.poisonDps, Math.floor((FX.woodPoisonDps * statPct(lvl)) / 100));
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
        const dps = Math.floor((FX.fireBurnDps * statPct(lvl)) / 100);
        for (const e of s.enemies)
          if (e.hp > 0 && (e === target || within(target.x, target.y, e.x, e.y, FX.fireSplash))) {
            e.burnT = FX.fireBurnTicks;
            e.burnDps = Math.max(e.burnDps, dps);
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
    e.revealed = yy.some((d) => within(d.x, d.y, e.x, e.y, FX.yyReveal));
    if (e.lastElT > 0) e.lastElT--;
    if (e.age % DOT_EVERY === 0) {
      if (e.burnT > 0) e.hp -= Math.max(1, Math.floor(e.burnDps / 2));
      if (e.poisonT > 0 && e.poison > 0) e.hp -= Math.max(1, Math.floor((e.poison * e.poisonDps) / 2));
    }
    if (e.burnT > 0) e.burnT--;
    if (e.poisonT > 0) e.poisonT--; else e.poison = 0;
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
      s.lives = Math.max(0, s.lives - 1);
      s.livesLost++;
      ev.push({ e: 'leak', id: e.id });
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
    s.silver += bounty;
    ev.push({ e: 'kill', id: e.id, x: e.x, y: e.y, bounty });
    if (e.type === 'puppet' && !e.small) for (let i = 0; i < 3; i++) spawn(s, 'puppet', ev, Math.max(0, e.d - i * 300), true);
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
        const type = s.spawnQueue.shift();
        if (type) spawn(s, type, ev);
        s.spawnT = ECONOMY.spawnInterval - 1;
        if (s.spawnQueue.length === 0) s.phase = 'clearing';
      }
      break;
    case 'clearing':
      if (s.enemies.length === 0) {
        const pct = ECONOMY.interestPct + (hasLevel(s, 'yinyang', 3) ? 1 : 0);
        const interest = Math.min(ECONOMY.interestCap, Math.floor((s.silver * pct) / 100));
        s.silver += interest;
        ev.push({ e: 'interest', amount: interest });
        if (s.wave >= s.totalWaves) finish(s, true, ev);
        else { s.phase = 'break'; s.breakT = ECONOMY.waveBreak; }
      }
      break;
    case 'break':
      if (--s.breakT <= 0) startWave(s, ev);
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
  waveFlow(s, ev);
  moveEnemies(s, ev);
  for (const d of s.disciples) attack(s, d, ev);
  resolveDeaths(s, ev);
  s.tick++;
  if (s.lives <= 0) finish(s, false, ev);
  return ev;
}
