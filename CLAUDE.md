# ศึกห้าสำนัก (TD-Games-Idel)

Wuxia tower defense, pixel art, web first, then mobile (Capacitor). End goal is a full esports title; flagship competitive mode is attack/defend 1v1 (`docs/design/esports.md`). Launch v1.0 + Season 1 as a mass-market game first; the esports program starts once the game is mass. Build the foundations (deterministic sim, replays, fair ranked) from day one. Design lives in `docs/`; read `docs/GDD.md` before any game work. Game data (`docs/data/*.json`) is the source of truth for numbers and names; code reads it, never hard-codes it.

Architecture: `docs/design/architecture.md` (ADR 0003) and ADR 0004: the client is **Unity 6** (`prototypes/unity`, C#; moves to `unity/` in M1). Planned stack (GDD §10): TypeScript monorepo — `packages/sim` (deterministic rules, source of truth, run by the server), `packages/client` (Vite + Phaser 3: reference/test harness only, no new features), `packages/protocol` (shared API types + zod), `packages/db` (PostgreSQL schema, Drizzle), `packages/api` (Fastify), `packages/game` (WebSocket rooms), `packages/worker` (BullMQ); Node.js 22, PostgreSQL 16, Redis 7. No SQLite. The server never trusts client outcomes: it re-runs replays with `sim`.

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
| Reverse engineering a shipped game/artifact | `reverse-engineer-anything` (REA MCP). Never copy third-party code or assets (e.g. Flash Element TD); mechanics only. |

Do not use `caveman` for design docs or user-facing explanations; it is fine for terse subagent output.

## Rules

- Rules exist twice: `packages/sim` (TS) and `prototypes/unity/Assets/Scripts/Sim` (C# port). Change both in the same PR, add a scripted golden for new rules (`packages/sim/scripts/golden.ts`), run `npm run sim:golden` then `npm run sim:parity` (plain .NET, no Unity needed). After data edits run `npm run unity:sync`.

- `packages/sim` must stay deterministic: fixed 20Hz tick, seeded RNG, no `Math.random`, no `Date.now`, no iteration over unordered maps for game logic. Every change runs the double-run hash test. PvP, replays and anti-cheat depend on it.
- PvP ranked uses normalized stats. Nothing purchasable may change PvP power (`docs/design/economy.md`).
- Heroes (gacha) are sidegrades: balance sim win-rate within ±2% of the base disciple.
- Sect, character and technique names are original. No Jin Yong / Gu Long names.
- Design docs are written in Thai; code, identifiers and commit messages in English.
- Keep `docs/data/*.json` valid (`python3 -m json.tool`) and cross-references intact (stage enemies exist in `enemies.json`, sects in `sects.json`).

## Running (once code exists)

- Single player: `npm run dev` → http://localhost:5173
- Backend locally (from M1): `docker compose -f infra/docker-compose.yml up` then `npm run dev:server`
- Smoke test: `npm run build && npm run smoke`
