// Castle-battle balance table: rush vs defend on mirror decks, both side orders (BATTLE_SEEDS, default 200).
import { battle } from '../src';
import { playBattle, type Policy } from '../test/battleBot';

const seeds = Number(process.env.BATTLE_SEEDS ?? 200);
const pairs: [Policy, Policy][] = [['rush', 'defend'], ['defend', 'rush'], ['rush', 'rush'], ['defend', 'defend']];
for (const [a, b] of pairs) {
  let left = 0, right = 0, draw = 0, ticks = 0, hp = 0, ko = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const { state: s } = playBattle(seed, a, b);
    if (s.winner === 0) left++; else if (s.winner === 1) right++; else draw++;
    ticks += s.tick; hp += Math.max(0, s.castles[0].hp) + Math.max(0, s.castles[1].hp);
    if (s.castles[0].hp <= 0 || s.castles[1].hp <= 0) ko++;
  }
  const pct = (x: number) => ((100 * x) / seeds).toFixed(1);
  console.log(`${a} vs ${b}: left ${pct(left)}% right ${pct(right)}% draw ${pct(draw)}% ko ${pct(ko)}% avg ${(ticks / seeds / 20).toFixed(1)}s castle hp left ${(hp / seeds / 2).toFixed(0)}/${battle.castle.hp}`);
}
