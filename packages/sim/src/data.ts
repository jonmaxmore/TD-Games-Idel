// Loads docs/data (the source of truth for numbers and names) and converts it to integer sim units:
// distance = milli-tiles, time = ticks (20 Hz), speed = milli-tiles per tick.
// Lookups are Maps (never iterated for game logic); anything the rules iterate is an array in data order.
import sectsJson from '../../../docs/data/sects.json';
import effectsJson from '../../../docs/data/effects.json';
import battleJson from '../../../docs/data/battle.json';

export const TICK_HZ = 20;
export const TILE = 1000;
export const ticks = (sec: number) => Math.round(sec * TICK_HZ);

export type Pt = { x: number; y: number };
export interface SectDef { element: string; nameTh: string; nameEn: string; color: string }

/* eslint-disable @typescript-eslint/no-explicit-any */
const J = (x: unknown) => x as any;
const S = J(sectsJson), FX = J(effectsJson);

export const sects = new Map<string, SectDef>();
for (const s of S.sects) sects.set(s.element, { element: s.element, nameTh: s.nameTh, nameEn: s.name ?? s.nameEn, color: s.color });

export const overcomes = new Map<string, string>(Object.entries(S.wuxing.overcomes as Record<string, string>));
export const overcomePct: number = S.wuxing.overcomePct;
export const overcomeByPct: number = S.wuxing.overcomeByPct;
export const palette = new Map<string, string[]>(Object.entries(FX.render.palette as Record<string, string[]>));

// Castle battle (battle.json, SPEC-castle-battle). Path distances in milli-tiles from side 0's castle.
export type Move = 'march' | 'capture' | 'guard' | 'fly' | 'support';
export type Size = 'small' | 'medium' | 'large';
export type Kind = 'disciple' | 'demon' | 'divine' | 'dragon';
export interface BattleUnitDef {
  // sect: the card's element (Wu Xing, colour); for a disciple also its sect. kind: what it is (beasts have no sect).
  // perMatch: times it may be summoned in one match (null = unlimited), the card's own cap or its size's.
  id: string; sect: string; kind: Kind; kit: string; nameTh: string; nameEn: string; move: Move; size: Size; mana: number; hp: number; perMatch: number | null;
  dmg: number; cooldown: number; range: number; hitsAir: boolean; hitsGround: boolean; dot: string | null;
  // On-hit kit (ticks or milli-tiles, 0 = none): splash hits every enemy it can hit this close to the target too.
  splash: number; slow: number; root: number; stun: number; push: number; ground: number; armor: number; pierce: boolean;
  raise: number; // a small enemy this card's hit kills rises on its side with this % of its HP (0 = none)
  tagTh: string; descTh: string; counters: string[]; // tagTh: one line for the card; descTh: what it does, in full
  body: string; // how the client draws it: human (default), archer, ghoul, imp, beast, wing, serpent, mass, shell, dragon
  ability: { kind: 'aura' | 'ward' | 'hp' | 'refund'; lv: [number, number, number] } | null; // lv: value as a normal card, sub-leader, leader
}
const BT = J(battleJson);
const P = (t: [number, number]): Pt => ({ x: t[0], y: t[1] });
const tiles = (t: number) => Math.round(t * TILE);
const structure = (x: any) => ({ hp: x.hp as number, dmg: x.dmg as number, cooldown: ticks(1 / x.rate), range: tiles(x.range) });
export const battle = {
  grid: { w: BT.grid[0] as number, h: BT.grid[1] as number },
  path: (BT.path as [number, number][]).map(P), // tiles; battle.ts converts with toMilli
  forts: { ...structure(BT.forts), atPct: BT.forts.atPct as number[], captureTicks: ticks(BT.forts.captureSec), captureRadius: tiles(BT.forts.captureRadius) },
  castle: structure(BT.castle),
  cannon: {
    nameTh: BT.castle.cannon.nameTh as string, mana: BT.castle.cannon.mana as number, cooldown: ticks(BT.castle.cannon.cooldownSec), reach: tiles(BT.castle.cannon.reachTiles),
    radius: tiles(BT.castle.cannon.radiusTiles), dmg: BT.castle.cannon.dmg as number, push: tiles(BT.castle.cannon.pushTiles), maxPush: BT.castle.cannon.maxPush as number,
  },
  summonBasePct: BT.summonBasePct as number, summonGap: tiles(BT.summonGapTiles), homeZone: tiles(BT.homeZoneTiles),
  manaStart: BT.mana.startPvp as number, manaMax: BT.mana.max as number,
  regen: (BT.mana.regenSec as any[]).map((r) => ({ from: ticks(r.fromSec), to: ticks(r.toSec), every: ticks(r.everySec) })),
  sizes: new Map<string, { min: number; max: number; perMatch: number | null; nameTh: string }>(Object.keys(BT.sizes).map((k) => [k, { min: BT.sizes[k].mana[0], max: BT.sizes[k].mana[1], perMatch: BT.sizes[k].perMatch, nameTh: BT.sizes[k].nameTh }])),
  kinds: new Map<string, string>(Object.entries(BT.kinds as Record<string, string>)),
  moves: new Map<string, { roleTh: string; nameTh: string; doesTh: string }>(Object.keys(BT.moves).map((k) => [k, { roleTh: BT.moves[k].role, nameTh: BT.moves[k].nameTh, doesTh: BT.moves[k].doesTh }])),
  speed: new Map<string, number>(Object.keys(BT.moves).map((k) => [k, Math.round((BT.moves[k].speed * TILE) / TICK_HZ)])),
  guardLeash: tiles(BT.guardLeashTiles), meleeRange: tiles(BT.meleeRange), supportHeal: BT.supportHeal as number, supportGap: tiles(BT.supportGapTiles), critPct: BT.critPct as number,
  burnDps: BT.dot.burnDps as number, burnTicks: ticks(BT.dot.burnSec), burnMax: BT.dot.burnMaxStacks as number, poisonDps: BT.dot.poisonDps as number, poisonTicks: ticks(BT.dot.poisonSec), poisonMax: BT.dot.poisonMaxStacks as number,
  slowPct: BT.status.slowPct as number, groundRadius: tiles(BT.status.groundRadius),
  stunImmune: ticks(BT.status.stunImmuneSec), rootImmune: ticks(BT.status.rootImmuneSec), largeControlPct: BT.status.largeControlPct as number,
  counterTags: new Map<string, string>(Object.entries(BT.counterTags as Record<string, string>)),
  counterPct: new Map<string, number>(Object.entries(BT.counterPct as Record<string, number>)),
  hand: { size: BT.hand.size as number, maxLarge: BT.hand.maxLarge as number, basic: new Map<string, string>(Object.entries(BT.hand.basic as Record<string, string>)) },
  deck: {
    pick: BT.deck.pick as number, budget: BT.deck.budget as number, loaners: BT.deck.loaners as string[],
    sizePoints: new Map<string, number>(Object.entries(BT.deck.sizePoints as Record<string, number>)),
    cardPoints: new Map<string, number>(Object.entries(BT.deck.cardPoints as Record<string, number>)),
  },
  auraRadius: tiles(BT.abilities.aura.radiusTiles), wardRadius: tiles(BT.abilities.ward.radiusTiles),
  abilities: new Map<string, { nameTh: string; doesTh: string }>(Object.keys(BT.abilities).map((k) => [k, { nameTh: BT.abilities[k].nameTh, doesTh: BT.abilities[k].doesTh.replace('{r}', String(BT.abilities[k].radiusTiles)) }])),
  sectTeams: new Map<string, { leader: string; sub: string }>(Object.entries(BT.sectTeams as Record<string, { leader: string; sub: string }>)),
  matchTicks: ticks(BT.matchSec),
  results: new Map<string, string>(Object.entries(BT.results as Record<string, string>)),
};
export const battleUnits = new Map<string, BattleUnitDef>();
export const battleCardIds: string[] = S.roster.units.map((u: any) => u.id as string); // data order, for anything iterated
for (const u of S.roster.units) {
  battleUnits.set(u.id, {
    id: u.id, sect: u.sect, kind: u.kind ?? 'disciple', kit: u.kit, nameTh: u.nameTh, nameEn: u.nameEn, move: u.move, size: u.size, mana: u.mana, hp: u.hp,
    perMatch: 'perMatch' in u ? u.perMatch : BT.sizes[u.size].perMatch,
    dmg: u.dmg, cooldown: ticks(1.0 / u.rate), range: Math.max(tiles(u.range), tiles(BT.meleeRange)),
    hitsAir: u.target.includes('air'), hitsGround: u.target.includes('ground'), dot: u.dot ?? null,
    splash: tiles(u.splash ?? 0), slow: ticks(u.slowSec ?? 0), root: ticks(u.rootSec ?? 0), stun: ticks(u.stunSec ?? 0),
    push: tiles(u.pushTiles ?? 0), ground: ticks(u.groundSec ?? 0), armor: u.armor ?? 0, pierce: u.pierce === true, raise: u.raisePct ?? 0,
    tagTh: u.tagTh ?? '', descTh: u.descTh ?? '', counters: u.counters ?? [], ability: u.ability ?? null, body: u.body ?? 'human',
  });
}
