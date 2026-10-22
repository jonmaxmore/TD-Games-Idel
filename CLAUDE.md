# ศึกห้าสำนัก (TD-Games-Idel)

Wuxia tower defense, pixel art, web first, then mobile (Capacitor). End goal is a full esports title; flagship competitive mode is attack/defend 1v1 (`docs/design/esports.md`). PvE/idle onboards and funds it. Design lives in `docs/`; read `docs/GDD.md` before any game work. Game data (`docs/data/*.json`) is the source of truth for numbers and names; code reads it, never hard-codes it.

Planned stack (GDD §10): TypeScript monorepo — `packages/sim` (deterministic rules, no rendering), `packages/client` (Vite + Phaser 3), `packages/server` (Cloudflare Workers + Durable Objects, D1/KV/R2).

## Skills and agents to use, by phase

Installed under `.claude/` (sources in `.claude/THIRD_PARTY.md`). Use them; don't hand-roll a process a skill already covers.

| Phase | Use |
|---|---|
| New feature / milestone | `/spec` (spec-driven-development) → `/plan` (planning-and-task-breakdown). Specs go in `docs/specs/`. |
| Unclear ask | `interview-me` or `idea-refine` before writing anything |
| Implementing | `/build` (incremental-implementation) + `/test` (test-driven-development). `ponytail` is always on via hooks: smallest change that works. |
| Large or parallel work | `poteto-mode`; delegate subtasks to `poteto-agent` |
| Framework/API decisions (Phaser, Wrangler, D1, Capacitor) | `source-driven-development`; Cloudflare docs via the `cloudflare-docs` MCP when reachable |
| UI / HUD / menus | `frontend-ui-engineering` |
| Before merge | `/review` + `code-reviewer` agent; `security-auditor` for server, accounts, IAP; `ponytail-review` for bloat |
| Performance (60fps mid-range phone) | `/webperf` + `web-performance-auditor`, `performance-optimization` |
| Release / deploy | `/ship` (shipping-and-launch), `ci-cd-and-automation` |
| Understanding the codebase | `graphify` once code exists (`/graphify .`); `cavecrew-investigator` for quick "where is X" |
| Analytics events | `product-tracking-skills:product-tracking-design-tracking-plan` → `product-tracking-skills:product-tracking-implement-tracking` (account plugin, not vendored) |
| Decisions worth keeping | `documentation-and-adrs` → `docs/adr/` |
| Reverse engineering a shipped game/artifact | `reverse-engineer-anything` (REA MCP). Never copy third-party code or assets (e.g. Flash Element TD); mechanics only. |

Do not use `caveman` for design docs or user-facing explanations; it is fine for terse subagent output.

## Rules

- `packages/sim` must stay deterministic: fixed 20Hz tick, seeded RNG, no `Math.random`, no `Date.now`, no iteration over unordered maps for game logic. Every change runs the double-run hash test. PvP, replays and anti-cheat depend on it.
- PvP ranked uses normalized stats. Nothing purchasable may change PvP power (`docs/design/economy.md`).
- Heroes (gacha) are sidegrades: balance sim win-rate within ±2% of the base disciple.
- Sect, character and technique names are original. No Jin Yong / Gu Long names.
- Design docs are written in Thai; code, identifiers and commit messages in English.
- Keep `docs/data/*.json` valid (`python3 -m json.tool`) and cross-references intact (stage enemies exist in `enemies.json`, sects in `sects.json`).

## Running (once code exists)

- Single player: `npm run dev` → http://localhost:5173
- Multiplayer locally: `npx wrangler dev` → http://localhost:8787, open several tabs
- Deploy: `npx wrangler deploy` (free tier during development)
