// Account XP table and ranked-ladder calibration from docs/data/progression.json (docs/design/progression.md).
//   node tools/progression/check.mjs           print the XP table and a simulated ranked season
// Part A turns time targets ("level 30 by day 10") into XP-to-next-level per level: the reference player's
// XP income gives cumulative XP per anchor, and each span between anchors grows geometrically from the
// previous level's requirement so the table never dips. Part B plays a season of matches between players of
// known skill (Elo standing in for Glicko-2) through the visible star rules and compares where they end up
// with the target league distribution.
import { readFileSync } from 'node:fs';

const P = JSON.parse(readFileSync(new URL('../../docs/data/progression.json', import.meta.url), 'utf8'));
const A = P.accountLevel;

// ---------- A. account XP ----------
const xpPerMin = A.player.wavesPerMinute * A.xpSources.stageXpPerWave;
const firstDay = A.player.minutesFirstDay * xpPerMin * A.xpSources.firstClearMultiplier + A.player.dailyMissionXp;
const perDay = A.player.minutesPerDay * xpPerMin + A.player.dailyMissionXp;
const cumAtDay = (d) => (d <= 1 ? firstDay * d : firstDay + (d - 1) * perDay);

export function xpTable() {
  const out = []; // out[L] = XP from level L to L+1
  let prev = 0;
  for (let i = 1; i < A.anchors.length; i++) {
    const a = A.anchors[i - 1], b = A.anchors[i];
    const n = b.level - a.level, total = cumAtDay(b.day) - cumAtDay(a.day);
    // First span: start from an even split. Later spans: x_k = prev * g^k, solve g so the span sums to total.
    if (i === 1) prev = total / n / 2;
    let lo = 1, hi = 3;
    const sum = (g) => { let s = 0, x = prev; for (let k = 0; k < n; k++) { x *= g; s += x; } return s; };
    if (sum(1) > total) throw new Error(`levels ${a.level}-${b.level}: ${total} XP is less than ${n} x ${Math.round(prev)}; the table would dip`);
    for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (sum(m) > total) hi = m; else lo = m; }
    let x = prev;
    for (let k = 0; k < n; k++) { x *= lo; out[a.level + k] = Math.max(A.roundTo, Math.round(x / A.roundTo) * A.roundTo); }
    prev = x;
  }
  return out;
}

const table = xpTable();
console.log(`XP income: ${xpPerMin}/active min · first day ${firstDay} · then ${perDay}/day`);
console.log('level  xp-to-next   cumulative   day reached');
let cum = 0;
for (let L = 1; L <= A.cap; L++) {
  if (L === 1 || L % 5 === 0 || A.anchors.some((a) => a.level === L)) {
    const day = cum <= firstDay ? cum / firstDay : 1 + (cum - firstDay) / perDay;
    console.log(String(L).padStart(5), String(table[L] ?? '-').padStart(11), String(cum).padStart(12), day.toFixed(1).padStart(13));
  }
  if (L < A.cap) cum += table[L];
}
for (let L = 2; L < A.cap; L++) if (table[L] < table[L - 1]) throw new Error(`XP to next level dips at ${L}`);

// ---------- B. ranked season ----------
const R = P.ranked;
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

const steps = []; // one entry per star position below legend: league index
R.leagues.forEach((l, li) => { if (!l.points) for (let d = 0; d < l.divisions; d++) for (let s = 0; s < l.stars; s++) steps.push(li); });
const legendStart = steps.length;
const leagueStart = R.leagues.map((_, li) => steps.indexOf(li));
const leagueOf = (pos) => (pos >= legendStart ? R.leagues.length - 1 : steps[pos]);

function season(players, games, startPos) {
  // Expected MMR per league = MMR at the middle of that league's target percentile band.
  const sorted = players.map((p) => p.mmr).sort((a, b) => a - b);
  let acc = 0;
  const expected = R.leagues.map((l) => { const mid = acc + R.targetDistribution[l.id] / 2; acc += R.targetDistribution[l.id]; return sorted[Math.min(sorted.length - 1, Math.floor((mid / 100) * sorted.length))]; });
  players.forEach((p, i) => { p.pos = startPos(p); p.streak = 0; p.left = games[i]; p.charms = R.starProtection.perWeek * R.seasonWeeks; p.pts = 0; });
  for (;;) {
    const q = players.filter((p) => p.left > 0).sort((a, b) => a.mmr + gauss() * 40 - (b.mmr + gauss() * 40));
    if (q.length < 2) break;
    for (let i = 0; i + 1 < q.length; i += 2) {
      const a = q[i], b = q[i + 1];
      const pa = 1 / (1 + 10 ** ((b.skill - a.skill) / 400));
      const aWins = rnd() < pa;
      const ea = 1 / (1 + 10 ** ((b.mmr - a.mmr) / 400));
      a.mmr += 32 * ((aWins ? 1 : 0) - ea); b.mmr += 32 * ((aWins ? 0 : 1) - (1 - ea));
      for (const [p, won] of [[a, aWins], [b, !aWins]]) {
        p.left--;
        const li = leagueOf(p.pos), L = R.leagues[li];
        if (L.points) { p.pts = Math.max(0, p.pts + (won ? R.legendPoints.win : R.legendPoints.loss)); if (!won && p.pts === 0 && !L.floor) p.pos--; continue; }
        if (won) {
          p.streak++;
          let up = 1;
          if (L.streakBonus && p.streak >= R.streakLength) up++;
          if (L.mmrBoost && p.mmr - expected[li] > R.mmrBoost.gap) up++;
          p.pos = Math.min(legendStart, p.pos + up);
        } else {
          p.streak = 0;
          if (!L.loseStars) continue;
          if (p.charms > 0 && rnd() < 0.5) { p.charms--; continue; } // players use about half their charms
          const floor = L.floor ? leagueStart[li] : 0;
          p.pos = Math.max(floor, p.pos - 1);
        }
      }
    }
  }
  const dist = Object.fromEntries(R.leagues.map((l) => [l.id, 0]));
  players.forEach((p) => dist[R.leagues[leagueOf(p.pos)].id]++);
  return dist;
}

const N = 4000;
const players = Array.from({ length: N }, () => ({ skill: 1500 + 200 * gauss(), mmr: R.glicko.start }));
// Activity mix: 40% casual (20 games), 40% regular (60), 20% grinders (150). An assumption until we have data.
const games = players.map(() => { const r = rnd(); return r < 0.4 ? 20 : r < 0.8 ? 60 : 150; });
const show = (title, dist) => {
  console.log(`\n${title}  (league: simulated % vs target %)`);
  for (const l of R.leagues) console.log(`  ${l.id.padEnd(7)} ${((dist[l.id] / N) * 100).toFixed(1).padStart(5)}  vs ${String(R.targetDistribution[l.id]).padStart(3)}`);
};
show('Season 1 (everyone starts at stone)', season(players, games, () => 0));
// Season reset: back to the start of the division seasonResetDivisions below the current one (legend counts as one division).
const divStarts = [];
R.leagues.forEach((l) => { if (!l.points) for (let d = 0; d < l.divisions; d++) divStarts.push(divStarts.length ? divStarts.at(-1) + R.leagues[leagueOfDiv(divStarts.length - 1)].stars : 0); });
function leagueOfDiv(i) { let n = 0; for (let li = 0; li < R.leagues.length; li++) { n += R.leagues[li].points ? 0 : R.leagues[li].divisions; if (i < n) return li; } return R.leagues.length - 1; }
const reset = (p) => {
  const div = p.pos >= legendStart ? divStarts.length : divStarts.findLastIndex((st) => st <= p.pos);
  return divStarts[Math.max(0, div - R.seasonResetDivisions)];
};
show(`Season 2 (reset ${R.seasonResetDivisions} divisions)`, season(players, games, reset));
