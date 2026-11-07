# Plan: M0 Vertical Slice

Implements [docs/specs/SPEC-m0.md](../docs/specs/SPEC-m0.md) (approved).

## Order
1. **Workspace** — npm workspaces, TS strict, Vitest, Vite. Verify: `npm test` runs (empty), `npm run typecheck`.
2. **sim core** — rng (mulberry32), data loader (docs/data → integer units), Wu Xing tables, state + `step()` at 20Hz, commands, `hashState()`. Verify: unit tests + determinism test.
3. **sim defend** — layouts for 1-1, 1-2, 1-4 + training ground, waves from `stages.json` enemies + `waveHpCurve`, targeting, sect effects per level, generate-adjacency, combos, economy (bounty, interest, sell), stars. Verify: tests per rule; headless 1-4 run.
4. **sim assault** — 1-3 party, fork route, outposts, skills, pills, stars. Verify: tests win/lose.
5. **client** — Phaser 3.90 at 180×320 pixelArt; Menu → Stage → Result; procedural sprites; hit/impact FX from sim events; interpolation; x2 speed; localStorage stars. Verify: manual play + Playwright smoke.
6. **Polish + perf** — 60fps check at max enemies on 1-4; sim:replay script.

## Risks
- Determinism drift from float math → integer units everywhere in sim, test with hash at every 100 ticks.
- 20Hz sim looks choppy → client lerps positions between ticks.
- Scope creep in combos → each combo = both parents' level-1 effects + stat boost; unique visuals later.
