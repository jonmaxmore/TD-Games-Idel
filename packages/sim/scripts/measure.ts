// Balance report for tuning (not a test): win rate, lives lost and minutes per stage and sect, for a bot that
// calls waves early and one that does not.  npm run sim:measure   (MEASURE_SEEDS, MEASURE_STAGES, MEASURE_LEGACY=0, MEASURE_DETAIL=1,
// MEASURE_BRANCH=a|b forces that tier-3 branch (MEASURE_BRANCH_KIT=wood: only on that kit, the rest a), MEASURE_EARLY=yes|no plays only that bot,
// MEASURE_POLICY=greedy,rush,tall,wide,eco plays those bot styles (bot.ts POLICIES; rush overrides MEASURE_EARLY))
import { playStage, POLICIES } from '../test/bot';

const env = process.env;
const stagesToRun = env.MEASURE_STAGES ? env.MEASURE_STAGES.split(',') : ['1-1', '1-2', '1-4', '1-6', '1-9', '1-10', '1-12', 'T-1'];
const sectsToRun: (string | null)[] = env.MEASURE_LEGACY === '0' ? ['fire', 'wood'] : ['fire', 'wood', null];
const n = Number(env.MEASURE_SEEDS) || 8;
const branch = env.MEASURE_BRANCH === 'a' || env.MEASURE_BRANCH === 'b' ? env.MEASURE_BRANCH : undefined;
const branchKit = env.MEASURE_BRANCH_KIT || undefined;
const earlies = env.MEASURE_EARLY === 'yes' ? [true] : env.MEASURE_EARLY === 'no' ? [false] : [true, false];
const policies = (env.MEASURE_POLICY ?? 'greedy').split(',');
for (const p of policies) if (!POLICIES[p]) throw new Error(`unknown policy ${p}: ${Object.keys(POLICIES).join(', ')}`);
const seeds = Array.from({ length: n }, (_, i) => i + 1);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log('policy  stage  sect    early  wins  livesLost  min   stars');
for (const pol of policies)
for (const st of stagesToRun)
  for (const sect of sectsToRun)
    for (const early of earlies) {
      const runs = seeds.map((seed) => playStage(st, seed, sect, { earlyCall: early, ...POLICIES[pol], branch, branchKit }));
      if (env.MEASURE_DETAIL === '1') console.log('  ' + runs.map((r, i) => `${seeds[i]}:${r.phase === 'won' ? 'W' : 'L'}${r.wave}`).join(' '));
      const wins = runs.filter((r) => r.phase === 'won').length;
      console.log(`${pol.padEnd(7)} ${st.padEnd(6)} ${(sect ?? 'legacy').padEnd(7)} ${(early ? 'yes' : 'no').padEnd(6)} ${wins}/${n}  ${avg(runs.map((r) => r.livesLost)).toFixed(1).padStart(5)}     ${avg(runs.map((r) => r.tick / 20 / 60)).toFixed(1).padStart(4)}  ${avg(runs.map((r) => r.stars?.filter(Boolean).length ?? 0)).toFixed(1)}`);
    }
