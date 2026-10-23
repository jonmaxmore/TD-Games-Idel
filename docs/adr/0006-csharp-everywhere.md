# ADR 0006: C# everywhere: one rules library for the Unity client and a .NET server (supersedes ADR 0003)

- Status: accepted
- Date: 2026-10-23
- Supersedes: [ADR 0003](0003-node-postgres-backend.md) (Node.js + TypeScript backend); amends [ADR 0004](0004-unity-client.md) (the C# rules are no longer a port)
- Details: [docs/design/architecture.md](../design/architecture.md)

## Context
ADR 0003 chose Node.js because the authoritative rules were TypeScript (`packages/sim`). ADR 0004 then made Unity 6 the client, so the rules were ported to C# (`prototypes/unity/Assets/Scripts/Sim`). The result has been two implementations of every rule:
- Each rule change is written twice.
- The two copies are kept equal by golden replays and a parity run.

The owner asked for one clear direction: "Unity only, or C# all the way".

Facts at the time of the decision:
- **The C# rules already stand alone.** They have no `UnityEngine` reference (`noEngineReferences`), use integers only, and run on plain .NET 8. The parity tool runs them without Unity.
- **No server code exists yet.** M1 has not started, so changing the backend language throws nothing away.
- **The C# port is already exact.** A C# bot and golden writer were ported line by line. They reproduce all six committed golden replays byte for byte, and 53 C# tests cover the rules. The TS suite had 89 tests: the three assault tests and the TS-only type checks were not ported.
- **The next polish pass changes rules.** It touches about ten rules (Wu Xing values, cards, healer, interest, roster kits). With two implementations, every one of those changes would be done twice.

## Decision
- **Rules:** `FiveSects.Sim` (C#, `prototypes/unity/Assets/Scripts/Sim`, moving to `unity/` in M1) is the single source of truth. It must stay engine-free and integer-only:
  - No clocks.
  - No system randomness.
  - No single-precision floats.
  - No iteration over unordered collections for game logic.
- **Tests:** `tools/simtest` is a dependency-free .NET console runner. It covers the rule tests, balance gates (B1–B7, S1/S2), the determinism double run, an API ban scan, golden up-to-date and replay checks, and data sync.
  - `npm test` runs it.
  - `npm run sim:golden` rewrites the goldens from the C# rules.
  - The Unity Test Runner keeps `Assets/Editor/Tests/ParityTests.cs` as an in-editor replay check.
- **Client:** Unity 6 for iOS and Android. If a web build is wanted later, use Unity WebGL.
- **Server (M1):** ASP.NET Core on the current .NET LTS. It references the same rules library and re-runs every replay; the client still only sends a seed and commands.
  - `api` is REST.
  - `game` is WebSocket rooms (ASP.NET Core WebSockets, or SignalR if it fits the lockstep protocol).
  - `worker` uses hosted services or Hangfire for replay verification, mail and push, analytics, and season rollover.
- **Data:** PostgreSQL 16 (Npgsql, EF Core or Dapper, migrations in CI) and Redis 7, as in ADR 0003. Wallet rules are unchanged: row locks, an append-only ledger, idempotency keys, and each IAP is granted once.
- **Frozen:**
  - `packages/sim` (TypeScript rules) and `packages/client` (Phaser) are kept read-only for reference. Their scripts are renamed `legacy:*` and are no longer run, so they will drift from the data.
  - Delete them once nothing references them.
  - The assault mode exists only in `packages/sim/src/assault.ts`. It is ported to C# when assault stages are built in Unity.
- **Tooling that stays in Node:** repository tools that never ship in the game or server: `unity:sync`, `economy:check`, `progression:check`, the art pipeline. They read `docs/data` and may move to C# later if useful.

## Why not keep TypeScript on the server
- **Duplication:** it keeps two rule implementations that must match tick for tick, which is the cost this ADR removes.
- **Different code on each side:** the server would verify replays with different code from the code players run. Parity tests catch divergence only for the cases the goldens cover.

## Consequences
- **Rule changes:** every rule change is written once, in C#, and comes with a golden or a test in `tools/simtest`. The parity step is gone.
- **Determinism risk moves** from "TS vs C#" to "Mono/IL2CPP on ARM vs CoreCLR on x64". The rules use integer arithmetic plus IEEE-754 double in the RNG and in `FloorDiv`; basic double operations are deterministic across these platforms.
  - The ban scan in `tools/simtest` fails the build if `float`, clocks, `System.Random`, `GetHashCode` or engine calls enter the rules.
  - Before ranked launch, run the golden suite on an IL2CPP Android build and compare.
- **Hiring and tooling:** one language across client, rules and server.
- **Unity 6 language level:** the rules library targets C# 9 and netstandard2.1-compatible APIs so Unity compiles it unchanged.
- **Unit-test framework:** NuGet is unreachable from the build sandbox, so tests use a small in-repo runner instead of xUnit/NUnit. CI with NuGet access may switch to xUnit; the test code is plain static methods.
