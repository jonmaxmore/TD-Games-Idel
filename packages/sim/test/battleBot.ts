// Castle-battle bots for the balance test and the golden: rush (pick the next push card from the deck, summon it at the
// front of its zone once it is affordable), defend (bank mana, answer what crosses into its half, at the castle gate
// once it is under siege, push like rush when rich) and paced (keep a mana reserve, one summon every few seconds and
// never onto a crowd of its own small units, guards first when enemies come near). Each side has its own seeded RNG.
import {
  autoPicks, battle, battleCardIds, fillPicks, isBasic, ownedAt, sectCards, stages, starterTeam, battleOver, battleUnits, BATTLE_LEN, createBattle, fwd,
  nextRandom, stepBattle, summonZone, validateDeck, type BattleCommand, type BattleOpts, type BattleSetup, type BattleState, type Side, type Stage,
} from '../src';

export type Policy = 'rush' | 'defend' | 'paced';
// The golden's team: a large wood leader, a fire sub-leader and the picks autoPicks makes from every card.
const team = (leader: string, sub: string, owned: readonly string[], skip: readonly string[] = []): BattleSetup => ({ leader, sub, picks: autoPicks(leader, sub, owned, battle.deck.budget, skip) });
export const MIXED: BattleSetup = team('jade_bamboo_warden', 'crimson_phoenix_striker', battleCardIds);
// Stress teams for control resistance: only the earth and water cards that stun or push.
const CONTROL_CARDS = ['vajra_stone_striker', 'vajra_stone_burst', 'vajra_stone_control', 'vajra_stone_guardian', 'frost_tide_stacker', 'frost_tide_burst', 'frost_tide_control', 'frost_tide_naga'];
export const CONTROL_TEAMS: Record<string, BattleSetup> = {
  earth: team('vajra_stone_guardian', 'vajra_stone_control', CONTROL_CARDS, ['frost_tide_naga']),
  water: team('frost_tide_naga', 'frost_tide_stacker', CONTROL_CARDS, ['vajra_stone_guardian']),
};
// Seeded legal picks for a leader and sub: the owned cards in a seeded order, then loaners (deck.ts fillPicks).
export function randomPicks(r: { rng: number }, leader: string, sub: string, owned: readonly string[], budget = battle.deck.budget): string[] {
  const shuffle = (a: string[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(nextRandom(r) * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };
  return fillPicks(leader, sub, [...shuffle(battleCardIds.filter((c) => owned.includes(c))), ...shuffle(battle.deck.loaners.filter((c) => !owned.includes(c)))], owned, budget);
}
// A random legal team over every card (the per-card table): a seeded leader, a different sub-leader and seeded picks.
export function randomTeam(seed: number, side: Side): BattleSetup {
  const r = { rng: (seed * 7919 + 17 + side * 104729) >>> 0 }, ok = battleCardIds.filter((c) => !isBasic(c));
  const draw = (from: string[]) => from[Math.floor(nextRandom(r) * from.length)]!;
  for (;;) {
    const leader = draw(ok), sub = draw(ok.filter((c) => c !== leader)), t = { leader, sub, picks: randomPicks(r, leader, sub, battleCardIds) };
    if (validateDeck(t, battleCardIds) == null) return t;
  }
}
// A sect's team on a seed (the 5x5 sect table): its default leader and sub-leader with seeded legal picks from its disciples,
// so the table averages over the hands a sect can take as the old random draw did.
export function sectTeam(sect: string, seed: number, side: Side): BattleSetup {
  const t = battle.sectTeams.get(sect)!;
  return { ...t, picks: randomPicks({ rng: (seed * 7919 + 101 + side * 104729) >>> 0 }, t.leader, t.sub, sectCards(sect)) };
}
// The mirror gate's team on a seed, the same for both sides: MIXED's leader and sub-leader with seeded picks.
export const mirrorTeam = (seed: number): BattleSetup => ({ ...MIXED, picks: randomPicks({ rng: (seed * 7919 + 3) >>> 0 }, MIXED.leader, MIXED.sub, battleCardIds) });

// Per card over random-team games (one seed per game, so every game deals new teams and hands; the four bot pairings
// in turn): win % (draws half) of the side in the side-games it summoned the card at least once (winPct) or held it in the
// dealt hand (handPct), and the plain average of winPct over the cards of each band (bandOf).
export interface CardRow { card: string; games: number; winPct: number; handPct: number }
export const PAIRS: [Policy, Policy][] = [['rush', 'defend'], ['defend', 'rush'], ['rush', 'rush'], ['defend', 'defend']];
export const PACED_PAIRS: [Policy, Policy][] = [['paced', 'paced']];
export const PACED_MIXED_PAIRS: [Policy, Policy][] = [['paced', 'rush'], ['rush', 'paced'], ['paced', 'defend'], ['defend', 'paced']];
export function cardTable(games: number, pairs = PAIRS): { rows: CardRow[]; band: Map<string, number>; games: number } {
  const pts = new Map<string, [number, number]>(), held = new Map<string, [number, number]>(); // lookups; rows come out in data order
  for (let seed = 1; seed <= games; seed++) {
    const [p0, p1] = pairs[seed % pairs.length]!;
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
// paced: mana kept back for an answer, ticks between two summons, and how close (milli-tiles) and how many of its own
// small units count as a crowd at the summon point.
const RESERVE = 6, GAP_TICKS = 50, CROWD = 1500, CROWD_SMALL = 2;

const def = (card: string) => battleUnits.get(card)!;

// A bot's seeded RNG and the push card it is saving for (null: pick one next time).
export interface BotMind { rng: number; next: string | null; last: number } // last: tick of paced's last summon

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

function decidePaced(s: BattleState, side: Side, m: BotMind): BattleCommand[] {
  const out: BattleCommand[] = [];
  const shot = cannonAim(s, side, 2);
  if (shot != null && s.mana[side] - battle.cannon.mana >= RESERVE) { out.push({ t: 'cannon', side, d: shot }); return out; }
  if (s.tick - m.last < GAP_TICKS) return out;
  const zone = summonZone(s, side);
  const pick = (cards: string[]) => cards[Math.floor(nextRandom(m) * cards.length)]!;
  const send = (card: string, d: number) => { out.push({ t: 'summon', side, card, d }); m.last = s.tick; return out; };
  const near = s.units.filter((u) => u.side !== side && fwd(side, u.d) <= BATTLE_LEN / 2);
  if (near.length > 0) { // an answer may spend the reserve: a guard first, else a fighter, just short of the nearest enemy
    const g = playable(s, side, ['guard']), c = g.length > 0 ? g : playable(s, side, ['march']);
    if (c.length > 0) return send(pick(c), zone);
  }
  const capturing = s.units.some((u) => u.side === side && def(u.card).move === 'capture');
  if (!capturing && s.forts.some((f) => f.owner !== side)) {
    const c = playable(s, side, ['capture']);
    if (c.length > 0 && s.mana[side] - def(c[0]!).mana >= RESERVE) return send(pick(c), zone);
  }
  if (m.next == null) { const c = playable(s, side, ['march', 'fly', 'support'], true); m.next = c.length > 0 ? pick(c) : null; }
  if (m.next == null || def(m.next).mana + RESERVE > s.mana[side]) return out;
  const crowd = s.units.filter((u) => u.side === side && def(u.card).size === 'small' && Math.abs(fwd(side, u.d) - zone) <= CROWD).length;
  if (def(m.next).size === 'small' && crowd >= CROWD_SMALL) return out;
  const card = m.next;
  m.next = null;
  return send(card, zone);
}

function decide(s: BattleState, side: Side, policy: Policy, rng: BotMind): BattleCommand[] {
  if (policy === 'paced') return decidePaced(s, side, rng);
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
export const botRng = (seed: number, side: Side): BotMind => ({ rng: (seed * 2 + 1 + side) >>> 0, next: null, last: -GAP_TICKS });

export interface BattleResult { state: BattleState; commands: Record<number, BattleCommand[]> }

export function playBattle(seed: number, p0: Policy, p1: Policy, setup0 = MIXED, setup1 = MIXED, opts: BattleOpts = {}): BattleResult {
  const s = createBattle(seed, setup0, setup1, opts);
  const rngs = [botRng(seed, 0), botRng(seed, 1)];
  const commands: Record<number, BattleCommand[]> = {};
  while (!battleOver(s)) {
    const cmds = [...botCommands(s, 0, p0, rngs[0]!), ...botCommands(s, 1, p1, rngs[1]!)];
    if (cmds.length > 0) commands[s.tick] = cmds;
    stepBattle(s, cmds);
  }
  return { state: s, commands };
}

// The anti-air lesson check (pve-campaign.md §9 item 4): run fn with these cards unable to hit fliers, then restore them.
// It edits the shared card defs, so pass only the player's cards, none the stage's enemy plays.
export function withoutAntiAir<T>(cards: readonly string[], fn: () => T): T {
  const off = cards.map((c) => battleUnits.get(c)!).filter((d) => d.hitsAir);
  for (const d of off) d.hitsAir = false;
  try { return fn(); } finally { for (const d of off) d.hitsAir = true; }
}

// A ศึกปราบ stage, paced bot against the stage's paced enemy: the player's setup (with its progress) on side 0.
export const playStage = (seed: number, st: Stage, player: BattleSetup): BattleResult => playBattle(seed, 'paced', 'paced', player, st.enemy, { stage: st.rules });
// The balance gate's player at stage i on a seed: what a home sect owns when it first plays it (collection.ts ownedAt), led
// by the starter team (collection.json starterTeam), seeded legal picks within the stage's budget (loaners when it owns too
// few), so the gate averages over the hands a player could take as the old random draw did; owned cards at level, loaners
// at 1.
export function ownedTeamAt(home: string, i: number, level: number, seed: number): BattleSetup {
  const t = starterTeam(home), owned = ownedAt(home, i), r = { rng: (seed * 2654435761 + i * 97 + 1) >>> 0 };
  return { ...t, picks: randomPicks(r, t.leader, t.sub, owned, stages[i]!.deckBudget), progress: { levels: Object.fromEntries(owned.map((c) => [c, level])) } };
}
