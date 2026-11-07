// Golden replay of a castle battle (SPEC-castle-battle §11): a seed, both teams and every command sent, with the state hash
// every 100 ticks and the final state. A rule change that alters an outcome shows up as a hash mismatch until the golden is
// rewritten on purpose (npm run sim:golden). The server verifies a submitted match exactly like replayBattle() below.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { battleHash, battleOver, battleString, createBattle, stepBattle, type BattleCommand, type BattleSetup, type BattleState } from '../src';
import { MIXED, playBattle } from './battleBot';

export interface BattleGolden {
  seed: number; setups: [BattleSetup, BattleSetup]; commands: Record<number, BattleCommand[]>; trace: [number, string][];
  final: { winner: number; tick: number; hash: string; canonical: string };
}
export const BATTLE_GOLDEN = fileURLToPath(new URL('../goldens/battle-1.json', import.meta.url));

export function replayBattle(seed: number, setups: [BattleSetup, BattleSetup], commands: Record<number, BattleCommand[]>, onTick?: (s: BattleState) => void): BattleState {
  const s = createBattle(seed, setups[0], setups[1]);
  while (!battleOver(s)) {
    stepBattle(s, commands[s.tick] ?? []);
    onTick?.(s);
  }
  return s;
}

// Rush bot (left) vs defend bot (right) on the mirror team.
export function battleGolden(seed = 1): BattleGolden {
  const setups: [BattleSetup, BattleSetup] = [MIXED, MIXED];
  const { commands } = playBattle(seed, 'rush', 'defend');
  const trace: [number, string][] = [];
  const end = replayBattle(seed, setups, commands, (s) => { if (s.tick % 100 === 0) trace.push([s.tick, battleHash(s)]); });
  return { seed, setups, commands, trace, final: { winner: end.winner!, tick: end.tick, hash: battleHash(end), canonical: battleString(end) } };
}

export function writeAll(): void {
  const b = battleGolden();
  writeFileSync(BATTLE_GOLDEN, JSON.stringify(b, null, 1) + '\n');
  console.log(`battle-1 winner ${b.final.winner} ticks ${b.final.tick} trace ${b.trace.length} hash ${b.final.hash}`);
}
