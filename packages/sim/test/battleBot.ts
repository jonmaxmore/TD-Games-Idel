// Castle-battle bots for the balance test and the golden: rush (spend as soon as it can, at the front of its zone)
// and defend (bank mana, answer what crosses into its half, push when rich). Each side has its own seeded RNG.
import { battle, battleOver, battleUnits, BATTLE_LEN, createBattle, fwd, nextRandom, stepBattle, summonZone, type BattleCommand, type BattleState, type Side } from '../src';

export type Policy = 'rush' | 'defend';
export const DECK = [
  'crimson_phoenix_striker', 'crimson_phoenix_burst', 'crimson_phoenix_control', 'crimson_phoenix_banner',
  'crimson_phoenix_blade', 'jade_bamboo_stacker', 'jade_bamboo_support', 'jade_bamboo_blade',
];
const DECIDE_EVERY = 10;
const HOLD_MANA = 12;

const def = (card: string) => battleUnits.get(card)!;

function playable(s: BattleState, side: Side, moves: string[]): string[] {
  return s.decks[side].filter((c, i) => {
    const u = def(c), cap = battle.sizes.get(u.size)!.perMatch;
    return moves.includes(u.move) && u.mana <= s.mana[side] && (cap == null || s.uses[side][i]! < cap);
  });
}

function decide(s: BattleState, side: Side, policy: Policy, rng: { rng: number }): BattleCommand[] {
  const out: BattleCommand[] = [];
  const zone = summonZone(s, side);
  if (zone < 0) return out;
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
  if (policy === 'rush' || s.mana[side] >= HOLD_MANA) {
    const c = playable(s, side, ['march', 'support']);
    if (c.length > 0) summon(pick(c), zone);
  } else if (threats > 0) {
    const c = playable(s, side, ['guard', 'march']);
    if (c.length > 0) summon(pick(c), Math.max(0, Math.min(zone, BATTLE_LEN / 2 - 4000) | 0));
  }
  s.mana[side] = mana0; // the sim spends it when the commands run
  return out;
}

export interface BattleResult { state: BattleState; commands: Record<number, BattleCommand[]> }

export function playBattle(seed: number, p0: Policy, p1: Policy, deck0 = DECK, deck1 = DECK): BattleResult {
  const s = createBattle(seed, deck0, deck1);
  const rngs = [{ rng: (seed * 2 + 1) >>> 0 }, { rng: (seed * 2 + 2) >>> 0 }];
  const commands: Record<number, BattleCommand[]> = {};
  while (!battleOver(s)) {
    const cmds: BattleCommand[] = [];
    if (s.tick % DECIDE_EVERY === 0) cmds.push(...decide(s, 0, p0, rngs[0]!), ...decide(s, 1, p1, rngs[1]!));
    if (cmds.length > 0) commands[s.tick] = cmds;
    stepBattle(s, cmds);
  }
  return { state: s, commands };
}
