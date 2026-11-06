// Simple greedy player used for balance checks and golden replays: builds on the tiles that cover the most path,
// alternates the unlocked sects, and upgrades once it has enough disciples.
import { canBuild, createDefend, defOf, grid, isOver, placeCost, stepDefend, tileRange, tilesOnPath, units, upgradeCost, waveRecipes, type Command, type DefendState } from '../src';

// A tile scores the path tiles it reaches, counted once per path through them, so the shared stretch every enemy walks
// beats a pocket that guards a single entrance. Ties go to the tile that reaches furthest up a path (meets enemies first).
// lane: score only that path's tiles.
export function bestTiles(s: DefendState, range = 2500, lane: number | null = null): { tx: number; ty: number }[] {
  const paths = lane == null ? s.layout.paths : [s.layout.paths[lane]!];
  const path = paths.flatMap((p) => [...tilesOnPath(p)].map((k, i) => [...k.split(',').map(Number), i] as [number, number, number]));
  const scored: { tx: number; ty: number; score: number; first: number }[] = [];
  const r = range / 1000.0;
  for (let ty = 0; ty < grid.h; ty++)
    for (let tx = 0; tx < grid.w; tx++) {
      if (!canBuild(s, tx, ty)) continue;
      const near = path.filter(([x, y]) => (x - tx) * (x - tx) + (y - ty) * (y - ty) <= r * r);
      scored.push({ tx, ty, score: near.length, first: Math.min(...near.map((p) => p[2])) });
    }
  return scored.sort((a, b) => b.score - a.score || a.first - b.first || a.ty - b.ty || a.tx - b.tx);
}

export interface PlayOpts { maxDisciples?: number; sects?: string[]; record?: Record<number, Command[]>; earlyCall?: boolean }

// earlyCall: also calls the next wave once the current one has fully spawned and at most 3 enemies remain.
// One decision per tick; `mem.placed` counts placements so the bot rotates through its sects.
export function botCommands(s: DefendState, o: PlayOpts = {}, mem = { placed: 0 }): Command[] {
  const maxDisciples = o.maxDisciples ?? 8;
  const sects = o.sects ?? s.unlocked;
  const cmds: Command[] = s.tick === 0 ? [{ t: 'nextWave' }] : [];
  if (o.earlyCall && s.phase === 'clearing' && s.enemies.length <= 3 && s.wave < s.totalWaves) cmds.push({ t: 'nextWave' });
  let sect = sects[mem.placed % sects.length]!;
  // Like a player reading the next-wave bar: if the coming shape needs a role nobody holds, place that role first.
  const need = needed(s, sects);
  const urgent = need != null;
  if (need != null) sect = need;
  let lowest = s.disciples[0];
  for (const d of s.disciples) if (d.level < lowest!.level) lowest = d;
  // Past the cap, keep spending: once every disciple is maxed, place more instead of hoarding silver.
  const allMaxed = lowest != null && lowest.level >= 3;
  const wantPlace = urgent || mem.placed < 3 || ((mem.placed < maxDisciples || allMaxed) && (lowest == null || lowest.level >= 2));
  if (wantPlace) {
    // On separate lanes (paths that meet only at the gate) a player splits the defence: placement n guards lane n mod lanes.
    const lane = separateLanes(s) ? mem.placed % s.layout.paths.length : null;
    const spots = bestTiles(s, tileRange(s, defOf(sect).range, [units.get(sect)?.sect ?? sect], -1, -1), lane); // sees the fog's cap
    if (spots.length > 0 && s.silver >= placeCost(sect)) { cmds.push({ t: 'place', sect, tx: spots[0]!.tx, ty: spots[0]!.ty }); mem.placed++; }
  } else if (lowest != null && lowest.level < 3 && s.silver >= upgradeCost(lowest)) cmds.push({ t: 'upgrade', id: lowest.id });
  return cmds;
}

export function play(s: DefendState, o: PlayOpts = {}): DefendState {
  const mem = { placed: 0 };
  while (!isOver(s) && s.tick < 20 * 60 * 30) {
    const cmds = botCommands(s, o, mem);
    if (o.record && cmds.length > 0) o.record[s.tick] = cmds;
    stepDefend(s, cmds);
  }
  return s;
}

function separateLanes(s: DefendState): boolean {
  if (s.layout.paths.length < 2) return false;
  const [a, b] = s.layout.paths.map((p) => tilesOnPath(p));
  return [...a!].filter((k) => b!.has(k)).length <= 1;
}

// A unit for a role the next wave asks for ("air": anything that hits air) when no placed disciple covers it.
function needed(s: DefendState, sects: string[]): string | null {
  if (s.sect == null) return null;
  const rec = waveRecipes.find((r) => r.id === s.nextRecipe);
  if (!rec) return null;
  for (const role of rec.needsRoles) {
    const covers = (k: string) => { const u = units.get(k); return u != null && (role === 'air' ? u.hitsAir : u.roleId === role); };
    if (s.disciples.some((d) => d.unit != null && covers(d.unit))) continue;
    const unit = sects.find(covers);
    if (unit != null) return unit;
  }
  return null;
}

export const playStage = (stageId: string, seed: number, sect: string | null = null, o: PlayOpts = {}) => play(createDefend(stageId, seed, sect), o);
