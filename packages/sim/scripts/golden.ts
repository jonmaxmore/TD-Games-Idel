// Golden replays for engine ports (Unity C#). Written to disk by write-golden.ts (npm run sim:golden).
// Each file: { stageId, seed, commands: {tick: Command[]}, trace: [[tick, hash] every 100 ticks], final }
import { canonicalHash, canonicalString } from '../src/canonical';
import { createGame, runReplay, type Command, type DefendState } from '../src/index';
import { playBot } from '../test/bot';

export function golden(stageId: string, seed: number) {
  const commands: Record<number, Command[]> = {};
  playBot(createGame(stageId, seed) as DefendState, { record: commands });
  const trace: [number, string][] = [];
  const end = runReplay({ stageId, seed, commands }, 20 * 60 * 30, (s) => {
    if (s.tick % 100 === 0) trace.push([s.tick, canonicalHash(s as DefendState)]);
  }) as DefendState;
  return {
    stageId, seed, commands, trace,
    final: { phase: end.phase, wave: end.wave, lives: end.lives, silver: end.silver, tick: end.tick, hash: canonicalHash(end), canonical: canonicalString(end) },
  };
}

