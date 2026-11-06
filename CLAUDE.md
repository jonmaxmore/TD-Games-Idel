# ศึกห้าสำนัก (TD-Games-Idel)

Wuxia tower defense, pixel art, web first, then mobile (Capacitor). End goal is a full esports title; flagship competitive mode is attack/defend 1v1 (`docs/design/esports.md`). Launch v1.0 + Season 1 as a mass-market game first; the esports program starts once the game is mass. Build the foundations (deterministic sim, replays, fair ranked) from day one. Design lives in `docs/`; read `docs/GDD.md` before any game work. Game data (`docs/data/*.json`) is the source of truth for numbers and names; code reads it, never hard-codes it.

Architecture: `docs/design/architecture.md` and ADR 0007 (TypeScript everywhere). **One language, one rules implementation:** the rules are `packages/sim` (TypeScript): deterministic, integer-only, no DOM. The client is `packages/client`: Vite + three.js for the board, plain DOM/CSS for the HUD; mobile via Capacitor. The backend (from M1) is Node 22 + Fastify + PostgreSQL 16 (Drizzle) + Redis 7 + BullMQ under `packages/` (`protocol`, `api`, `game`, `worker`, `db`) and uses the same `packages/sim`. No SQLite. The server never trusts client outcomes: it re-runs replays with `packages/sim`.

## Skills and agents to use, by phase

Installed under `.claude/` (sources in `.claude/THIRD_PARTY.md`). Use them; don't hand-roll a process a skill already covers.

| Phase | Use |
|---|---|
| New feature / milestone | `/spec` (spec-driven-development) → `/plan` (planning-and-task-breakdown). Specs go in `docs/specs/`. |
| Unclear ask | `interview-me` or `idea-refine` before writing anything |
| Implementing | `/build` (incremental-implementation) + `/test` (test-driven-development). `ponytail` is always on via hooks: smallest change that works. |
| Large or parallel work | `poteto-mode`; delegate subtasks to `poteto-agent` |
| Framework/API decisions (three.js, Vite, Capacitor, Fastify, Drizzle, BullMQ) | `source-driven-development` |
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

- Rules exist once, in `packages/sim`. Every rule change comes with a test in `packages/sim/test` or a scripted golden (`packages/sim/test/goldens.ts`); run `npm test`, and `npm run sim:golden` when an outcome changes on purpose (the golden test fails until you do).
- `packages/sim` must stay deterministic: fixed 20Hz tick, seeded RNG, integers only, no `Math.random`, no clocks (`Date`, `performance`), no DOM or locale APIs, Maps and Sets for lookups only (the rules iterate arrays). `npm test` runs the double-run hash test and a ban scan. PvP, replays and anti-cheat depend on it.
- See it, don't just compile it: any client change ends with `npm run shots` (Chromium at phone size, bot play, screenshots + video in `shots/`, fails on console errors) and a look at the images.
- PvP ranked uses normalized stats. Nothing purchasable may change PvP power (`docs/design/economy.md`).
- Heroes (gacha) are sidegrades: balance sim win-rate within ±2% of the base disciple.
- Sect, character and technique names are original. No Jin Yong / Gu Long names.
- Design docs are written in Thai; code, identifiers and commit messages in English.
- Keep `docs/data/*.json` valid (`python3 -m json.tool`) and cross-references intact (stage enemies exist in `enemies.json`, sects in `sects.json`).

## Running

- Game: `npm run dev` → http://localhost:5173 (`?stage=1-12&sect=wood&seed=2`, `&bot=1&speed=4` lets the bot play).
- Tests (rules, balance, goldens, data): `npm test`. One file: `npx vitest run packages/sim/test/sects.test.ts`.
- Visual proof: `npm run shots` → `shots/`.
- Balance table: `npm run sim:measure` (`MEASURE_SEEDS=24 MEASURE_STAGES=1-12`).
- Rewrite goldens after an intended outcome change: `npm run sim:golden`.
- Backend locally (from M1): `docker compose -f infra/docker-compose.yml up`, then `npm run dev:server`.
