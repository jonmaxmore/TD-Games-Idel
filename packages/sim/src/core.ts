// Seeded RNG, path math, map layouts, Wu Xing and the canonical state hash.
import { generates, grid, layouts, overcomeByPct, overcomePct, overcomes, propBlocks, TILE, type MapLayout, type Pt } from './data';
import type { DefendState } from './defend';

// mulberry32 over a uint32 state kept in the game state, so replays stay identical.
export function nextRandom(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const rollPct = (s: { rng: number }) => Math.floor(nextRandom(s) * 100);

// Integer division rounded down (every value the sim divides is non-negative).
export const div = (a: number, b: number) => Math.floor(a / b);

export const toMilli = (path: Pt[]): Pt[] => path.map((p) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 }));

export function pathLength(path: Pt[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y);
  return len;
}

export function pointAt(path: Pt[], d: number): Pt {
  let rest = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (rest <= seg) return { x: a.x + Math.sign(b.x - a.x) * rest, y: a.y + Math.sign(b.y - a.y) * rest };
    rest -= seg;
  }
  return path[path.length - 1]!;
}

export function within(ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy <= r * r;
}

export const tileKey = (x: number, y: number) => `${x},${y}`;

export function tilesOnPath(path: Pt[]): Set<string> {
  const o = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
    for (let x = a.x, y = a.y; ; x += sx, y += sy) {
      o.add(tileKey(x, y));
      if (x === b.x && y === b.y) break;
    }
  }
  return o;
}

// The 'mirror' variant flips x.
export function resolveLayout(name: string, variant: string | null): MapLayout {
  const l = layouts.get(name)!;
  if (variant !== 'mirror') return l;
  const f = (p: Pt): Pt => ({ x: grid.w - 1 - p.x, y: p.y });
  return { ...l, paths: l.paths.map((p) => p.map(f)), props: l.props.map((p) => ({ type: p.type, at: f(p.at) })) };
}

export function blockedTiles(l: MapLayout): Set<string> {
  const o = new Set<string>();
  for (const p of l.props) if (propBlocks.get(p.type)) o.add(tileKey(p.at.x, p.at.y));
  return o;
}

// Damage % of the best attacking element against the target: overcoming / overcome / neutral (SPEC-core §7).
export function wuxingPct(attacker: string[], target: string): number {
  let best = 0;
  for (const a of attacker) {
    let pct = 100;
    if (a !== 'yinyang' && target !== 'yinyang') {
      if (overcomes.get(a) === target) pct = overcomePct;
      else if (overcomes.get(target) === a) pct = overcomeByPct;
    }
    if (pct > best) best = pct;
  }
  return best;
}

export function isGenerated(own: string[], neighbours: string[][]): boolean {
  for (const n of neighbours)
    for (const ne of n)
      for (const oe of own)
        if (ne !== 'yinyang' && generates.get(ne) === oe) return true;
  return false;
}

// Engine-neutral state fingerprint with a fixed layout:
//   tick|silver|lives|wave|phase|rng|d<id>,<level>,<cd>,<hits>;...|e<id>,<type>,<hp>,<d>,<elite|->,<stunT>,<slowT>,<burnT>,<poison>;...|<cards,>
// Hash = FNV-1a 32-bit over UTF-16 code units, lowercase hex.
export function canonicalString(s: DefendState): string {
  let o = `${s.tick}|${s.silver}|${s.lives}|${s.wave}|${s.phase}|${s.rng}|`;
  for (const d of s.disciples) o += `d${d.id},${d.level},${d.cd},${d.hits};`;
  o += '|';
  for (const e of s.enemies) o += `e${e.id},${e.type},${e.hp},${e.d},${e.elite ?? '-'},${e.stunT},${e.slowT},${e.burnT},${e.poison};`;
  return o + '|' + s.cards.join(',');
}

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const canonicalHash = (s: DefendState) => fnv1a(canonicalString(s));
