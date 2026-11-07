# ศึกห้าสำนัก (TD-Games-Idel)

Wuxia castle battle (two castles on one path; summon disciples with mana, take forts, break the enemy castle in 3 minutes; mechanics of the 城とドラゴン genre, everything else original), **2.5D pixel art** (3/4 top-down board, upright pixel figures; no 3D), **PC only, 16:9** (mouse and keyboard; browser build, desktop wrapper later). No mobile build (ADR 0008). End goal is a full esports title; flagship competitive mode is the 1v1 castle battle (`docs/design/esports.md`). Tower defense is gone (ADR 0010); the rules are `docs/specs/SPEC-castle-battle.md`. Launch v1.0 + Season 1 as a mass-market game first; the esports program starts once the game is mass. Build the foundations (deterministic sim, replays, fair ranked) from day one. Design lives in `docs/`; read `docs/GDD.md` before any game work. Game data (`docs/data/*.json`) is the source of truth for numbers and names; code reads it, never hard-codes it.

Architecture: `docs/design/architecture.md` and ADR 0007 (TypeScript everywhere). **One language, one rules implementation:** the rules are `packages/sim` (TypeScript): deterministic, integer-only, no DOM. The client is `packages/client`: Vite, Canvas 2D for the pixel-art board (no WebGL, no 3D), plain DOM/CSS for the HUD, all laid out on a fixed 1280x720 stage scaled to the window. The backend (from M1) is Node 22 + Fastify + PostgreSQL 16 (Drizzle) + Redis 7 + BullMQ under `packages/` (`protocol`, `api`, `game`, `worker`, `db`) and uses the same `packages/sim`. No SQLite. The server never trusts client outcomes: it re-runs replays with `packages/sim`.

## Skills and agents to use, by phase

Installed under `.claude/` (sources in `.claude/THIRD_PARTY.md`). Use them; don't hand-roll a process a skill already covers.

| Phase | Use |
|---|---|
| New feature / milestone | `/spec` (spec-driven-development) → `/plan` (planning-and-task-breakdown). Specs go in `docs/specs/`. |
| Unclear ask | `interview-me` or `idea-refine` before writing anything |
| Implementing | `/build` (incremental-implementation) + `/test` (test-driven-development). `ponytail` is always on via hooks: smallest change that works. |
| Large or parallel work | `poteto-mode`; delegate subtasks to `poteto-agent` |
| Framework/API decisions (Vite, Canvas 2D, Fastify, Drizzle, BullMQ) | `source-driven-development` |
| UI / HUD / menus | `frontend-ui-engineering` |
| Before merge | `/review` + `code-reviewer` agent; `security-auditor` for server, accounts, IAP; `ponytail-review` for bloat |
| Performance (60fps on a mid-range PC) | `/webperf` + `web-performance-auditor`, `performance-optimization` |
| Release / deploy | `/ship` (shipping-and-launch), `ci-cd-and-automation` |
| Understanding the codebase | `graphify` once code exists (`/graphify .`); `cavecrew-investigator` for quick "where is X" |
| Analytics events | `product-tracking-skills:product-tracking-design-tracking-plan` → `product-tracking-skills:product-tracking-implement-tracking` (account plugin, not vendored) |
| Decisions worth keeping | `documentation-and-adrs` → `docs/adr/` |
| Art pipeline (PixelLab sprites, ADR 0009; Blender optional, Claude drives it via MCP) | `docs/tools/blender.md`, `npm run art:pixellab` (`-- --dry-run` quotes cost first), `npm run art:build`. Keep sprites inside `effects.json > render.palette`. |
| Game design / balance / economy review (docs/design, docs/data changes, new sect/hero/enemy/map/mode) | `game-design-review` skill + `game-designer`, `systems-designer`, `economy-designer`, `live-ops-designer` agents. Prove balance with the sim, else NOT ASSESSED. |
| Reverse engineering a shipped game/artifact | `reverse-engineer-anything` (REA MCP). Never copy third-party code or assets (e.g. Flash Element TD); mechanics only. |

Do not use `caveman` for design docs or user-facing explanations; it is fine for terse subagent output.

## Rules

- Rules exist once, in `packages/sim`. Every rule change comes with a test in `packages/sim/test` or a scripted golden (`packages/sim/test/goldens.ts`); run `npm test`, and `npm run sim:golden` when an outcome changes on purpose (the golden test fails until you do).
- `packages/sim` must stay deterministic: fixed 20Hz tick, seeded RNG, integers only, no `Math.random`, no clocks (`Date`, `performance`), no DOM or locale APIs, Maps and Sets for lookups only (the rules iterate arrays). `npm test` runs the double-run hash test and a ban scan. PvP, replays and anti-cheat depend on it.
- See it, don't just compile it: any client change ends with `npm run shots` (Chromium at 1280x720, bot play, screenshots + video in `shots/`, fails on console errors) and a look at the images.
- PvP ranked uses normalized stats. Nothing purchasable may change PvP power (`docs/design/economy.md`).
- Heroes (gacha) are sidegrades: balance sim win-rate within ±2% of the base disciple.
- Sect, character and technique names are original. No Jin Yong / Gu Long names.
- Design docs are written in Thai; code, identifiers and commit messages in English.
- Keep `docs/data/*.json` valid (`python3 -m json.tool`) and cross-references intact (every `roster.units` card has a `move` and `size` from `battle.json`, every unit sect is in `sects.json`).

## Running

- Game: `npm run dev` → http://localhost:5173 opens on the title (title → deck pick → battle → result). `?mode=battle&seed=2&deck=wood` jumps into a match (`deck` = `fire`, `wood`, `mixed` or a comma list of card ids); `&bot=1&speed=4` lets bots play both sides.
- Tests (castle battle rules, balance, golden, determinism, client data): `npm test`. One file: `npx vitest run packages/sim/test/battle.test.ts`.
- Visual proof: `npm run shots` → `shots/` (title, deck pick, a hand-played match, the bell cut-in, a recorded bot-vs-bot match, the result, fps at x4).
- Balance table: `npm run sim:battle` (`BATTLE_SEEDS=200`): rush vs defend bots on mirror decks, both side orders.
- Rewrite the battle golden (`packages/sim/goldens/battle-1.json`) after an intended outcome change: `npm run sim:golden`.
- Backend locally (from M1): `docker compose -f infra/docker-compose.yml up`, then `npm run dev:server`.
