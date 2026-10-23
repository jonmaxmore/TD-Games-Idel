// Headless run: npm run sim:replay -- --stage 1-4 --seed 42
// Plays the stage with the greedy bot and prints the result and final state hash.
import { createGame, hashState, type DefendState } from '../src/index';
import { playBot } from '../test/bot';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
};
const stage = arg('stage', '1-4');
const seed = Number(arg('seed', '42'));
const s = createGame(stage, seed);
if (s.kind !== 'defend') throw new Error('sim:replay runs defend stages');
playBot(s as DefendState);
console.log(JSON.stringify({ stage, seed, phase: s.phase, wave: s.wave, lives: s.lives, ticks: s.tick, stars: s.stars, hash: hashState(s) }));
