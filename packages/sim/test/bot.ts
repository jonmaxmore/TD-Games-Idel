// Simple greedy player used for balance checks: builds on the tiles that cover the most path,
// alternates the unlocked sects, and upgrades once it has enough disciples.
import { canBuild, GRID_H, GRID_W, isOver, placeCost, SECTS, step, upgradeCost, type Command, type DefendState, type Element } from '../src/index';

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

export function playBot(s: DefendState, opts: { maxDisciples?: number; sects?: Element[] } = {}): DefendState {
  const sects = opts.sects ?? s.unlocked;
  const max = opts.maxDisciples ?? 8;
  let placed = 0;
  while (!isOver(s) && s.tick < 20 * 60 * 30) {
    const cmds: Command[] = s.tick === 0 ? [{ t: 'nextWave' }] : [];
    const sect = sects[placed % sects.length]!;
    const lowest = [...s.disciples].sort((a, b) => a.level - b.level)[0];
    const wantPlace = placed < 3 || (placed < max && (!lowest || lowest.level >= 2));
    if (wantPlace) {
      const spot = bestTiles(s, SECTS[sect].range)[0];
      if (spot && s.silver >= placeCost(sect)) { cmds.push({ t: 'place', sect, tx: spot[0], ty: spot[1] }); placed++; }
    } else if (lowest && lowest.level < 3 && s.silver >= upgradeCost(lowest)) cmds.push({ t: 'upgrade', id: lowest.id });
    step(s, cmds);
  }
  return s;
}
