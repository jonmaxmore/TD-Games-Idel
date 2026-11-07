# Spec: M0 Vertical Slice

> Milestone M0 from [GDD §11](../GDD.md#11-roadmap-สู่การวางตลาด). Status: **approved · implemented** (see `tasks/todo.md`)

## Objective
Prove that the core loop is fun and that the technical foundation holds, before spending on art or servers.

- A player opens the game in a browser on this machine and plays story stages **1-1 to 1-4** from [`stages.json`](../data/stages.json):
  - 1-1, 1-2 and 1-4 are defend stages
  - 1-3 is an assault stage
- Each stage ends in a win or loss, with 0–3 stars.
- A **training ground** (ลานฝึกยุทธ์) stage has all 6 sects unlocked, to test the Wu Xing rules and combo techniques (story chapter 1 only unlocks 2 sects).
- **Foundation for esports and anti-cheat:** the rules run in a deterministic `sim` package. The same seed and command list must always produce the same result, which replays, PvP and server verification need later.

Out of scope for M0: servers, accounts, multiplayer, idle/meta, monetization, real art, sound, mobile build.

## Capability map

| Module id | Responsibility | Depends on |
|---|---|---|
| `sim` | Game rules: tick loop, entities, Wu Xing, combos, economy, stage scripts, commands, state hash. Pure TypeScript, no DOM. | `docs/data/*.json` |
| `client` | Phaser rendering, input → commands, HUD, menus, procedural pixel sprites, local star save | `sim` |

Build order: `sim` → `client`.

## Assumptions (correct me now)
1. **Phaser 3.90 (stable v3), not Phaser 4.** It matches the GDD and has the most documentation; a move to v4 can be evaluated later.
2. **npm workspaces + TypeScript + Vite + Vitest.** No other framework.
3. **Placeholder art is generated in code** from the concept sheet's pixel templates (no image files).
4. **Integer math in `sim`:** positions in milli-tiles, HP and damage as integers, rates in ticks. JSON values are converted on load.
5. **Assault 1-3 is simplified:**
   - A party of 3 disciples walks a path with one fork, where the player picks a route.
   - Cult outposts shoot the party.
   - The player taps each disciple's skill button.
   - Win = reach the end with ≥1 disciple.
6. **Combo techniques in M0:** merge two max-level disciples of different elements. All 10 pairs exist in data. M0 implements the stat and effect for each pair in a simplified form, not every visual.
7. **Stars are saved in `localStorage`** only.

## Tech stack
- Node 22, npm workspaces
- TypeScript (strict), Vite, Vitest
- Phaser 3.90

## Commands
```
Install:    npm install
Dev:        npm run dev          # client at http://localhost:5173
Test:       npm test             # vitest, all packages
Typecheck:  npm run typecheck
Build:      npm run build        # client production build → packages/client/dist
Sim check:  npm run sim:replay -- --stage 1-4 --seed 42   # headless bot run, prints result + hash
Smoke:      npm run build && npm run smoke                  # Playwright; CHROMIUM_PATH=... to use a local Chromium
```

## Project structure
```
package.json                 workspaces, root scripts
tsconfig.base.json
packages/sim/
  src/index.ts               public API: createGame, step, applyCommand, hashState
  src/rng.ts                 seeded PRNG (mulberry32)
  src/data.ts                loads + converts docs/data/*.json to integer units
  src/wuxing.ts              generate/overcome tables, multipliers
  src/world.ts               entities, targeting, projectiles, status effects
  src/economy.ts             silver, interest, costs
  src/stages/                defend + assault stage runners, wave scripts
  src/commands.ts            command types (place, upgrade, sell, merge, cast, chooseRoute, skill)
  test/*.test.ts
  scripts/replay.ts          headless runner used by sim:replay
packages/client/
  index.html
  src/main.ts                Phaser config (180x320, pixelArt, integer zoom)
  src/scenes/                Boot, Menu, Stage, Result
  src/render/sprites.ts      procedural pixel sprites (from concept templates)
  src/render/fx.ts           per-sect projectile/impact effects (effects.json)
  src/input.ts               taps → sim commands
docs/specs/SPEC-m0.md        this file
```

## Code style
```ts
// sim: pure functions over plain data, integer units, no hidden state
export function damageAfterWuxing(base: number, attacker: Element, target: Element): number {
  if (OVERCOMES[attacker] === target) return (base * 3) >> 1; // x1.5
  if (OVERCOMES[target] === attacker) return (base * 7) / 10 | 0; // x0.7
  return base;
}
```
- camelCase for functions and variables, PascalCase for types, kebab-case for file names.
- `sim` must not use `Math.random`, `Date`, `performance`, or DOM APIs, and must not iterate over unordered keys for game logic. A test greps for these.
- Game numbers come from `docs/data`, never literals in logic (except unit conversion).

## Testing strategy
- **Vitest unit tests in `packages/sim/test`:**
  - Wu Xing multipliers and the generate-adjacency +15%
  - Interest and its cap
  - Upgrade and sell costs
  - Combo merge rules
  - Star evaluation
  - Assault win/lose
- **Determinism test:** run stage 1-4 twice with seed 42 and a fixed command list, and require an identical `hashState` at every 100th tick. Also run a third time with seed 43 and require a different hash.
- **Data integrity test:** every enemy and sect referenced by stages 1-1 to 1-4 resolves.
- **Client:** manual play-through plus one Playwright smoke test that loads the page, starts 1-1 and checks for no console errors.

## Boundaries
- **Always:**
  - Run `npm test` and `npm run typecheck` before each commit.
  - Keep `sim` deterministic.
  - Read numbers from `docs/data`.
  - Follow `CLAUDE.md`.
- **Ask first:**
  - Adding dependencies beyond the stack above.
  - Changing `docs/data` schemas.
  - Moving to Phaser 4.
- **Never:**
  - Copy Flash Element TD code or assets.
  - Commit secrets.
  - Skip or delete failing tests.

## Success criteria
1. `npm install && npm test && npm run typecheck && npm run build` all succeed from a clean clone.
2. `npm run dev` lets a player:
   - win or lose stages 1-1 to 1-4
   - see 0–3 stars based on each stage's conditions
   - keep their stars after a page reload
3. In the training ground: placing Metal next to Earth gives +15% (earth generates metal), merging two max-level disciples produces the correct combo, and enemies show ×1.5 / ×0.7 damage numbers.
4. The determinism test passes, and `sim:replay` prints the same hash on repeated runs.
5. The 20-wave training ground with 9 disciples holds 60fps in headless Chrome (smoke test reports `fps`). Stage 1-4 was shortened to 12 waves after balance tests.
6. The Playwright smoke test passes with no console errors.

## Open questions
1. Phaser 3.90 or Phaser 4? (default: 3.90)
2. Is the simplified 1-3 assault design acceptable for M0? (default: yes)
