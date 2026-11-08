// ศึกปราบ balance table (CAMPAIGN_SEEDS, default 200): every stage of campaign.json, the paced bot on the cards a home sect
// owns when it first plays that stage (collection.ts ownedAt, starter team) against the stage's paced enemy, at card level
// 1 (and 10 with LV10=1): win %, draw %, each star's % and the average length. HOMES=fire,wood picks the home sects (all five
// by default); the last column is the mean over them.
import { gimmickNames, homeSects, ownedAt, stages, starsOf } from '../src';
import { ownedTeamAt, playStage } from '../test/battleBot';

const seeds = Number(process.env.CAMPAIGN_SEEDS ?? 200);
const homes = process.env.HOMES ? process.env.HOMES.split(',') : homeSects;
const pct = (x: number) => ((100 * x) / seeds).toFixed(1).padStart(5);
for (const level of process.env.LV10 ? [1, 10] : [1]) {
  console.log(`owned collection Lv${level}, ${seeds} seeds: stage | cards owned | per home: win% (star2% star3%) | mean win% | avg s`);
  stages.forEach((st, i) => {
    const row: string[] = [];
    let all = 0, ticks = 0;
    for (const home of homes) {
      let win = 0, s2 = 0, s3 = 0;
      for (let seed = 1; seed <= seeds; seed++) {
        const { state: s } = playStage(seed, st, ownedTeamAt(home, i, level));
        const [w, a, b] = starsOf(s, st);
        win += +w; s2 += +a; s3 += +b; ticks += s.tick;
      }
      all += win;
      row.push(`${home} ${pct(win)} (${pct(s2).trim()} ${pct(s3).trim()})`);
    }
    console.log(`${st.id.padEnd(4)} ${st.nameTh} | ${ownedAt(homes[0]!, i).length} | ${row.join(' | ')} | ${pct(all / homes.length)} | ${(ticks / seeds / homes.length / 20).toFixed(0)} (${gimmickNames(st) || '-'}, enemy Lv${st.level})`);
  });
}
