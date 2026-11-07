// Castle-battle bots for the balance test and the golden: rush (pick the next push card from the deck, summon it at the
// front of its zone once it is affordable) and defend (bank mana, answer what crosses into its half, at the castle gate
// once it is under siege, push like rush when rich). Each side has its own seeded RNG.
import {
  battle, battleCardIds, battleOver, battleUnits, BATTLE_LEN, createBattle, fwd, nextRandom, stepBattle, summonZone,
  type BattleCommand, type BattleSetup, type BattleState, type Side,
} from '../src';

export type Policy = 'rush' | 'defend';
// The mirror team of the balance gate: every card in the collection, a large wood leader and a fire sub-leader.
export const MIXED: BattleSetup = { leader: 'jade_bamboo_warden', sub: 'crimson_phoenix_striker', collection: battleCardIds, bench: [] };
// Stress teams for control resistance: only the earth and water cards that stun or push (leader, sub and draws).
const CONTROL_CARDS = ['vajra_stone_striker', 'vajra_stone_burst', 'vajra_stone_control', 'vajra_stone_guardian', 'frost_tide_stacker', 'frost_tide_burst', 'frost_tide_control', 'frost_tide_naga'];
export const CONTROL_TEAMS: Record<string, BattleSetup> = {
  earth: { leader: 'vajra_stone_guardian', sub: 'vajra_stone_control', collection: CONTROL_CARDS, bench: ['frost_tide_naga'] },
  water: { leader: 'frost_tide_naga', sub: 'frost_tide_stacker', collection: CONTROL_CARDS, bench: ['vajra_stone_guardian'] },
};
// A random team over every card for the per-card table: a seeded leader and a different sub-leader, never a basic capturer.
const BASICS = new Set(battle.hand.basic.values());
export function randomTeam(seed: number, side: Side): BattleSetup {
  const r = { rng: (seed * 7919 + 17 + side * 104729) >>> 0 };
  const ok = battleCardIds.filter((c) => !BASICS.has(c));
  const leader = ok[Math.floor(nextRandom(r) * ok.length)]!, rest = ok.filter((c) => c !== leader);
  return { leader, sub: rest[Math.floor(nextRandom(r) * rest.length)]!, collection: battleCardIds, bench: [] };
}

// Per card over random-team games (one seed per game, so every game deals new teams and hands; the four bot pairings
// in turn): win % (draws half) of the side in the side-games it summoned the card at least once (winPct) or held it in the
// dealt hand (handPct), and the plain average of winPct over the cards of each band (bandOf).
export interface CardRow { card: string; games: number; winPct: number; handPct: number }
const PAIRS: [Policy, Policy][] = [['rush', 'defend'], ['defend', 'rush'], ['rush', 'rush'], ['defend', 'defend']];
export function cardTable(games: number): { rows: CardRow[]; band: Map<string, number>; games: number } {
  const pts = new Map<string, [number, number]>(), held = new Map<string, [number, number]>(); // lookups; rows come out in data order
  for (let seed = 1; seed <= games; seed++) {
    const [p0, p1] = PAIRS[seed % 4]!;
    const { state: s, commands } = playBattle(seed, p0, p1, randomTeam(seed, 0), randomTeam(seed, 1));
    const w0 = s.winner === 0 ? 2 : s.winner === -1 ? 1 : 0;
    const sent: [Set<string>, Set<string>] = [new Set(), new Set()];
    for (const cs of Object.values(commands)) for (const c of cs) if (c.t === 'summon') sent[c.side].add(c.card);
    for (const side of [0, 1] as const) for (const c of sent[side]) {
      const x = pts.get(c) ?? [0, 0];
      pts.set(c, [x[0] + (side === 0 ? w0 : 2 - w0), x[1] + 2]);
    }
    for (const side of [0, 1] as const) for (const c of s.hands[side]) {
      const x = held.get(c) ?? [0, 0];
      held.set(c, [x[0] + (side === 0 ? w0 : 2 - w0), x[1] + 2]);
    }
    }
  const rows = battleCardIds.filter((c) => pts.has(c)).map((c) => ({ card: c, games: pts.get(c)![1] / 2, winPct: (100 * pts.get(c)![0]) / pts.get(c)![1], handPct: (100 * held.get(c)![0]) / held.get(c)![1] }));
  const band = new Map<string, number>();
  for (const key of BANDS) {
    const r = rows.filter((x) => bandOf(x.card) === key);
    if (r.length > 0) band.set(key, r.reduce((a, x) => a + x.winPct, 0) / r.length);
  }
  return { rows, band, games };
}
// A card's band in the table: its size, split into interceptors and attackers. The defend bot summons interceptors only
// when enemies cross into its half, so they are played mostly by the side that is behind and read low on winPct whatever
// their numbers (their handPct stays near 50); a shared band would make every attacker look strong.
const BANDS = ['small', 'medium', 'large'].flatMap((z) => [`${z} attack`, `${z} guard`]);
export const bandOf = (card: string) => `${def(card).size} ${def(card).move === 'guard' ? 'guard' : 'attack'}`;

const DECIDE_EVERY = 10;
const HOLD_MANA = 12;

const def = (card: string) => battleUnits.get(card)!;

// A bot's seeded RNG and the push card it is saving for (null: pick one next time).
export interface BotMind { rng: number; next: string | null }

function playable(s: BattleState, side: Side, moves: string[], anyMana = false): string[] {
  return s.hands[side].filter((c, i) => {
    const u = def(c);
    return moves.includes(u.move) && (anyMana || u.mana <= s.mana[side]) && (u.perMatch == null || s.uses[side][i]! < u.perMatch);
  });
}

// Where the cannon would hit the most enemies (at least min of them, or any at the castle gate), aimed at one of them;
// null when it is reloading, unaffordable or not worth it.
function cannonAim(s: BattleState, side: Side, min: number): number | null {
  const C = battle.cannon;
  if (s.castles[side].cannonCd > 0 || s.mana[side] < C.mana) return null;
  let best: number | null = null, most = 0;
  for (const e of s.units) {
    const d = fwd(side, e.d);
    if (e.side === side || d > C.reach) continue;
    const n = s.units.filter((x) => x.side !== side && Math.abs(x.d - e.d) <= C.radius).length;
    if (n > most || (n === most && best != null && d < best)) { most = n; best = d; }
  }
  return best != null && (most >= min || best <= battle.homeZone) ? best : null;
}

function decide(s: BattleState, side: Side, policy: Policy, rng: BotMind): BattleCommand[] {
  const out: BattleCommand[] = [];
  const zone = summonZone(s, side);
  const threats = s.units.filter((u) => u.side !== side && fwd(side, u.d) <= BATTLE_LEN / 2).length;
  const pick = (cards: string[]) => cards[Math.floor(nextRandom(rng) * cards.length)]!;
  const summon = (card: string, d: number) => { out.push({ t: 'summon', side, card, d }); s.mana[side] -= def(card).mana; };
  const mana0 = s.mana[side];
  const shot = cannonAim(s, side, policy === 'rush' ? 3 : 2);
  if (shot != null) { out.push({ t: 'cannon', side, d: shot }); s.mana[side] -= battle.cannon.mana; }
  const capturing = s.units.some((u) => u.side === side && def(u.card).move === 'capture');
  const openFort = s.forts.some((f) => f.owner !== side);
  if (!capturing && openFort && nextRandom(rng) < 0.5) {
    const c = playable(s, side, ['capture']);
    if (c.length > 0) summon(pick(c), zone);
  }
  if (policy === 'rush' || s.mana[side] >= HOLD_MANA) { // push: pick the next card from the whole deck, then save for it
    if (rng.next == null) { const c = playable(s, side, ['march', 'fly', 'support'], true); rng.next = c.length > 0 ? pick(c) : null; }
    if (rng.next != null && def(rng.next).mana <= s.mana[side]) { summon(rng.next, zone); rng.next = null; }
  } else if (threats > 0) {
    const c = playable(s, side, ['guard', 'march']);
    const atGate = s.units.some((u) => u.side !== side && fwd(side, u.d) <= battle.homeZone + battle.castle.range);
    if (c.length > 0) summon(pick(c), atGate ? 0 : Math.max(0, Math.min(zone, BATTLE_LEN / 2 - 4000) | 0)); // under siege: at the gate
  }
  s.mana[side] = mana0; // the sim spends it when the commands run
  return out;
}

// One side's commands for this tick (it decides every DECIDE_EVERY ticks); the client's AI and bot=1 play through this.
export function botCommands(s: BattleState, side: Side, policy: Policy, rng: BotMind): BattleCommand[] {
  return s.tick % DECIDE_EVERY === 0 ? decide(s, side, policy, rng) : [];
}
export const botRng = (seed: number, side: Side): BotMind => ({ rng: (seed * 2 + 1 + side) >>> 0, next: null });

export interface BattleResult { state: BattleState; commands: Record<number, BattleCommand[]> }

export function playBattle(seed: number, p0: Policy, p1: Policy, setup0 = MIXED, setup1 = MIXED): BattleResult {
  const s = createBattle(seed, setup0, setup1);
  const rngs = [botRng(seed, 0), botRng(seed, 1)];
  const commands: Record<number, BattleCommand[]> = {};
  while (!battleOver(s)) {
    const cmds = [...botCommands(s, 0, p0, rngs[0]!), ...botCommands(s, 1, p1, rngs[1]!)];
    if (cmds.length > 0) commands[s.tick] = cmds;
    stepBattle(s, cmds);
  }
  return { state: s, commands };
}
