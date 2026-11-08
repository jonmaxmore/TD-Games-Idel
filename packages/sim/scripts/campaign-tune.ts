// Finds each stage's enemy regen (mana.enemyRegenPct) that brings the mean win % over the home sects to its target, by
// bisection on the paced bot with the collection owned at that stage, Lv1 (TUNE_SEEDS per home, default 40). Prints the
// regen per stage to copy into campaign.json, and flags a stage whose target is out of reach of regen alone (change its
// level, waves or castle instead). TARGETS=90,86,... overrides the default curve.
import { homeSects, stages, starsOf } from '../src';
import { ownedTeamAt, playStage } from '../test/battleBot';

const seeds = Number(process.env.TUNE_SEEDS ?? 40);
const targets = (process.env.TARGETS ?? '92,88,84,80,76,72,68,63,58,48').split(',').map(Number);
const only = process.env.STAGES?.split(',');
const winPct = (i: number): number => {
  let w = 0;
  for (const home of homeSects) for (let seed = 1; seed <= seeds; seed++) w += +starsOf(playStage(seed, stages[i]!, ownedTeamAt(home, i, 1)).state, stages[i]!)[0];
  return (100 * w) / (seeds * homeSects.length);
};
stages.forEach((st, i) => {
  if (only && !only.includes(st.id)) return;
  const want = targets[i]!, rules = st.rules as { regenPct: number };
  let lo = 10, hi = 250;
  rules.regenPct = lo; const easy = winPct(i);
  rules.regenPct = hi; const hard = winPct(i);
  if (easy < want || hard > want) { console.log(`${st.id} target ${want}: out of reach (regen ${lo} -> ${easy.toFixed(1)}, ${hi} -> ${hard.toFixed(1)})`); return; }
  while (hi - lo > 4) {
    const mid = Math.round((lo + hi) / 2);
    rules.regenPct = mid;
    if (winPct(i) >= want) lo = mid; else hi = mid;
  }
  rules.regenPct = lo;
  console.log(`${st.id} target ${want}: enemyRegenPct ${lo} -> ${winPct(i).toFixed(1)}`);
});
