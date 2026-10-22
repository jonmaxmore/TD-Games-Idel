// mulberry32: tiny seeded PRNG. State is a uint32 stored in GameState so replays stay identical.
export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Integer roll in [0, 100).
export function rollPct(state: { rng: number }): number {
  return Math.floor(nextRandom(state) * 100);
}
