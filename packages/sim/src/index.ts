import { createAssault, stepAssault } from './assault';
import { STAGES } from './data';
import { createDefend, stepDefend } from './defend';
import type { Command, GameState, SimEvent } from './types';

export * from './data';
export * from './types';
export { GRID_W, GRID_H, LAYOUTS } from './layouts';
export { canBuild, findCombo, placeCost, sellValue, unlockedSects, upgradeCost } from './defend';

export function createGame(stageId: string, seed: number): GameState {
  const stage = STAGES[stageId];
  if (!stage) throw new Error(`unknown stage ${stageId}`);
  return stage.type === 'assault' ? createAssault(stageId, seed) : createDefend(stageId, seed);
}

// Advances exactly one tick (1/20 s). Commands apply at the start of the tick.
export function step(state: GameState, commands: Command[] = []): SimEvent[] {
  return state.kind === 'assault' ? stepAssault(state, commands) : stepDefend(state, commands);
}

export const isOver = (s: GameState) => s.phase === 'won' || s.phase === 'lost';

// FNV-1a over the canonical JSON of the state. Same seed + same commands => same hash.
export function hashState(state: GameState): string {
  const str = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// A replay is a seed plus commands keyed by tick.
export type Replay = { stageId: string; seed: number; commands: Record<number, Command[]> };

export function runReplay(r: Replay, maxTicks = 20 * 60 * 30, onTick?: (s: GameState) => void): GameState {
  const s = createGame(r.stageId, r.seed);
  while (!isOver(s) && s.tick < maxTicks) {
    step(s, r.commands[s.tick] ?? []);
    onTick?.(s);
  }
  return s;
}
