// Balance lever: applies candidate card numbers to docs/data/sects.json in memory and prints the balance gates
// (5x5 sect matrix, per-card tables under the paced bot, earth control stack vs fire). Nothing is written.
//   npx vite-node packages/sim/scripts/balance-lever.ts [candidate.json]
// candidate.json: { "<card id>": { "<roster field>": number | "x<multiplier>" } }, e.g. { "vajra_stone_guardian": { "hp": 1500, "dmg": "x0.9" } }.
// BATTLE_SEEDS (default 200) sets the matrix and control seeds, CARD_GAMES (default 4000) the per-card table games,
// CARDS=0 skips the per-card tables, MATRIX=0 the matrix, ALL=1 prints every card (else the changed ones and those outside +-8),
// JSON_OUT=<path> also writes the matrix, raw per-card win % and the control number as JSON. Runs four child processes.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sectsJson from '../../../docs/data/sects.json';

type Candidate = Record<string, Record<string, number | string>>;
const file = process.argv[2];
const candidate: Candidate = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
const units = (sectsJson as unknown as { roster: { units: Record<string, unknown>[] } }).roster.units;
for (const [id, fields] of Object.entries(candidate)) {
  const u = units.find((x) => x.id === id);
  if (!u) throw new Error(`unknown card ${id}`);
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'number') { u[k] = v; continue; }
    const base = u[k] as number;
    if (typeof base !== 'number') throw new Error(`${id}.${k} has no number to scale`);
    const x = base * Number(v.slice(1));
    u[k] = Number.isInteger(base) ? Math.round(x) : Math.round(x * 100) / 100;
  }
}

const seeds = Number(process.env.BATTLE_SEEDS ?? 200);
const cardGames = Number(process.env.CARD_GAMES ?? 4000);
const pairs = [['rush', 'defend'], ['defend', 'rush'], ['rush', 'rush'], ['defend', 'defend']] as const;
const half = (winner: number | null) => (winner === 0 ? 2 : winner === -1 ? 1 : 0); // side 0's half-points

async function part(name: string): Promise<unknown> {
  const sim = await import('../src');
  const bot = await import('../test/battleBot');
  const ids = [...sim.battle.sectTeams.keys()];
  if (name.startsWith('matrix:')) {
    const i = Number(name.slice(7));
    const row = ids.map(() => ({ w: 0, n: 0, draws: 0 }));
    for (let j = 0; j < ids.length; j++)
      for (const [p0, p1] of pairs)
        for (let seed = 1; seed <= seeds; seed++) {
          const s = bot.playBattle(seed, p0, p1, bot.sectTeam(ids[i]!, seed, 0), bot.sectTeam(ids[j]!, seed, 1)).state;
          const r = row[j]!;
          r.w += i === j ? (s.winner === 0 ? 2 : 0) : half(s.winner); r.n += 2;
          if (s.winner === -1) r.draws++;
        }
    return row;
  }
  if (name === 'ctrl') {
    let w = 0, n = 0;
    for (const [p0, p1] of pairs)
      for (let seed = 1; seed <= seeds; seed++) {
        const a = bot.playBattle(seed, p0, p1, bot.CONTROL_TEAMS.earth!, bot.sectTeam('fire', seed, 1)).state;
        const b = bot.playBattle(seed, p0, p1, bot.sectTeam('fire', seed, 0), bot.CONTROL_TEAMS.earth!).state;
        w += half(a.winner) + (2 - half(b.winner)); n += 4;
      }
    return (100 * w) / n;
  }
  const [table, from, to] = name.split(':') as [string, string, string];
  const tp = table === 'pp' ? bot.PACED_PAIRS : bot.PACED_MIXED_PAIRS;
  const pts: Record<string, [number, number]> = {};
  for (let seed = Number(from); seed <= Number(to); seed++) {
    const [p0, p1] = tp[seed % tp.length]!;
    const { state: s, commands } = bot.playBattle(seed, p0, p1, bot.randomTeam(seed, 0), bot.randomTeam(seed, 1));
    const w0 = half(s.winner);
    const sent: [Set<string>, Set<string>] = [new Set(), new Set()];
    for (const cs of Object.values(commands)) for (const c of cs) if (c.t === 'summon') sent[c.side].add(c.card);
    for (const side of [0, 1] as const) for (const c of sent[side]) {
      const x = (pts[c] ??= [0, 0]);
      x[0] += side === 0 ? w0 : 2 - w0; x[1] += 2;
    }
  }
  return pts;
}

function run(name: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite-node', fileURLToPath(import.meta.url), ...(file ? [file] : [])], { env: { ...process.env, LEVER_PART: name }, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out.trim().split('\n').pop()!)) : reject(new Error(`${name} exited ${code}`))));
  });
}

async function main() {
  if (process.env.LEVER_PART) { console.log(JSON.stringify(await part(process.env.LEVER_PART))); return; }
  const sim = await import('../src');
  const bot = await import('../test/battleBot');
  const ids = [...sim.battle.sectTeams.keys()];
  const chunks = (t: string) => [1, 2, 3, 4].map((k) => `${t}:${((k - 1) * cardGames) / 4 + 1}:${(k * cardGames) / 4}`);
  const cards = process.env.CARDS !== '0';
  const matrix = process.env.MATRIX !== '0';
  const jobs = [...(matrix ? ids.map((_, i) => `matrix:${i}`) : []), 'ctrl', ...(cards ? [...chunks('pp'), ...chunks('pm')] : [])];
  const results = new Map<string, unknown>();
  const queue = [...jobs];
  await Promise.all([1, 2, 3, 4].map(async () => { for (let j = queue.shift(); j; j = queue.shift()) results.set(j, await run(j)); }));

  const out: Record<string, unknown> = { ctrl: results.get('ctrl') };
  if (matrix) out.matrix = printMatrix(ids, results);
  else console.log(`earth control vs fire ${(results.get('ctrl') as number).toFixed(1)}`);
  if (cards) out.cards = printCards(sim, bot, results, chunks);
  if (process.env.JSON_OUT) writeFileSync(process.env.JSON_OUT, JSON.stringify(out));
}

function printMatrix(ids: string[], results: Map<string, unknown>) {
  const win = ids.map(() => ids.map(() => 0)), games = ids.map(() => ids.map(() => 0));
  let draws = 0, total = 0;
  const mirror: number[] = [];
  ids.forEach((_, i) => (results.get(`matrix:${i}`) as { w: number; n: number; draws: number }[]).forEach((r, j) => {
    draws += r.draws; total += r.n / 2;
    if (i === j) { mirror[i] = (100 * r.w) / r.n; return; }
    win[i]![j]! += r.w; games[i]![j]! += r.n; win[j]![i]! += r.n - r.w; games[j]![i]! += r.n;
  }));
  const avg = ids.map((_, i) => (100 * win[i]!.reduce((a, x) => a + x, 0)) / games[i]!.reduce((a, x) => a + x, 0));
  let widest = 0, widestAt = '';
  ids.forEach((a, i) => ids.forEach((b, j) => { const p = i === j ? 0 : (100 * win[i]![j]!) / games[i]![j]!; if (p > widest) { widest = p; widestAt = `${a}>${b}`; } }));
  console.log(`matrix (${seeds} seeds), row win % vs column, then avg`);
  console.log(['', ...ids, 'avg'].map((x) => x.padStart(7)).join(''));
  ids.forEach((id, i) => console.log([id, ...ids.map((_, j) => (i === j ? mirror[i]! : (100 * win[i]![j]!) / games[i]![j]!).toFixed(1)), avg[i]!.toFixed(1)].map((x) => x.padStart(7)).join('')));
  const ctrl = results.get('ctrl') as number;
  const gate = (ok: boolean) => (ok ? 'ok' : 'FAIL');
  console.log(`gates: avg ${Math.min(...avg).toFixed(1)}-${Math.max(...avg).toFixed(1)} ${gate(avg.every((x) => x >= 45 && x <= 55))} | mirror ${Math.min(...mirror).toFixed(1)}-${Math.max(...mirror).toFixed(1)} ${gate(mirror.every((x) => x >= 45 && x <= 55))} | widest ${widest.toFixed(1)} ${widestAt} ${gate(widest <= 65)} | draws ${draws}/${total} | earth control vs fire ${ctrl.toFixed(1)}`);
  return { ids, pct: ids.map((_, i) => ids.map((_, j) => (i === j ? mirror[i]! : (100 * win[i]![j]!) / games[i]![j]!))), avg, draws };
}

function printCards(sim: typeof import('../src'), bot: typeof import('../test/battleBot'), results: Map<string, unknown>, chunks: (t: string) => string[]) {
  const tables = (['pp', 'pm'] as const).map((t) => {
    const pts: Record<string, [number, number]> = {};
    for (const k of chunks(t)) for (const [c, [a, b]] of Object.entries(results.get(k) as Record<string, [number, number]>)) { const x = (pts[c] ??= [0, 0]); x[0] += a; x[1] += b; }
    const win = new Map(Object.entries(pts).map(([c, [a, b]]) => [c, (100 * a) / b]));
    const band = new Map<string, number[]>();
    for (const [c, p] of win) (band.get(bot.bandOf(c)) ?? band.set(bot.bandOf(c), []).get(bot.bandOf(c))!).push(p);
    return { win, diff: new Map([...win].map(([c, p]) => { const b = band.get(bot.bandOf(c))!; return [c, p - b.reduce((a, x) => a + x, 0) / b.length]; })) };
  });
  const raw = Object.fromEntries([...tables[0]!.win].map(([c, p]) => [c, [p, tables[1]!.win.get(c)]]));
  console.log(`\nper card vs band avg (${cardGames} random-team games each): paced vs paced, paced vs rush/defend`);
  let out = 0;
  for (const c of sim.battleCardIds) {
    const [a, b] = tables.map((t) => t.diff.get(c));
    if (a == null || b == null) continue;
    const bad = Math.abs(a) > 8 || Math.abs(b) > 8;
    if (bad) out++;
    if (bad || process.env.ALL === '1' || c in candidate) console.log(`${c.padEnd(26)} ${bot.bandOf(c).padEnd(13)} ${a.toFixed(1).padStart(6)} ${b.toFixed(1).padStart(6)}${bad ? '  OUT' : ''}`);
  }
  console.log(`cards outside +-8: ${out}`);
  return raw;
}
main().catch((e) => { console.error(e); process.exit(1); });
