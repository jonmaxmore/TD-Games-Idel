# Third-party skills, agents and hooks

Vendored into this project's `.claude/` so every session (local or cloud) gets them.

| Source | Commit | License | What was copied |
|---|---|---|---|
| [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | aeac41d | MIT | `skills/*` (25), `agents/*.md` (4), `.claude/commands/*.md` (9). Hooks not installed. |
| [cursor/plugins](https://github.com/cursor/plugins) → `pstack` (poteto / Lauren Tan) | eb4db2b | MIT | `pstack/skills/*` (incl. `poteto-mode`), `agents/poteto-agent.md`, `agents/comment-sicko.md` |
| [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | bad48a0 | see upstream `LICENSING.md` | `plugins/caveman/skills/*`, `plugins/caveman/agents/*`. Hooks not installed: run `/caveman` to turn it on. |
| [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | 09c434a | MIT | `skills/*` (6), `hooks/ponytail-*.js` → `.claude/hooks/`, wired in `settings.json` (SessionStart, SubagentStart, UserPromptSubmit). Needs `node`. |
| [safishamsi/graphify](https://github.com/safishamsi/graphify) | 847a93f (CLI `graphifyy` 0.9.93) | MIT | `skills/graphify` (from `graphify install --platform claude`). The CLI is installed by a SessionStart hook if missing (`uv tool install graphifyy`). |
| [morluto/rea](https://github.com/morluto/rea) | 2c3dd94 | MIT | `.agents/skills/reverse-engineer-anything` (skill only). The REA MCP server is not registered: see the skill's setup steps (`npx -y rea-agents@latest setup --client claude_code`). |

To update one, re-copy from the upstream repo and bump the commit here.
