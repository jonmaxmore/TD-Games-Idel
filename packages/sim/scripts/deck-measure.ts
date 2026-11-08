// Deck budget table (SPEC-deck-budget §7, deck-budget-research.md §5.0 with real leaders): legal hand shapes, each a list of
// 6 non-basic slots (size and deck points), played round-robin under ranked rules (normalized, abilities on). Per seed
// each shape draws real cards for its slots (the dearest leads, the next is sub), and every pairing plays both side
// orders on that seed with the same cards. Per bot: each shape's win % over all its games (draws half), then per card the
// win % of the hands that held it, then leaders with an ability against leaders without.
// GUARDS=0 leaves guards out of the shapes: rush never summons a guard and paced and defend only when enemies are in their
// half, so a guard slot reads as a dead card for those bots (research §5.5).
// DECK_SEEDS (default 100), BOTS=paced,rush,defend, and levers for tuning without editing data: BUDGET, SMALL, MEDIUM, LARGE
// (sizePoints), CARD_POINTS='{"frost_tide_naga":11}', SHAPES='L9,L9,S2,S2,S2,S2;...' (else representatives are enumerated).
import { battle, battleCardIds, battleUnits, deckPoints, nextRandom, type BattleSetup } from '../src';
import { playBattle, type Policy } from '../test/battleBot';

const seeds = Number(process.env.DECK_SEEDS ?? 100);
const bots = (process.env.BOTS ?? 'paced,rush,defend').split(',') as Policy[];
if (process.env.BUDGET) battle.deck.budget = Number(process.env.BUDGET);
for (const z of ['small', 'medium', 'large']) { const v = process.env[z.toUpperCase()]; if (v) battle.deck.sizePoints.set(z, Number(v)); }
for (const [k, v] of Object.entries(JSON.parse(process.env.CARD_POINTS ?? '{}') as Record<string, number>)) battle.deck.cardPoints.set(k, v);
const { budget, pick } = battle.deck, maxLarge = battle.hand.maxLarge, SLOTS = pick + 2;

const basics = new Set(battle.hand.basic.values());
const SIZE = ['small', 'medium', 'large'];
const slotOf = (c: string) => `${battleUnits.get(c)!.size[0]!.toUpperCase()}${deckPoints(c)}`;
const pts = (slot: string) => Number(slot.slice(1));
const pool = new Map<string, string[]>();
const guards = process.env.GUARDS !== '0';
for (const c of battleCardIds) if (!basics.has(c) && (guards || battleUnits.get(c)!.move !== 'guard')) pool.set(slotOf(c), [...(pool.get(slotOf(c)) ?? []), c]);
const sizeRank = (slot: string) => SIZE.findIndex((z) => z[0] === slot[0]!.toLowerCase());
const slots = [...pool.keys()].sort((a, b) => sizeRank(a) - sizeRank(b) || pts(a) - pts(b));

type Shape = string[]; // slots, dearest first
const total = (s: Shape) => s.reduce((a, x) => a + pts(x), 0);
const larges = (s: Shape) => s.filter((x) => x[0] === 'L');
const name = (s: Shape) => s.join(',');

// Every multiset of SLOTS slots the pool can fill, legal and within 2 points of the budget; then per large count the
// heaviest and lightest large part (ties: widest, narrowest spread of the rest) and the median.
function representatives(): Shape[] {
  const all: Shape[] = [];
  const go = (i: number, acc: string[]) => {
    if (acc.length === SLOTS) { all.push([...acc].sort((a, b) => pts(b) - pts(a))); return; }
    if (i >= slots.length) return;
    for (let n = Math.min(pool.get(slots[i]!)!.length, SLOTS - acc.length); n >= 0; n--) go(i + 1, [...acc, ...Array(n).fill(slots[i]!)]);
  };
  go(0, []);
  const legal = all.filter((s) => larges(s).length <= maxLarge && total(s) <= budget && total(s) >= budget - 2);
  const out: Shape[] = [];
  for (let k = 0; k <= maxLarge; k++) {
    const g = legal.filter((s) => larges(s).length === k);
    if (g.length === 0) continue;
    const L = (s: Shape) => total(larges(s)), rest = (s: Shape) => s.filter((x) => x[0] !== 'L').map(pts), spread = (s: Shape) => (rest(s).length ? Math.max(...rest(s)) - Math.min(...rest(s)) : 0);
    const sorted = [...g].sort((a, b) => L(b) - L(a) || spread(b) - spread(a) || total(b) - total(a));
    for (const s of [sorted[0]!, sorted[sorted.length - 1]!, sorted[Math.floor(sorted.length / 2)]!]) if (!out.some((o) => name(o) === name(s))) out.push(s);
  }
  return out;
}
const shapes: Shape[] = process.env.SHAPES ? process.env.SHAPES.split(';').map((s) => s.split(',').sort((a, b) => pts(b) - pts(a))) : representatives();

// The cards of a shape on a seed: each slot a different card of its size and points, in a seeded draw.
function team(si: number, seed: number): BattleSetup {
  const r = { rng: (seed * 2654435761 + si * 40503 + 7) >>> 0 }, used: string[] = [];
  for (const slot of shapes[si]!) {
    const c = pool.get(slot)!.filter((x) => !used.includes(x));
    used.push(c[Math.floor(nextRandom(r) * c.length)]!);
  }
  const [leader, sub, ...picks] = used as [string, string, ...string[]];
  return { leader, sub, picks };
}

const pct = (w: number, n: number) => (n === 0 ? '   -' : ((100 * w) / n).toFixed(1).padStart(5));
console.log(`deck budget ${budget}${guards ? '' : ', no guards (GUARDS=0)'}, sizePoints ${JSON.stringify(Object.fromEntries(battle.deck.sizePoints))}, cardPoints ${JSON.stringify(Object.fromEntries(battle.deck.cardPoints))}, ${seeds} seeds x 2 side orders per pairing, normalized`);
const shapeWin = new Map<string, number[]>(), cardWin = new Map<string, number[]>(), cardN = new Map<string, number[]>(), abil = [[0, 0], [0, 0]];
const add = (m: Map<string, number[]>, k: string, b: number, v: number) => { const x = m.get(k) ?? bots.map(() => 0); x[b]! += v; m.set(k, x); };
bots.forEach((bot, b) => {
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++)
    for (let seed = 1; seed <= seeds; seed++) {
      const A = team(i, seed), B = team(j, seed);
      for (const [x, y, xi, yi] of [[A, B, i, j], [B, A, j, i]] as [BattleSetup, BattleSetup, number, number][]) {
        const w = playBattle(seed, bot, bot, x, y, { normalized: true }).state.winner, s0 = w === 0 ? 2 : w === -1 ? 1 : 0;
        for (const [t, si, sc] of [[x, xi, s0], [y, yi, 2 - s0]] as [BattleSetup, number, number][]) {
          add(shapeWin, name(shapes[si]!), b, sc);
          for (const c of [t.leader, t.sub, ...t.picks]) { add(cardWin, c, b, sc); add(cardN, c, b, 2); }
          if (bot === 'paced') { const a = battleUnits.get(t.leader)!.ability ? 1 : 0; abil[a]![0]! += sc; abil[a]![1]! += 2; }
        }
      }
    }
});
const perShape = 2 * seeds * (shapes.length - 1);
console.log(`\nshape (slots: size + deck points, dearest first) | points | large | win% per bot (${perShape} games each)`);
console.log(`${'shape'.padEnd(24)} pts  L | ${bots.map((b) => b.padStart(6)).join(' ')}`);
for (const s of shapes) console.log(`${name(s).padEnd(24)} ${String(total(s)).padStart(3)}  ${larges(s).length} | ${shapeWin.get(name(s))!.map((w) => pct(w, 2 * perShape).padStart(6)).join(' ')}`);
const spread = bots.map((_, b) => { const w = shapes.map((s) => (100 * shapeWin.get(name(s))![b]!) / (2 * perShape)); return Math.max(...w.map((x) => Math.abs(x - 50))); });
console.log(`${'max |win% - 50|'.padEnd(31)} | ${spread.map((x) => x.toFixed(1).padStart(6)).join(' ')}`);
console.log(`\nper card: deck points | hands held per bot | win% when held per bot`);
for (const c of battleCardIds) if (cardN.has(c)) console.log(`${c.padEnd(24)} ${String(deckPoints(c)).padStart(2)} | ${cardN.get(c)!.map((n) => String(n / 2).padStart(5)).join(' ')} | ${cardWin.get(c)!.map((w, b) => pct(w, cardN.get(c)![b]!)).join(' ')}`);
if (bots.includes('paced')) console.log(`\nleader ability (paced): with ${pct(abil[1]![0]!, abil[1]![1]!)} (${abil[1]![1]! / 2} sides) | without ${pct(abil[0]![0]!, abil[0]![1]!)} (${abil[0]![1]! / 2} sides)`);
