# ADR 0004: Unity 6 client, rules kept in TypeScript with a C# port held in lockstep

- Status: accepted
- Date: 2026-10-22
- Amends: [ADR 0003](0003-node-postgres-backend.md) (backend unchanged; only the client engine changes)
- Evidence: [docs/design/engine-comparison.md](../design/engine-comparison.md), `prototypes/unity`

- Amended by [ADR 0006](0006-csharp-everywhere.md): the C# rules in `Assets/Scripts/Sim` are now the single source of truth (no longer a port of `packages/sim`), and the server runs them too.

## Context
The product owner built and played the Unity prototype (stage 1-1 and the defend stages with real maps).
- It compiled, ran at 61 fps in the editor and passed all parity tests.
- The owner preferred it to the Phaser client and decided to build the game in Unity.

Unity brings native mobile builds, mobile SDKs (ads, IAP, analytics), and an editor and animation tools for artists. The costs:
- A larger web build. The first WebGL build attempt was incomplete; the data file alone was 4.4 MB versus 354 KB gzip for the whole Phaser build.
- The rules now exist in two languages. The Node server (ADR 0003) must re-run replays with the same rules.

## Decision
- **Client:** Unity 6 (6000.x LTS or newer), C#, 2D pixel art, portrait. The project lives in `prototypes/unity` until it is promoted to `unity/` in M1.
  - The Phaser client (`packages/client`) stays as a reference and test harness only. No new features go into it.
- **Rules:** `packages/sim` (TypeScript) stays the source of truth. The server uses it to verify replays and referee PvP.
  - The Unity client runs a C# port (`Assets/Scripts/Sim`, an assembly with `noEngineReferences`).
  - Every rule change lands in both languages in the same PR.
- **Parity gate:**
  - `npm run sim:golden` writes golden replays from TypeScript.
  - `npm run sim:parity` runs the C# port on plain .NET against them. No Unity install or license is needed.
  - CI runs both. A mismatch blocks merge. The workflow template is `docs/ci/github-actions-ci.yml`; copy it to `.github/workflows/`.
  - Golden coverage must grow with every new rule: each new command, enemy trait or card gets a scripted golden.
- **Data:** `docs/data/*.json` stays the single source. `npm run unity:sync` copies it into `Assets/Resources/data`, and a test fails if the copy is stale.
- **Platforms (owner decision, 22 Oct, after docs/research/market-players.md):**
  - Develop and playtest on **PC first**: a Unity Windows standalone build.
  - Ship **cross-platform PC + mobile** from one Unity project, with Android Thailand as the first mobile market.
  - **Amended 23 Oct (owner approved, [pitch-decks §6–8](../research/pitch-decks.md)):** Android Thailand hosts the soft launch, but the **full launch ships Android and iOS together**. In Thai RPG data iOS is 18% of downloads with about 5x the ARPU, so it likely earns about half the revenue.
  - The web is no longer first. A WebGL build is optional, as a demo, a co-op invite link or a direct shop, and only if it meets the size budget (Poki < 8 MB first download).
- **Backend:** unchanged (Node.js 22, PostgreSQL 16, Redis 7, ADR 0003).

## Alternatives considered
- **Stay on Phaser:** smallest web build and one rules language, but the owner preferred Unity's results and workflow, and the mobile store path is weaker.
- **Rewrite the server in C# (.NET) to have one rules language:** this removes the parity risk but discards the Node backend design and the TypeScript sim and tests. It can be revisited if parity maintenance becomes the bottleneck. Moving the server sim to C# would then be the natural step.

## Consequences
- Every rules change costs about double: TypeScript plus C#.
  - Mitigated by the parity CI, and by keeping rules small and data-driven.
  - The C# port mirrors TS iteration order, JS `Math.round` and floor division, and uint32 RNG (see comments in `Core.cs`).
- The assault mode is not yet ported to C#. Port it before it ships in Unity.
- Artists work in Unity scenes and animators. The sprite pipeline (`docs/tools/blender.md`) already syncs into `Assets/Resources/sprites`.
- Unity Personal is free until its revenue threshold; budget for Unity Pro after that.
