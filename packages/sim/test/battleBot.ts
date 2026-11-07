// Castle-battle bots for the balance test and the golden: rush (pick the next push card from the deck, summon it at the
// front of its zone once it is affordable) and defend (bank mana, answer what crosses into its half, at the castle gate
// once it is under siege, push like rush when rich). Each side has its own seeded RNG.
import { battle, battleOver, battleUnits, BATTLE_LEN, createBattle, fwd, nextRandom, stepBattle, summonZone, type BattleCommand, type BattleState, type Side } from '../src';

export type Policy = 'rush' | 'defend';
export const DECK = [
  'crimson_phoenix_striker', 'crimson_phoenix_burst', 'crimson_phoenix_control', 'crimson_phoenix_banner',
  'crimson_phoenix_blade', 'jade_bamboo_stacker', 'jade_bamboo_support', 'jade_bamboo_blade',
];
const DECIDE_EVERY = 10;
const HOLD_MANA = 12;

const def = (card: string) => battleUnits.get(card)!;

// A bot's seeded RNG and the push card it is saving for (null: pick one next time).
export interface BotMind { rng: number; next: string | null }

function playable(s: BattleState, side: Side, moves: string[], anyMana = false): string[] {
  return s.decks[side].filter((c, i) => {
    const u = def(c), cap = battle.sizes.get(u.size)!.perMatch;
    return moves.includes(u.move) && (anyMana || u.mana <= s.mana[side]) && (cap == null || s.uses[side][i]! < cap);
  });
}

function decide(s: BattleState, side: Side, policy: Policy, rng: BotMind): BattleCommand[] {
  const out: BattleCommand[] = [];
  const zone = summonZone(s, side);
  const threats = s.units.filter((u) => u.side !== side && fwd(side, u.d) <= BATTLE_LEN / 2).length;
  if (threats >= 3 && !s.castles[side].artUsed) out.push({ t: 'art', side });
  const pick = (cards: string[]) => cards[Math.floor(nextRandom(rng) * cards.length)]!;
  const summon = (card: string, d: number) => { out.push({ t: 'summon', side, card, d }); s.mana[side] -= def(card).mana; };
  const mana0 = s.mana[side];
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

export function playBattle(seed: number, p0: Policy, p1: Policy, deck0 = DECK, deck1 = DECK): BattleResult {
  const s = createBattle(seed, deck0, deck1);
  const rngs = [botRng(seed, 0), botRng(seed, 1)];
  const commands: Record<number, BattleCommand[]> = {};
  while (!battleOver(s)) {
    const cmds = [...botCommands(s, 0, p0, rngs[0]!), ...botCommands(s, 1, p1, rngs[1]!)];
    if (cmds.length > 0) commands[s.tick] = cmds;
    stepBattle(s, cmds);
  }
  return { state: s, commands };
}
