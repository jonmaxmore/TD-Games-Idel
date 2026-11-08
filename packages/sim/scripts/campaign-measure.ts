// ศึกปราบ balance table (CAMPAIGN_SEEDS, default 200): every stage of campaign.json, the paced bot on the default fire team
// (battle.json > sectTeams.fire) against the stage's paced enemy, at card level 1 and level 10: win %, draw %, each star's %
// and the average length.
import { stages, starsOf } from '../src';
import { fireTeamAt, playStage } from '../test/battleBot';

const seeds = Number(process.env.CAMPAIGN_SEEDS ?? 200);
const pct = (x: number) => ((100 * x) / seeds).toFixed(1).padStart(5);
for (const level of [1, 10]) {
  console.log(`fire team Lv${level}, ${seeds} seeds: stage | win% draw% | star-hp% star-fast% | avg s`);
  for (const st of stages) {
    let win = 0, draw = 0, hp = 0, fast = 0, ticks = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const { state: s } = playStage(seed, st, fireTeamAt(level));
      const [w, h, f] = starsOf(s);
      win += +w; hp += +h; fast += +f; draw += +(s.winner === -1); ticks += s.tick;
    }
    console.log(`${st.id} ${st.nameTh} | ${pct(win)} ${pct(draw)} | ${pct(hp)} ${pct(fast)} | ${(ticks / seeds / 20).toFixed(0)} (${st.gimmickTh}, enemy Lv${st.level})`);
  }
}
