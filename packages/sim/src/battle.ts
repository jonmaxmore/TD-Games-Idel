// Castle battle rules (SPEC-castle-battle): two castles on one path, summoned units walk and fight by themselves.
// One tick at a time, integers only, seeded RNG. Every unit picks its action from where things stood at the start
// of the tick, then the moves are applied and the dead removed, so neither side acts first.
// Positions are path distances in milli-tiles from side 0's castle; fwd() turns one into a side's own depth.
import { battle as B, battleCardIds, battleUnits, type BattleUnitDef } from './data';
import { div, fnv1a, nextRandom, pathLength, pointAt, rollPct, toMilli, wuxingPct } from './core';

export type Side = 0 | 1;
// d: depth from the side's own castle. redraw: deal the drawn part of the hand again, only before the first tick.
export type BattleCommand =
  | { t: 'summon'; side: Side; card: string; d: number }
  | { t: 'redraw'; side: Side }
  | { t: 'art'; side: Side };
// A side's team: the cards it owns (collection), the owned cards kept out of the draw (bench), its leader and sub-leader.
// hand: a fixed hand used as dealt, with no redraw (unit tests, scripted PvE sides).
export interface BattleSetup { leader: string; sub: string; collection: readonly string[]; bench: readonly string[]; hand?: readonly string[] }
export const fixedHand = (cards: readonly string[], leader = '', sub = ''): BattleSetup => ({ leader, sub, collection: cards, bench: [], hand: cards });
// What a tick did, for the view and sound (never read back by the rules). x, y: where, in milli-tiles.
// side: who summoned, captured or won (-1 on end = draw); heal: amount = HP restored; hit on a structure: to = -1,
// type 'fort' | 'castle' and id = fort index or castle side; from < 0 is a structure shooting (-1 - side castle, -10 - i fort).
export interface BattleEvent {
  e: 'spawn' | 'hit' | 'heal' | 'kill' | 'stun' | 'art' | 'capture' | 'neutral' | 'end' | 'error';
  id?: number; from?: number; to?: number; dmg?: number; amount?: number; crit?: boolean; el?: string | null;
  type?: string; side?: number; name?: string; msg?: string; won?: boolean; x?: number; y?: number;
}

export interface Fighter {
  id: number; side: Side; card: string; d: number; hp: number; maxHp: number; cd: number; home: number; aura: number; // aura: % more damage it gives allies near it
  stunT: number; burnT: number; poison: number; poisonT: number; rootT: number; slowT: number;
}
// Burning ground: ground enemies of side within groundRadius of d keep burning while t > 0.
export interface Zone { side: Side; d: number; t: number }
// An on-hit effect waiting for the end of the tick, so every unit acts on the same picture (u null: ground only).
interface Pending { side: Side; d: number; u: Fighter | null; def: BattleUnitDef }
export interface Fort { d: number; owner: Side | null; hp: number; cd: number; capSide: Side | null; capT: number }
export interface Castle { hp: number; cd: number; artUsed: boolean }
export interface BattleState {
  tick: number; rng: number; nextId: number;
  setups: [BattleSetup, BattleSetup]; deal: [{ rng: number }, { rng: number }]; redraws: [number, number];
  hands: [string[], string[]]; uses: [number[], number[]]; mana: [number, number]; // uses: summons per hand slot
  castles: [Castle, Castle]; forts: Fort[]; units: Fighter[]; zones: Zone[];
  winner: Side | -1 | null; // null while the match runs, -1 = draw
}

export const BATTLE_PATH = toMilli(B.path);
export const BATTLE_LEN = pathLength(BATTLE_PATH);
const SUMMON_BASE = div(BATTLE_LEN * B.summonBasePct, 100);
const DOT_EVERY = 10;

export const fwd = (side: Side, d: number) => (side === 0 ? d : BATTLE_LEN - d);
const other = (side: Side): Side => (side === 0 ? 1 : 0);
const defOf = (u: Fighter): BattleUnitDef => battleUnits.get(u.card)!;
const at = (d: number) => pointAt(BATTLE_PATH, d);
const isOver = (s: BattleState) => s.winner !== null;
export { isOver as battleOver };

// The hand: the basic capturer of the leader's sect, the leader, the sub-leader, then the collection minus the bench in
// a seeded shuffle, skipping large cards once the hand holds maxLarge of them, until it has hand.size cards.
function dealHand(setup: BattleSetup, r: { rng: number }): string[] {
  if (setup.hand) return [...setup.hand];
  const sect = battleUnits.get(setup.leader)?.sect ?? '';
  const fixed = [B.hand.basic.get(sect) ?? '', setup.leader, setup.sub].filter((c, i, a) => battleUnits.has(c) && a.indexOf(c) === i);
  const pool = battleCardIds.filter((c) => setup.collection.includes(c) && !setup.bench.includes(c) && !fixed.includes(c));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(r) * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const hand = [...fixed];
  let large = hand.filter((c) => battleUnits.get(c)!.size === 'large').length;
  for (const c of pool) {
    if (hand.length >= B.hand.size) break;
    if (battleUnits.get(c)!.size === 'large') { if (large >= B.hand.maxLarge) continue; large++; }
    hand.push(c);
  }
  return hand;
}

// A sect's whole roster as the collection, with its default leader and sub-leader (battle.json > sectTeams).
export function sectSetup(sect: string): BattleSetup {
  const t = B.sectTeams.get(sect)!;
  return { leader: t.leader, sub: t.sub, collection: battleCardIds.filter((c) => battleUnits.get(c)!.sect === sect), bench: [] };
}

export function createBattle(seed: number, setup0: BattleSetup, setup1: BattleSetup): BattleState {
  const castle = (): Castle => ({ hp: B.castle.hp, cd: 0, artUsed: false });
  const deal: [{ rng: number }, { rng: number }] = [{ rng: (seed ^ 0x9e3779b9) >>> 0 }, { rng: (seed ^ 0x7f4a7c15) >>> 0 }];
  const hands: [string[], string[]] = [dealHand(setup0, deal[0]), dealHand(setup1, deal[1])];
  return {
    tick: 0, rng: seed >>> 0, nextId: 1,
    setups: [setup0, setup1], deal, redraws: [0, 0],
    hands, uses: [hands[0].map(() => 0), hands[1].map(() => 0)], mana: [B.manaStart, B.manaStart],
    castles: [castle(), castle()],
    forts: B.forts.atPct.map((p) => ({ d: div(BATTLE_LEN * p, 100), owner: null, hp: B.forts.hp, cd: 0, capSide: null, capT: 0 })),
    units: [], zones: [], winner: null,
  };
}

// How deep (own depth) a side may summon: its deepest fort or the base zone, and never within the gap of an enemy;
// the castle gate (homeZone) stays open whatever stands there, so a side can always defend its castle.
export function summonZone(s: BattleState, side: Side): number {
  let end = SUMMON_BASE;
  for (const f of s.forts) if (f.owner === side) end = Math.max(end, fwd(side, f.d));
  for (const u of s.units) if (u.side !== side) end = Math.min(end, fwd(side, u.d) - B.summonGap);
  return Math.max(end, B.homeZone);
}

const err = (ev: BattleEvent[], msg: string): void => void ev.push({ e: 'error', msg });

function redraw(s: BattleState, side: Side, ev: BattleEvent[]): void {
  if (s.tick !== 0) return err(ev, 'redraw only before the match');
  if (s.setups[side].hand || s.redraws[side] >= B.hand.redraws) return err(ev, 'no redraws left');
  s.redraws[side]++;
  s.hands[side] = dealHand(s.setups[side], s.deal[side]);
  s.uses[side] = s.hands[side].map(() => 0);
}

// A card's ability level on a team: 3 as the leader, 2 as the sub-leader, 1 otherwise; its value at that level (0: none).
export const cardLevel = (setup: BattleSetup, card: string) => (card === setup.leader ? 3 : card === setup.sub ? 2 : 1);
export const abilityValue = (def: BattleUnitDef, level: number) => def.ability?.lv[level - 1] ?? 0;
// The strongest aura of an ally (itself too) within reach: the % more damage u deals.
function auraAt(s: BattleState, u: Fighter): number {
  let best = 0;
  for (const a of s.units) if (a.side === u.side && a.aura > best && Math.abs(a.d - u.d) <= B.auraRadius) best = a.aura;
  return best;
}

function summon(s: BattleState, c: Extract<BattleCommand, { t: 'summon' }>, ev: BattleEvent[]): void {
  const slot = s.hands[c.side].indexOf(c.card ?? '');
  const def = battleUnits.get(c.card ?? '');
  if (slot < 0 || def == null) return err(ev, 'card not in hand');
  if (s.mana[c.side] < def.mana) return err(ev, 'not enough mana');
  const cap = B.sizes.get(def.size)!.perMatch;
  if (cap != null && s.uses[c.side][slot]! >= cap) return err(ev, 'card used up');
  const d = c.d ?? -1;
  if (!Number.isInteger(d) || d < 0 || d > summonZone(s, c.side)) return err(ev, 'outside summon zone');
  s.mana[c.side] -= def.mana;
  s.uses[c.side][slot]!++;
  const v = abilityValue(def, cardLevel(s.setups[c.side], def.id)), kind = def.ability?.kind;
  if (kind === 'refund') s.mana[c.side] = Math.min(B.manaMax, s.mana[c.side] + v);
  const abs = fwd(c.side, d), hp = kind === 'hp' ? div(def.hp * (100 + v), 100) : def.hp;
  const u: Fighter = { id: s.nextId++, side: c.side, card: def.id, d: abs, hp, maxHp: hp, cd: 0, home: abs, aura: kind === 'aura' ? v : 0, stunT: 0, burnT: 0, poison: 0, poisonT: 0, rootT: 0, slowT: 0 };
  s.units.push(u);
  ev.push({ e: 'spawn', id: u.id, type: def.id, side: c.side, ...at(abs) });
}

function castArt(s: BattleState, side: Side, ev: BattleEvent[]): void {
  const c = s.castles[side];
  if (c.artUsed) return err(ev, 'art used');
  c.artUsed = true;
  ev.push({ e: 'art', side, name: 'binding_bell' });
  for (const u of s.units)
    if (u.side !== side && fwd(side, u.d) <= div(BATTLE_LEN, 2)) {
      u.stunT = B.castle.artStunTicks;
      ev.push({ e: 'stun', id: u.id, ...at(u.d) });
    }
}

const canHit = (a: BattleUnitDef, t: Fighter) => (defOf(t).move === 'fly' ? a.hitsAir : a.hitsGround);

// The enemy in range nearest our castle (lowest own depth), lower id on ties. Fliers only stop for fliers.
function pickEnemy(s: BattleState, u: Fighter, def: BattleUnitDef): Fighter | null {
  let best: Fighter | null = null;
  for (const e of s.units) {
    if (e.side === u.side || Math.abs(e.d - u.d) > def.range || !canHit(def, e)) continue;
    if (def.move === 'fly' && defOf(e).move !== 'fly') continue;
    if (best == null || fwd(u.side, e.d) < fwd(u.side, best.d)) best = e;
  }
  return best;
}

function damage(s: BattleState, from: number, u: Fighter, def: BattleUnitDef | null, raw: number, ev: BattleEvent[]): void {
  let dmg = def ? div(raw * wuxingPct([def.sect], defOf(u).sect), 100) : raw;
  const crit = def?.kit === 'metal' && rollPct(s) < B.critPct;
  if (crit) dmg *= 2;
  if (!def?.pierce) dmg = Math.max(1, dmg - defOf(u).armor);
  u.hp -= dmg;
  if (def?.dot === 'burn') u.burnT = B.burnTicks;
  if (def?.dot === 'poison') { u.poison = Math.min(B.poisonMax, u.poison + 1); u.poisonT = B.poisonTicks; }
  ev.push({ e: 'hit', from, to: u.id, dmg, crit, el: def?.sect ?? null, ...at(u.d) });
}

// Structures shoot the enemy in range nearest them (lower id on ties).
function shoot(s: BattleState, side: Side, d: number, st: { cd: number }, stats: { dmg: number; cooldown: number; range: number }, from: number, ev: BattleEvent[]): void {
  if (st.cd > 0) { st.cd--; return; }
  let best: Fighter | null = null;
  for (const e of s.units)
    if (e.side !== side && Math.abs(e.d - d) <= stats.range && (best == null || Math.abs(e.d - d) < Math.abs(best.d - d))) best = e;
  if (best == null) return;
  st.cd = stats.cooldown - 1;
  damage(s, from, best, null, stats.dmg, ev);
}

// Structure a walker hits when no enemy is in range: the nearest enemy fort ahead (march/fly), else the enemy castle.
function pickStructure(s: BattleState, u: Fighter, def: BattleUnitDef): Fort | Castle | null {
  const me = fwd(u.side, u.d);
  let best: Fort | null = null;
  if (def.move === 'march' || def.move === 'fly')
    for (const f of s.forts) {
      const ahead = fwd(u.side, f.d) - me;
      if (f.owner === other(u.side) && ahead >= 0 && ahead <= def.range && (best == null || fwd(u.side, f.d) < fwd(u.side, best.d))) best = f;
    }
  if (best != null) return best;
  if (BATTLE_LEN - me <= def.range && def.move !== 'guard' && def.move !== 'support') return s.castles[other(u.side)];
  return null;
}

// The fort ahead a capture unit stops on: the first one that is not ours.
function captureStop(s: BattleState, u: Fighter): Fort | null {
  let best: Fort | null = null;
  const me = fwd(u.side, u.d);
  for (const f of s.forts)
    if (f.owner !== u.side && fwd(u.side, f.d) >= me - B.forts.captureRadius && (best == null || fwd(u.side, f.d) < fwd(u.side, best.d))) best = f;
  return best;
}

// Acts on the start-of-tick picture; returns where it wants to stand (own depth), or null to hold.
function act(s: BattleState, u: Fighter, ev: BattleEvent[], pend: Pending[]): number | null {
  const def = defOf(u);
  if (u.cd > 0) u.cd--;
  const rooted = u.rootT > 0, slowed = u.slowT > 0;
  if (rooted) u.rootT--;
  if (slowed) u.slowT--;
  if (u.stunT > 0) { u.stunT--; return null; }
  const me = fwd(u.side, u.d);
  if (def.move === 'support') {
    let hurt: Fighter | null = null;
    for (const a of s.units)
      if (a.side === u.side && a !== u && a.hp < a.maxHp && Math.abs(a.d - u.d) <= def.range && (hurt == null || a.maxHp - a.hp > hurt.maxHp - hurt.hp)) hurt = a;
    if (hurt != null && u.cd === 0) {
      u.cd = def.cooldown;
      const amount = Math.min(B.supportHeal, hurt.maxHp - hurt.hp);
      hurt.hp += amount;
      ev.push({ e: 'heal', from: u.id, to: hurt.id, amount, ...at(hurt.d) });
      return null;
    }
  }
  const enemy = pickEnemy(s, u, def);
  const dmg = div(def.dmg * (100 + auraAt(s, u)), 100);
  if (enemy != null) {
    if (u.cd === 0) {
      u.cd = def.cooldown;
      for (const e of s.units)
        if (e === enemy || (def.splash > 0 && e.side !== u.side && Math.abs(e.d - enemy.d) <= def.splash && canHit(def, e))) {
          damage(s, u.id, e, def, dmg, ev);
          pend.push({ side: u.side, d: e.d, u: e, def });
        }
    }
    return null;
  }
  const st = pickStructure(s, u, def);
  if (st != null) {
    if (u.cd === 0) {
      u.cd = def.cooldown;
      st.hp -= dmg;
      const isFort = 'owner' in st;
      const d = isFort ? st.d : fwd(other(u.side), 0);
      ev.push({ e: 'hit', from: u.id, to: -1, dmg, type: isFort ? 'fort' : 'castle', id: isFort ? s.forts.indexOf(st) : other(u.side), ...at(d) });
      pend.push({ side: u.side, d, u: null, def });
    }
    return null;
  }
  if (def.ground > 0 && def.move === 'fly' && u.cd === 0) { u.cd = def.cooldown; pend.push({ side: u.side, d: u.d, u: null, def }); } // a burning trail
  if (rooted) return null;
  const speed = slowed ? div(B.speed.get(def.move)! * (100 - B.slowPct), 100) : B.speed.get(def.move)!;
  if (speed === 0) return null;
  let want = Math.min(me + speed, BATTLE_LEN);
  if (def.move === 'capture') {
    const f = captureStop(s, u);
    if (f != null && fwd(u.side, f.d) >= me) want = Math.min(want, fwd(u.side, f.d));
    if (f != null && Math.abs(f.d - u.d) <= B.forts.captureRadius) return null;
  }
  if (def.move === 'support') {
    let front = -1;
    for (const a of s.units) if (a.side === u.side && defOf(a).move !== 'support') front = Math.max(front, fwd(u.side, a.d));
    want = Math.min(want, front - B.supportGap);
  }
  return want > me ? want : null;
}

// A neutral fort with only one side's capture units on it (none of the other side's units) is taken after captureTicks.
function captures(s: BattleState, ev: BattleEvent[]): void {
  s.forts.forEach((f, i) => {
    const on: [boolean, boolean] = [false, false];
    let capturer: [boolean, boolean] = [false, false];
    for (const u of s.units)
      if (Math.abs(u.d - f.d) <= B.forts.captureRadius) {
        on[u.side] = true;
        if (defOf(u).move === 'capture') capturer[u.side] = true;
      }
    capturer = [capturer[0] && !on[1], capturer[1] && !on[0]];
    const side: Side | null = f.owner === null ? (capturer[0] ? 0 : capturer[1] ? 1 : null) : null;
    if (side === null || f.capSide !== side) { f.capSide = side; f.capT = 0; }
    if (side === null) return;
    if (++f.capT < B.forts.captureTicks) return;
    f.owner = side; f.capSide = null; f.capT = 0; f.cd = 0;
    ev.push({ e: 'capture', id: i, side, ...at(f.d) });
  });
}

function dots(s: BattleState, ev: BattleEvent[]): void {
  const zones: Zone[] = [];
  for (const z of s.zones) {
    for (const u of s.units) if (u.side !== z.side && defOf(u).move !== 'fly' && Math.abs(u.d - z.d) <= B.groundRadius) u.burnT = B.burnTicks;
    if (--z.t > 0) zones.push(z);
  }
  s.zones = zones;
  for (const u of s.units) {
    if (u.burnT > 0) u.burnT--;
    if (u.poisonT > 0 && --u.poisonT === 0) u.poison = 0;
    if (s.tick % DOT_EVERY !== 0) continue;
    const dmg = (u.burnT > 0 ? div(B.burnDps, 2) : 0) + div(u.poison * B.poisonDps, 2);
    if (dmg > 0) { u.hp -= dmg; ev.push({ e: 'hit', to: u.id, dmg, ...at(u.d) }); }
  }
}

function resolveDeaths(s: BattleState, ev: BattleEvent[]): void {
  const alive: Fighter[] = [];
  for (const u of s.units) {
    if (u.hp > 0) alive.push(u);
    else ev.push({ e: 'kill', id: u.id, type: u.card, ...at(u.d) });
  }
  s.units = alive;
  s.forts.forEach((f, i) => {
    if (f.hp > 0) return;
    f.owner = null; f.hp = B.forts.hp; f.cd = 0;
    ev.push({ e: 'neutral', id: i, ...at(f.d) });
  });
}

// Spec §7: castle HP, then forts held, deepest fort, mana left, units alive; else a draw.
// step names the key that decided it (null on a draw), so a result screen can say why.
export const DECIDE_STEPS = ['castle', 'forts', 'deepest', 'mana', 'units'] as const;
export type DecideStep = (typeof DECIDE_STEPS)[number];
export function decision(s: BattleState): { winner: Side | -1; step: DecideStep | null } {
  const key = (side: Side): number[] => {
    let forts = 0, deepest = -1, units = 0;
    for (const f of s.forts) if (f.owner === side) { forts++; deepest = Math.max(deepest, fwd(side, f.d)); }
    for (const u of s.units) if (u.side === side) units++;
    return [Math.max(0, s.castles[side].hp), forts, deepest, s.mana[side], units];
  };
  const a = key(0), b = key(1);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return { winner: a[i]! > b[i]! ? 0 : 1, step: DECIDE_STEPS[i]! };
  return { winner: -1, step: null };
}
export const decide = (s: BattleState): Side | -1 => decision(s).winner;

// On-hit effects land after everyone moved: statuses, a knock-back (never on large units) and burning ground.
function applyPending(s: BattleState, pend: Pending[]): void {
  for (const p of pend) {
    const u = p.u, def = p.def;
    if (def.ground > 0) s.zones.push({ side: p.side, d: u ? u.d : p.d, t: def.ground });
    if (u == null) continue;
    u.stunT = Math.max(u.stunT, def.stun);
    u.rootT = Math.max(u.rootT, def.root);
    u.slowT = Math.max(u.slowT, def.slow);
    if (def.push > 0 && defOf(u).size !== 'large') u.d = fwd(u.side, Math.max(0, fwd(u.side, u.d) - def.push));
  }
}

function regen(s: BattleState): void {
  const r = B.regen.find((p) => s.tick - 1 >= p.from && s.tick - 1 < p.to);
  if (r == null || (s.tick - r.from) % r.every !== 0) return;
  for (const side of [0, 1] as Side[]) s.mana[side] = Math.min(B.manaMax, s.mana[side] + 1);
}

export function stepBattle(s: BattleState, cmds: readonly BattleCommand[] = []): BattleEvent[] {
  const ev: BattleEvent[] = [];
  if (isOver(s)) return ev;
  for (const c of cmds) {
    if (c.side !== 0 && c.side !== 1) err(ev, 'bad side');
    else if (c.t === 'redraw') redraw(s, c.side, ev);
    else if (c.t === 'summon') summon(s, c, ev);
    else if (c.t === 'art') castArt(s, c.side, ev);
    else err(ev, 'unknown command');
  }
  dots(s, ev);
  resolveDeaths(s, ev);
  const pend: Pending[] = [];
  const wants = s.units.map((u) => act(s, u, ev, pend));
  s.forts.forEach((f, i) => { if (f.owner !== null) shoot(s, f.owner, f.d, f, B.forts, -10 - i, ev); });
  s.castles.forEach((c, side) => shoot(s, side as Side, fwd(side as Side, 0), c, B.castle, -1 - side, ev));
  s.units.forEach((u, i) => { const w = wants[i]; if (w != null) u.d = fwd(u.side, w); });
  applyPending(s, pend);
  captures(s, ev);
  resolveDeaths(s, ev);
  s.tick++;
  regen(s);
  if (s.castles[0].hp <= 0 || s.castles[1].hp <= 0 || s.tick >= B.matchTicks) {
    s.winner = decide(s);
    ev.push({ e: 'end', side: s.winner, won: s.winner === 0 });
  }
  return ev;
}

// Engine-neutral fingerprint: tick|rng|mana|hands|redraws|uses|castles hp,cd,art|forts owner,hp,cd,capSide,capT|units|zones|winner.
export function battleString(s: BattleState): string {
  const n = (x: number | null) => (x === null ? '-' : String(x));
  let o = `${s.tick}|${s.rng}|${s.mana.join(',')}|${s.hands[0].join(',')}/${s.hands[1].join(',')}|${s.redraws.join(',')}|${s.uses[0].join(',')}/${s.uses[1].join(',')}|`;
  for (const c of s.castles) o += `${c.hp},${c.cd},${c.artUsed ? 1 : 0};`;
  o += '|';
  for (const f of s.forts) o += `${n(f.owner)},${f.hp},${f.cd},${n(f.capSide)},${f.capT};`;
  o += '|';
  for (const u of s.units) o += `u${u.id},${u.side},${u.card},${u.d},${u.hp},${u.maxHp},${u.aura},${u.cd},${u.stunT},${u.burnT},${u.poison},${u.poisonT},${u.rootT},${u.slowT};`;
  o += '|';
  for (const z of s.zones) o += `${z.side},${z.d},${z.t};`;
  return o + '|' + n(s.winner);
}
export const battleHash = (s: BattleState) => fnv1a(battleString(s));
