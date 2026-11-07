// Castle-battle balance tables (BATTLE_SEEDS, default 200).
// 1. rush vs defend on the mixed mirror team (battleBot.ts > MIXED), both side orders: left wins, draws, castle falls, length.
// 3. (CONTROL=1) the earth and water control-stack teams vs every sect team, with control resistance off (stunImmuneSec 0,
//    largeControlPct 100) and on: the stack's win %.
// 2. every sect team vs every other (its whole roster, battle.json > sectTeams leader and sub), both side orders, all four bot pairings:
//    row sect's win % over its games (draws count half), and each sect's overall average. The diagonal is the mirror
//    match's left-side win %.
import { battle, decision, sectSetup, type ResultType } from '../src';
import { CONTROL_TEAMS, playBattle, type Policy } from '../test/battleBot';

const seeds = Number(process.env.BATTLE_SEEDS ?? 200);
const pairs: [Policy, Policy][] = [['rush', 'defend'], ['defend', 'rush'], ['rush', 'rush'], ['defend', 'defend']];
const pct = (x: number, n: number) => ((100 * x) / n).toFixed(1);

for (const [a, b] of pairs) {
  let left = 0, right = 0, draw = 0, ticks = 0, hp = 0, ko = 0;
  const types: Record<ResultType, number> = { total: 0, castle: 0, hp: 0, tiebreak: 0, draw: 0 };
  for (let seed = 1; seed <= seeds; seed++) {
    const { state: s } = playBattle(seed, a, b);
    types[decision(s).type]++;
    if (s.winner === 0) left++; else if (s.winner === 1) right++; else draw++;
    ticks += s.tick; hp += Math.max(0, s.castles[0].hp) + Math.max(0, s.castles[1].hp);
    if (s.castles[0].hp <= 0 || s.castles[1].hp <= 0) ko++;
  }
  console.log(`${a} vs ${b}: left ${pct(left, seeds)}% right ${pct(right, seeds)}% draw ${pct(draw, seeds)}% ko ${pct(ko, seeds)}% avg ${(ticks / seeds / 20).toFixed(1)}s castle hp left ${(hp / seeds / 2).toFixed(0)}/${battle.castle.hp} | ${Object.entries(types).map(([k, v]) => `${k} ${pct(v, seeds)}%`).join(' ')}`);
}

if (process.env.SECTS !== '0') {
  const ids = [...battle.sectTeams.keys()];
  const win = ids.map(() => ids.map(() => 0)), games = ids.map(() => ids.map(() => 0));
  const mirrorLeft = ids.map(() => 0), mirrorN = ids.map(() => 0);
  let left = 0, draw = 0, ko = 0, ticks = 0, n = 0;
  const usage = new Map<string, { n: number; games: number; pts: number; dealt: number }>(); // a lookup, filled in game order
  const use = (c: string) => { let u = usage.get(c); if (!u) usage.set(c, (u = { n: 0, games: 0, pts: 0, dealt: 0 })); return u; };
  for (let i = 0; i < ids.length; i++)
    for (let j = 0; j < ids.length; j++)
      for (const [p0, p1] of pairs)
        for (let seed = 1; seed <= seeds; seed++) {
          const { state: s, commands } = playBattle(seed, p0, p1, sectSetup(ids[i]!), sectSetup(ids[j]!));
          const w = s.winner === 0 ? 2 : s.winner === -1 ? 1 : 0; // half-points for side 0
          if (i !== j) {
            const sent: [Set<string>, Set<string>] = [new Set(), new Set()];
            for (const cs of Object.values(commands)) for (const c of cs) if (c.t === 'summon') { use(c.card).n++; sent[c.side].add(c.card); }
            for (const side of [0, 1] as const) for (const c of sent[side]) { const u = use(c); u.games++; u.pts += side === 0 ? w : 2 - w; }
            for (const side of [0, 1] as const) for (const c of s.hands[side]) use(c).dealt++;
          }
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
  let worst = 0;
  ids.forEach((_, i) => ids.forEach((_, j) => { if (i !== j) worst = Math.max(worst, (100 * win[i]![j]!) / games[i]![j]!); }));
  console.log(`widest matchup: ${worst.toFixed(1)}%`);
  // Per card over the off-diagonal sect games: in hand (% of side-games), summons per game in hand, win % of the side
  // in the games it was summoned at least once.
  const sideGames = n - mirrorN.reduce((a, x) => a + x, 0);
  console.log('\ncard usage (sect games): card, in hand %, summons per game held, win % when summoned');
  for (const id of ids) for (const c of sectSetup(id).collection) {
    const u = use(c);
    console.log(`${c.padEnd(26)} ${pct(u.dealt, sideGames * 2 / ids.length * 1).padStart(6)} ${(u.n / Math.max(1, u.dealt)).toFixed(2).padStart(6)} ${(u.games ? pct(u.pts, u.games * 2) : '-').padStart(6)}`);
  }
}

if (process.env.CONTROL === '1') {
  const ids = [...battle.sectTeams.keys()];
  const on = { stun: battle.stunImmune, root: battle.rootImmune, big: battle.largeControlPct };
  for (const [label, res] of [['resistance off', { stun: 0, root: 0, big: 100 }], ['resistance on', on]] as const) {
    battle.stunImmune = res.stun; battle.rootImmune = res.root; battle.largeControlPct = res.big;
    console.log(`\ncontrol stack (${label}): stack win % vs each sect team, ${seeds} seeds x 4 pairings x both sides`);
    for (const [name, team] of Object.entries(CONTROL_TEAMS)) {
      const row = ids.map((id) => {
        let w = 0, n = 0;
        for (const [p0, p1] of pairs)
          for (let seed = 1; seed <= seeds; seed++) {
            const a = playBattle(seed, p0, p1, team, sectSetup(id)).state, b = playBattle(seed, p0, p1, sectSetup(id), team).state;
            w += (a.winner === 0 ? 2 : a.winner === -1 ? 1 : 0) + (b.winner === 1 ? 2 : b.winner === -1 ? 1 : 0); n += 4;
          }
        return `${id} ${pct(w, n)}`;
      });
      console.log(`${name}-control: ${row.join(' ')}`);
    }
  }
  battle.stunImmune = on.stun; battle.rootImmune = on.root; battle.largeControlPct = on.big;
}
