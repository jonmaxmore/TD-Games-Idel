# ADR 0007: TypeScript everywhere: three.js web client and Node backend (supersedes ADR 0004 and ADR 0006)

- Status: accepted
- Date: 2026-11-06
- Amended by: [ADR 0008](0008-pc-only-16x9.md) (PC only, 16:9, 2.5D pixel art in Canvas 2D; no three.js, no Capacitor build)
- Supersedes: [ADR 0006](0006-csharp-everywhere.md) (C# everywhere) and [ADR 0004](0004-unity-client.md) (Unity client). Restores [ADR 0003](0003-node-postgres-backend.md) (Node + PostgreSQL backend).

## Context
The owner asked whether to drop the old code and build the game with three.js and a Node backend.

Facts at the time:
- **Unity could not be checked here.** Unity does not run in the agent's container. The battle UI and front-flow passes were checked only by compiling against stubs. No screen was ever seen running.
- **The web can be seen running.** Chromium is installed in the container. A script can open the game in a real browser, let the bot play, record video and fail on console errors.
- **Thai text renders correctly in the browser.** Vowel and tone marks and line breaks come out right in a bundled web font. Unity needed a font workaround.
- **The rules were already proven twice.** The C# rules had been ported line by line from TypeScript and pinned by six golden replays.
- **The original plan was web first, then mobile.** That plan was web first, then mobile through Capacitor (GDD §10, ADR 0003).

## Decision
TypeScript for everything:
- **`packages/sim`** holds the rules. It is ported line by line from the C# `FiveSects.Sim` and is the single source of truth.
  - The six goldens regenerate byte for byte, so the port changed no outcome.
  - All 60 C# tests were ported to vitest.
- **`packages/client`** is the client: Vite, three.js for the board and plain DOM for the HUD.
  - Mobile is built through Capacitor.
- **The backend (from M1)** is Node 22 + Fastify + PostgreSQL 16 + Redis 7 as in ADR 0003. It re-runs replays with `packages/sim`.
- **Deleted:**
  - `prototypes/unity`
  - `tools/simtest`
  - the Phaser client
  - the frozen TS reference (`packages/FROZEN.md`)
  - the assault-mode TS code (`assault.ts`), which stays in git history.

## Consequences
- **One language, one rules implementation, one test runner.** The test runner is `npm test`, using vitest.
- **Every UI change gets visual proof.** `npm run shots` produces screenshots and a video in `shots/`.
- **Determinism rests on JS integer math** (all values stay well below 2^53) and `Math.imul` for the RNG and the hash. A ban scan in the tests blocks clocks, `Math.random`, DOM and locale APIs inside the rules.
- **Lost:**
  - Unity's native mobile tooling: IAP, push and haptics go through Capacitor plugins instead.
  - Heavy 3D or console reach, which v1.0 does not need.
