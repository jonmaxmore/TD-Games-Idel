import { TILE } from './data';
import type { Pt } from './layouts';

// Waypoints in milli-tiles at tile centres.
export function toMilli(path: Pt[]): Pt[] {
  return path.map(([x, y]) => [x * TILE + TILE / 2, y * TILE + TILE / 2]);
}

export function pathLength(path: Pt[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1]!;
    const [x1, y1] = path[i]!;
    len += Math.abs(x1 - x0) + Math.abs(y1 - y0); // axis-aligned segments
  }
  return len;
}

export function pointAt(path: Pt[], d: number): Pt {
  let rest = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1]!;
    const [x1, y1] = path[i]!;
    const seg = Math.abs(x1 - x0) + Math.abs(y1 - y0);
    if (rest <= seg) return [x0 + Math.sign(x1 - x0) * rest, y0 + Math.sign(y1 - y0) * rest];
    rest -= seg;
  }
  return path[path.length - 1]!;
}

export function within(ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy <= r * r;
}
