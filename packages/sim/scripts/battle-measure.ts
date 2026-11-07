// Castle-battle balance tables (BATTLE_SEEDS, default 200).
// 1. rush vs defend on the mixed mirror deck, both side orders: left wins, draws, castle falls, length.
// 2. every preset sect deck vs every other (battle.json > sectDecks), both side orders, all four bot pairings:
//    row sect's win % over its games (draws count half), and each sect's overall average. The diagonal is the mirror
//    match's left-side win %.
import { battle } from '../src';
import { playBattle, type Policy } from '../test/battleBot';

const seeds = Number(process.env.BATTLE_SEEDS ?? 200);
const pairs: [Policy, Policy][] = [['rush', 'defend'], ['defend', 'rush'], ['rush', 'rush'], ['defend', 'defend']];
const pct = (x: number, n: number) => ((100 * x) / n).toFixed(1);

for (const [a, b] of pairs) {
  let left = 0, right = 0, draw = 0, ticks = 0, hp = 0, ko = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const { state: s } = playBattle(seed, a, b);
    if (s.winner === 0) left++; else if (s.winner === 1) right++; else draw++;
    ticks += s.tick; hp += Math.max(0, s.castles[0].hp) + Math.max(0, s.castles[1].hp);
    if (s.castles[0].hp <= 0 || s.castles[1].hp <= 0) ko++;
  }
  console.log(`${a} vs ${b}: left ${pct(left, seeds)}% right ${pct(right, seeds)}% draw ${pct(draw, seeds)}% ko ${pct(ko, seeds)}% avg ${(ticks / seeds / 20).toFixed(1)}s castle hp left ${(hp / seeds / 2).toFixed(0)}/${battle.castle.hp}`);
}

if (process.env.SECTS !== '0') {
  const ids = [...battle.sectDecks.keys()];
  const win = ids.map(() => ids.map(() => 0)), games = ids.map(() => ids.map(() => 0));
  const mirrorLeft = ids.map(() => 0), mirrorN = ids.map(() => 0);
  let left = 0, draw = 0, ko = 0, ticks = 0, n = 0;
  for (let i = 0; i < ids.length; i++)
    for (let j = 0; j < ids.length; j++)
      for (const [p0, p1] of pairs)
        for (let seed = 1; seed <= seeds; seed++) {
          const s = playBattle(seed, p0, p1, battle.sectDecks.get(ids[i]!)!, battle.sectDecks.get(ids[j]!)!).state;
          const w = s.winner === 0 ? 2 : s.winner === -1 ? 1 : 0; // half-points for side 0
          if (i === j) { mirrorLeft[i]! += s.winner === 0 ? 1 : 0; mirrorN[i]!++; }
          else { win[i]![j]! += w; games[i]![j]! += 2; win[j]![i]! += 2 - w; games[j]![i]! += 2; }
          n++; ticks += s.tick;
          if (s.winner === 0) left++;
          if (s.winner === -1) draw++;
          if (s.castles[0].hp <= 0 || s.castles[1].hp <= 0) ko++;
        }
  console.log(`\nsect matrix: ${n} games (${seeds} seeds x 4 bot pairings x both side orders), row win % vs column`);
  console.log(['', ...ids, 'avg'].map((x) => x.padStart(7)).join(''));
  ids.forEach((id, i) => {
    const off = ids.map((_, j) => (j === i ? null : [win[i]![j]!, games[i]![j]!] as const)).filter((x) => x != null);
    const avg = off.reduce((a, x) => a + x[0], 0) / off.reduce((a, x) => a + x[1], 0);
    console.log([id, ...ids.map((_, j) => (j === i ? pct(mirrorLeft[i]!, mirrorN[i]!) : pct(win[i]![j]!, games[i]![j]!))), (100 * avg).toFixed(1)].map((x) => x.padStart(7)).join(''));
  });
  console.log(`all sect games: left ${pct(left, n)}% draw ${pct(draw, n)}% ko ${pct(ko, n)}% avg ${(ticks / n / 20).toFixed(1)}s`);
}
