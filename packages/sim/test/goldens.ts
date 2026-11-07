// Golden replay of a castle battle (SPEC-castle-battle §11): a seed, both decks and every command sent, with the state hash
// every 100 ticks and the final state. A rule change that alters an outcome shows up as a hash mismatch until the golden is
// rewritten on purpose (npm run sim:golden). The server verifies a submitted match exactly like replayBattle() below.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { battleHash, battleOver, battleString, createBattle, stepBattle, type BattleCommand, type BattleState } from '../src';
import { DECK, playBattle } from './battleBot';

export interface BattleGolden {
  seed: number; decks: [string[], string[]]; commands: Record<number, BattleCommand[]>; trace: [number, string][];
  final: { winner: number; tick: number; hash: string; canonical: string };
}
export const BATTLE_GOLDEN = fileURLToPath(new URL('../goldens/battle-1.json', import.meta.url));

export function replayBattle(seed: number, decks: [string[], string[]], commands: Record<number, BattleCommand[]>, onTick?: (s: BattleState) => void): BattleState {
  const s = createBattle(seed, decks[0], decks[1]);
  while (!battleOver(s)) {
    stepBattle(s, commands[s.tick] ?? []);
    onTick?.(s);
  }
  return s;
}

// Rush bot (left) vs defend bot (right) on the mirror deck.
export function battleGolden(seed = 1): BattleGolden {
  const decks: [string[], string[]] = [DECK, DECK];
  const { commands } = playBattle(seed, 'rush', 'defend');
  const trace: [number, string][] = [];
  const end = replayBattle(seed, decks, commands, (s) => { if (s.tick % 100 === 0) trace.push([s.tick, battleHash(s)]); });
  return { seed, decks, commands, trace, final: { winner: end.winner!, tick: end.tick, hash: battleHash(end), canonical: battleString(end) } };
}

export function writeAll(): void {
  const b = battleGolden();
  writeFileSync(BATTLE_GOLDEN, JSON.stringify(b, null, 1) + '\n');
  console.log(`battle-1 winner ${b.final.winner} ticks ${b.final.tick} trace ${b.trace.length} hash ${b.final.hash}`);
}
