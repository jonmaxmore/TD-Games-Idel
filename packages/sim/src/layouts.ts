// Map layouts in tile coordinates (grid 11 x 18). Paths are axis-aligned polylines through tile centres.
// Moves to Tiled JSON files once real maps exist (docs/design/maps.md).
export const GRID_W = 11;
export const GRID_H = 18;

export type Pt = [number, number];

export interface DefendLayout {
  kind: 'defend';
  path: Pt[];
}

export interface Outpost {
  at: Pt;
  route: 'any' | 'left' | 'right';
  hp: number;
  dmg: number;
}

export interface AssaultLayout {
  kind: 'assault';
  start: Pt[];
  left: Pt[];
  right: Pt[];
  end: Pt[];
  outposts: Outpost[];
  pills: Pt[];
}

export const LAYOUTS: Record<string, DefendLayout | AssaultLayout> = {
  'village-a': { kind: 'defend', path: [[0, 2], [8, 2], [8, 7], [2, 7], [2, 12], [9, 12], [9, 17]] },
  'village-b': { kind: 'defend', path: [[5, 0], [5, 4], [1, 4], [1, 9], [9, 9], [9, 14], [4, 14], [4, 17]] },
  'assault-a': {
    kind: 'assault',
    start: [[5, 17], [5, 12]],
    left: [[1, 12], [1, 6], [5, 6]],
    right: [[9, 12], [9, 6], [5, 6]],
    end: [[5, 0]],
    outposts: [
      { at: [3, 15], route: 'any', hp: 500, dmg: 12 },
      { at: [3, 10], route: 'left', hp: 450, dmg: 10 },
      { at: [3, 7], route: 'left', hp: 450, dmg: 10 },
      { at: [7, 9], route: 'right', hp: 1100, dmg: 20 },
      { at: [6, 2], route: 'any', hp: 1400, dmg: 18 },
    ],
    pills: [[1, 9]],
  },
};

export function tilesOnPath(path: Pt[]): Set<string> {
  const out = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1]!;
    const [x1, y1] = path[i]!;
    const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
    for (let x = x0, y = y0; ; x += sx, y += sy) {
      out.add(`${x},${y}`);
      if (x === x1 && y === y1) break;
    }
  }
  return out;
}
