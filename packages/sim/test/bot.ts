// Simple greedy player used for balance checks: builds on the tiles that cover the most path,
// alternates the unlocked sects, and upgrades once it has enough disciples.
import { canBuild, defOf, GRID_H, GRID_W, isOver, placeCost, step, upgradeCost, type Command, type DefendState } from "../src/index";

export function bestTiles(s: DefendState, range = 2500): [number, number][] {
  const pathTiles = s.pathTiles.map((k) => k.split(',').map(Number) as [number, number]);
  const scored: { t: [number, number]; score: number }[] = [];
  for (let ty = 0; ty < GRID_H; ty++)
    for (let tx = 0; tx < GRID_W; tx++) {
      if (!canBuild(s, tx, ty)) continue;
      const r = range / 1000;
      const score = pathTiles.filter(([px, py]) => (px - tx) ** 2 + (py - ty) ** 2 <= r * r).length;
      scored.push({ t: [tx, ty], score });
    }
  scored.sort((a, b) => b.score - a.score || a.t[1] - b.t[1] || a.t[0] - b.t[0]);
  return scored.map((x) => x.t);
}

// earlyCall: also calls the next wave once the current one has fully spawned and at most 3 enemies remain.
export function playBot(s: DefendState, opts: { maxDisciples?: number; sects?: string[]; record?: Record<number, Command[]>; earlyCall?: boolean } = {}): DefendState {
  const sects = opts.sects ?? s.unlocked;
  const max = opts.maxDisciples ?? 8;
  let placed = 0;
  while (!isOver(s) && s.tick < 20 * 60 * 30) {
    const cmds: Command[] = s.tick === 0 ? [{ t: 'nextWave' }] : [];
    if (opts.earlyCall && s.phase === 'clearing' && s.enemies.length <= 3 && s.wave < s.totalWaves) cmds.push({ t: 'nextWave' });
    const sect = sects[placed % sects.length]!;
    const lowest = [...s.disciples].sort((a, b) => a.level - b.level)[0];
    // Past `max`, keep spending: once every disciple is maxed, place more instead of hoarding silver.
    const allMaxed = !!lowest && lowest.level >= 3;
    const wantPlace = placed < 3 || ((placed < max || allMaxed) && (!lowest || lowest.level >= 2));
    if (wantPlace) {
      const spot = bestTiles(s, defOf(sect).range)[0];
      if (spot && s.silver >= placeCost(sect)) { cmds.push({ t: 'place', sect, tx: spot[0], ty: spot[1] }); placed++; }
    } else if (lowest && lowest.level < 3 && s.silver >= upgradeCost(lowest)) cmds.push({ t: 'upgrade', id: lowest.id });
    if (opts.record && cmds.length) opts.record[s.tick] = cmds;
    step(s, cmds);
  }
  return s;
}
