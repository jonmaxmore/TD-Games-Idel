// Map layouts in tile coordinates, loaded from docs/data/maps.json (docs/art/map-design.md).
// Paths are axis-aligned polylines through tile centres, from the spawn gate on the board edge to the goal gate inside it.
import mapsJson from '../../../docs/data/maps.json';

export const GRID_W = mapsJson.grid[0]!;
export const GRID_H = mapsJson.grid[1]!;

export type Pt = [number, number];

export interface Prop {
  type: string;
  at: Pt;
}

interface Common {
  biome: string;
  nameTh: string;
  props: Prop[];
  goalGate?: string;
}

export interface DefendLayout extends Common {
  kind: 'defend';
  path: Pt[];
}

export interface Outpost {
  at: Pt;
  route: 'any' | 'left' | 'right';
  hp: number;
  dmg: number;
}

export interface AssaultLayout extends Common {
  kind: 'assault';
  start: Pt[];
  left: Pt[];
  right: Pt[];
  end: Pt[];
  outposts: Outpost[];
  pills: Pt[];
}

export type Layout = DefendLayout | AssaultLayout;

export interface Biome {
  nameTh: string;
  chapter: number;
  time: string;
  palette: string;
  moodTh: string;
  mechanicTh: string;
  spawnGate: string;
  goalGate: string;
}

export const LAYOUTS = mapsJson.layouts as unknown as Record<string, Layout>;
export const BIOMES = mapsJson.biomes as Record<string, Biome>;
export const PROP_TYPES = mapsJson.propTypes as Record<string, { block: boolean; nameTh: string }>;

// Layout as played: 'mirror' flips x so one hand-made layout gives two maps.
export function resolveLayout(name: string, variant?: string): Layout | undefined {
  const l = LAYOUTS[name];
  if (!l || variant !== 'mirror') return l;
  const f = ([x, y]: Pt): Pt => [GRID_W - 1 - x, y];
  const props = l.props.map((p) => ({ ...p, at: f(p.at) }));
  if (l.kind === 'defend') return { ...l, props, path: l.path.map(f) };
  return {
    ...l, props, start: l.start.map(f), end: l.end.map(f), pills: l.pills.map(f),
    // mirrored left branch is now on the right
    left: l.right.map(f), right: l.left.map(f),
    outposts: l.outposts.map((o) => ({ ...o, at: f(o.at), route: o.route === 'left' ? 'right' : o.route === 'right' ? 'left' : 'any' })),
  };
}

// Tiles where disciples cannot stand because a blocking prop (house, tree, rock...) is there. Sorted for determinism.
export function blockedTiles(l: Layout): string[] {
  return l.props.filter((p) => PROP_TYPES[p.type]?.block).map((p) => `${p.at[0]},${p.at[1]}`).sort();
}

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
