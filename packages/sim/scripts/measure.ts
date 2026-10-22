// Balance report for the defend rules (design-review §6 B-metrics). Usage: npm run sim:measure [-- stageId ...]
import { createGame, type DefendState, type Element } from '../src/index';
import { playBot } from '../test/bot';

const stages = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const fmt = (n: number) => n.toFixed(1);

function run(stageId: string, seed: number, opts: Parameters<typeof playBot>[1]) {
  const s = playBot(createGame(stageId, seed) as DefendState, opts);
  return s;
}

for (const id of stages.length ? stages : ['1-1', '1-4', '1-6', '1-12', 'T-1']) {
  for (const [name, opts] of [
    ['greedy6', { maxDisciples: 6 }],
    ['greedy8', { maxDisciples: 8 }],
    ['early8', { maxDisciples: 8, earlyCall: true }],
  ] as const) {
    const res = SEEDS.map((seed) => run(id, seed, opts));
    const won = res.filter((s) => s.phase === 'won').length;
    const min = res.map((s) => s.tick / 20 / 60);
    console.log(`${id} ${name}: won ${won}/8  min ${fmt(Math.min(...min))}-${fmt(Math.max(...min))}  livesLost avg ${fmt(res.reduce((a, s) => a + s.livesLost, 0) / 8)}  silverLeft avg ${Math.round(res.reduce((a, s) => a + s.silver, 0) / 8)}`);
  }
  const s0 = createGame(id, 1) as DefendState;
  for (const el of s0.unlocked as Element[]) {
    const res = SEEDS.map((seed) => run(id, seed, { maxDisciples: 8, sects: [el], earlyCall: true }));
    console.log(`  mono ${el}: won ${res.filter((s) => s.phase === 'won').length}/8 livesLost ${res.map((s) => s.livesLost).join(',')}`);
  }
}
