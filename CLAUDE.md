# ศึกห้าสำนัก (TD-Games-Idel)

Wuxia tower defense, pixel art, web first, then mobile (Capacitor). End goal is a full esports title; flagship competitive mode is attack/defend 1v1 (`docs/design/esports.md`). Launch v1.0 + Season 1 as a mass-market game first; the esports program starts once the game is mass. Build the foundations (deterministic sim, replays, fair ranked) from day one. Design lives in `docs/`; read `docs/GDD.md` before any game work. Game data (`docs/data/*.json`) is the source of truth for numbers and names; code reads it, never hard-codes it.

Architecture: `docs/design/architecture.md` and ADR 0006 (C# everywhere) + ADR 0004 (Unity client). **One language, one rules implementation:** the rules are the C# library `FiveSects.Sim` in `prototypes/unity/Assets/Scripts/Sim` (moves to `unity/` in M1): deterministic, integer-only, no UnityEngine references. The client is **Unity 6** (iOS/Android; WebGL if a web build is needed). The server (from M1) is ASP.NET Core on the current .NET LTS under `server/` (`FiveSects.Api` REST, `FiveSects.Game` WebSocket rooms, `FiveSects.Worker` jobs, `FiveSects.Db` EF Core/Npgsql, `FiveSects.Protocol` shared types) and references the same `FiveSects.Sim`; PostgreSQL 16, Redis 7. No SQLite. The server never trusts client outcomes: it re-runs replays with `FiveSects.Sim`. `packages/sim` (TypeScript) and `packages/client` (Phaser) are **frozen reference code**: do not change or extend them.

## Skills and agents to use, by phase

Installed under `.claude/` (sources in `.claude/THIRD_PARTY.md`). Use them; don't hand-roll a process a skill already covers.

| Phase | Use |
|---|---|
| New feature / milestone | `/spec` (spec-driven-development) → `/plan` (planning-and-task-breakdown). Specs go in `docs/specs/`. |
| Unclear ask | `interview-me` or `idea-refine` before writing anything |
| Implementing | `/build` (incremental-implementation) + `/test` (test-driven-development). `ponytail` is always on via hooks: smallest change that works. |
| Large or parallel work | `poteto-mode`; delegate subtasks to `poteto-agent` |
| Framework/API decisions (Unity, Fastify, Drizzle, BullMQ) | `source-driven-development` |
| UI / HUD / menus | `frontend-ui-engineering` |
| Before merge | `/review` + `code-reviewer` agent; `security-auditor` for server, accounts, IAP; `ponytail-review` for bloat |
| Performance (60fps mid-range phone) | `/webperf` + `web-performance-auditor`, `performance-optimization` |
| Release / deploy | `/ship` (shipping-and-launch), `ci-cd-and-automation` |
| Understanding the codebase | `graphify` once code exists (`/graphify .`); `cavecrew-investigator` for quick "where is X" |
| Analytics events | `product-tracking-skills:product-tracking-design-tracking-plan` → `product-tracking-skills:product-tracking-implement-tracking` (account plugin, not vendored) |
| Decisions worth keeping | `documentation-and-adrs` → `docs/adr/` |
| Art pipeline (Blender → pixel sprites; Claude drives Blender via MCP) | `docs/tools/blender.md`, `npm run art:build`. Keep sprites inside `effects.json > render.palette`. |
| Game design / balance / economy review (docs/design, docs/data changes, new sect/hero/enemy/map/mode) | `game-design-review` skill + `game-designer`, `systems-designer`, `economy-designer`, `live-ops-designer` agents. Prove balance with the sim, else NOT ASSESSED. |
| TD genre checks (waves, targeting, DPS vs HP vs income) | `tower-defense` |
| Reverse engineering a shipped game/artifact | `reverse-engineer-anything` (REA MCP). Never copy third-party code or assets (e.g. Flash Element TD); mechanics only. |

Do not use `caveman` for design docs or user-facing explanations; it is fine for terse subagent output.

## Rules

- Rules exist once, in C# (`prototypes/unity/Assets/Scripts/Sim`). Every rule change comes with a test in `tools/simtest` or a scripted golden (`tools/simtest/Goldens.cs`); run `npm test`, and `npm run sim:golden` when an outcome changes on purpose (the golden test fails until you do). After data edits run `npm run unity:sync`. Offline (no NuGet): `NEWTONSOFT_DLL=/usr/lib/cli/Newtonsoft.Json-5.0/Newtonsoft.Json.dll`.

- `FiveSects.Sim` must stay deterministic: fixed 20Hz tick, seeded RNG, no `System.Random`, no clocks (`DateTime`, `Stopwatch`), no `float`, no `GetHashCode`, no iteration over unordered collections (`Dictionary`/`HashSet`) for game logic. `npm test` runs the double-run hash test and a ban scan. PvP, replays and anti-cheat depend on it; ranked must also pass the goldens on an IL2CPP device build.
- PvP ranked uses normalized stats. Nothing purchasable may change PvP power (`docs/design/economy.md`).
- Heroes (gacha) are sidegrades: balance sim win-rate within ±2% of the base disciple.
- Sect, character and technique names are original. No Jin Yong / Gu Long names.
- Design docs are written in Thai; code, identifiers and commit messages in English.
- Keep `docs/data/*.json` valid (`python3 -m json.tool`) and cross-references intact (stage enemies exist in `enemies.json`, sects in `sects.json`).

## Running

- Game: open `prototypes/unity` in Unity 6000.6 (Game view portrait 1080x1920), play `Assets/Scenes/Main`.
- Rules tests + balance + goldens: `npm test` (plain .NET 8, no Unity). One area: `npm test -- balance`.
- Rewrite goldens after an intended outcome change: `npm run sim:golden`.
- Backend locally (from M1): `docker compose -f infra/docker-compose.yml up`, then `dotnet run` per service in `server/`.
- Frozen TypeScript reference (not maintained, may drift from data): `npm run legacy:test`, `npm run legacy:dev`.
