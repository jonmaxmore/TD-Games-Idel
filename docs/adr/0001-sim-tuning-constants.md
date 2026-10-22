# ADR 0001: Sim tuning constants live in code for M0

- Status: accepted (M0), revisit in M1
- Date: 2026-10-22

## Context
`CLAUDE.md` says game numbers come from `docs/data`, never literals in logic. In M0 several numbers exist in the data only as free text (e.g. sect skills "slow 30% for 2s", combo effects, outpost stats). Making them structured is a schema change across `sects.json`, `enemies.json` and `stages.json`.

## Decision
For M0 these numbers stay in one place per module so they are easy to move:
- `packages/sim/src/defend.ts` → `FX` table (skill timings, sizes, crit/slow/burn values, adjacency, armor, healer) and `COMBO_EFFECTS` / `comboOnHit` (simplified signature effect per combo)
- `packages/sim/src/assault.ts` → top-of-file constants (party, HP, speed, ranges, skill, pills)
- `packages/sim/src/layouts.ts` → outpost hp/dmg (moves to Tiled maps)

Structured data already used: sect cost/dmg/rate/range/target, upgrade multipliers and names, enemy stats, wave HP curve, in-run economy, stage waves/silver/stars.

Known simplifications in M0: Golden Bell is a periodic area stun (not a path blocker); the wood level-3 vulnerability aura is map-wide; fire death explosions are not shown as hits.

## Consequences
- Balance changes to these values need a code change (and run the balance tests).
- M1 task: add structured `effects` fields to `sects.json` (per level) and `comboTechniques`, `stats` to outposts in map files, then read them in `data.ts` and delete the literals.
