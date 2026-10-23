---
name: game-design-review
description: Review a design change in this repo (docs/GDD.md, docs/design/*.md, docs/art/*.md, docs/data/*.json, docs/specs/*) for fun, decisions, balance, economy, competitive integrity and F2P fairness, grounded in the deterministic sim. Use when asked to review a design doc or data change, check balance or economy numbers, evaluate a new sect/hero/enemy/map/mode/event, or before merging any change under docs/design or docs/data.
---

# Game design review (ศึกห้าสำนัก)

Skill text is English. Quote Thai doc text verbatim, never translate names, and answer in the language of the request. Design agents that pair with this skill: `game-designer`, `systems-designer`, `economy-designer`, `live-ops-designer` (`.claude/agents/`).

## 0. Load
- `CLAUDE.md` rules, `docs/GDD.md` §1 (positioning, pillars) and §5 (core loop), the target doc or diff, and every `docs/data/*.json` it names. ADRs touching the area (`docs/adr/`).
- Rules as built: `prototypes/unity/Assets/Scripts/Sim/*.cs` (`FiveSects.Sim`, the single source of truth, ADR 0006).
- Mode:
  - **focused**: one doc or one data diff.
  - **holistic**: the whole design or several docs. Also read `references/holism.md` and `references/scenarios.md`.

## 1. Hard gates (any failure = BLOCKING; give evidence for each)
| Gate | Source of truth |
|---|---|
| Expressible in fixed 20 Hz ticks, seeded RNG, integer milli-tile units; no wall clock, no unordered-map iteration | `CLAUDE.md`, `FiveSects.Sim` |
| Numbers live in `docs/data/*.json`; prose cites keys and never restates a different number; JSON valid; cross-refs intact | `CLAUDE.md` |
| Ranked PvP uses normalized stats; nothing purchasable changes PvP power | `docs/design/economy.md`, `docs/design/modes.md` |
| Hero is a sidegrade: `heroWinRate - baseWinRate` within ±0.02 | `heroes.json > powerBudgetRule` |
| "ไม่มีสำนักใดชนะเกิน 53% ในลีกสูง"; PvP map side gap "ไม่เกิน 1%" | `docs/design/esports.md`, `docs/design/maps.md` |
| Gacha: shown odds = implemented odds; pity and spark as in data; disabled regions respected | `economy.json > gacha` |
| Rules change lands in C# with a test or golden (`npm test`, `npm run sim:golden`) | ADR 0006 |
| Original names (no Jin Yong / Gu Long) | `CLAUDE.md` |

## 2. Lenses (ask each; skip the ones the change cannot touch)
- **A. Experience.**
  - MDA, aesthetics first.
  - Schell's essential experience and elemental tetrad.
  - Quantic Foundry fit per mode: Strategy/Challenge for stages, Completion/Power for idle and the sect base, Competition for ranked, Community for co-op.
- **B. Decisions.**
  - Sid Meier's interesting decisions: trade-off, situational, informed, persistent, expressive.
  - Burgun: decisions should be ambiguous and not solvable.
  - **Warping test:** remove the suspect option. If the remaining decisions get more interesting, it warps.
  - Count real decisions per phase: build, mid-wave, between waves. Flag dead time and dominant strategies.
- **C. Balance.**
  - Cost curves (Schreiber & Romero): silver cost vs power for disciples, upgrades and combos.
  - Treat wuxing generates/overcomes (`sects.json > wuxing`) as a payoff matrix. With costs applied, no element may dominate.
  - Attack/defend asymmetry: both roles' win rates per map.
- **D. Economy (in-run and meta).**
  - Machinations vocabulary: sources, drains, pools, converters, gates.
  - Interest is positive feedback. Check its brake (`economy.json > inRun.interestCap`).
  - One source/sink row per currency. Each needs a distinct job; prefer spending existing currencies over adding one.
  - Pacing: income × actions per session / cost = sessions to the next milestone.
- **E. F2P and live ops.**
  - Expected acquisition with pity (see §4).
  - The free battle-pass track must be meaningful. Story must be completable free.
  - Minors' spend cap (`economy.json > minorSpendCapTHBPerMonth`).
  - Reject coercive patterns: obfuscated currency math, purchase prompts at frustration points, paying to skip a designed wall.
- **F. Competitive / esports.**
  - Sirlin: solid under expert play, many viable options, bounded snowball instead of explicit comeback mechanics.
  - Jaffe's cursed problems: skill inflation, kingmaking.
  - Randomness in ranked: prefer input randomness (wave preview, map pick). Output randomness must be seeded, symmetric for both sides and streak-bounded (pseudo-random distribution).
  - Spectator readability: clear sides, telegraphs, a cap on simultaneous VFX.
- **G. Pacing and maps (TD).**
  - Wave interest curve: spike, breather, spike.
  - Enemy HP growth (`enemies.json`, `GameData.WaveHp` in `Assets/Scripts/Sim/GameData.cs`) vs income growth.
  - Lane-hold check: covering DPS × time in range ≥ HP.
  - Telegraph special enemies one wave ahead.
  - Map rules in `docs/art/map-design.md` §1.
  - FTUE: one wuxing relation taught per stage (Dan Cook's skill atoms).
- **H. Holism (holistic mode).** `references/holism.md` covers:
  - competing progression loops
  - the attention budget (3–4 active systems)
  - economic loops
  - curve consistency
  - pillar and fantasy alignment

  `references/scenarios.md` covers multi-system walkthroughs.

## 3. Evidence from the sim
- **Tools:** the headless C# rules with `tools/simtest/Bot.cs` (`Bot.Play`). Add a measurement as a `[Test]` in `tools/simtest` or a scratch console project outside the repo that compiles `Assets/Scripts/Sim/*.cs`.
- **Bot policies:** the greedy bot's meta is not the human meta. Use at least two policies (greedy, eco/interest, rush) and name which one produced each number.
- **Single rate at 95%:** N ≥ 1.96² · p(1−p) / δ². ±2% needs about 2,400 games.
- **Difference of two rates on independent games:** about 4,800 per arm.
  - Run both arms on identical seeds, maps and opponents. The sim is deterministic, so these are common random numbers and variance drops.
  - Treat ±2% as an equivalence test: it passes only if the 95% CI of the difference lies inside ±2%.
- **Map side gap ≤ 1%:** the gap is |2w − 1|, so w must be within 50% ± 0.5%. That needs about 38,000 independent games. Use mirror-paired games (same seed, sides swapped) and count discordant pairs. The doc's "หลายพันเกม" is too few for its own threshold.
- **Human data (post-launch):** segment by league/MMR; watch for survivorship and super-user skew.
- **No evidence:** if the sim cannot express the change yet, the verdict is **NOT ASSESSED**, never "balanced".

## 4. Worked example (economy.json gacha)
p = 1.5% legendary, hard pity at pull 60 (`gacha.pity.legendaryAt`).
- E[pulls] = (1 − 0.985^60) / 0.015 ≈ 39.7, so the effective rate is ≈ 2.5%.
- P(no legendary in pulls 1–59) = 0.985^59 ≈ 41%: about 41% of legendaries arrive on the pity pull itself.
- Cost ≈ 39.7 × 135–150 jade ≈ 5,400–6,000 jade, about 4 weeks of the stated free jade (~1,500/week, `docs/design/economy.md`).
- Spark at 120 pulls ≈ 16,200 jade at the ten-pull price, about 11 weeks.

Ask whether that is the intended F2P cadence, and whether the store should show the effective rate.

## 5. Output format
```
## Design review: <doc or diff>
Verdict: APPROVED | NEEDS REVISION | BLOCKED | NOT ASSESSED
Gates: table (gate · pass/fail/not assessed · evidence: file:line or JSON key)
Findings: [BLOCKING|RECOMMENDED|NIT] <lens>: finding · number and how it was computed · fix (as a JSON key change where possible)
Highest-leverage changes: 1–2
Open questions for the user (decisions only the user makes)
```
Label every claim as evidence (file:line, JSON key, sim run with seeds/N/policy) or opinion.

## 6. Gotchas (this repo)
- No dynamic difficulty or rubber-banding in ranked or async raids: it breaks fairness and replay verification. In PvE it must be deterministic and disclosed.
- Never fudge displayed odds.
- Never conclude balance from one bot policy, or from fewer games than §3 allows.
- Don't add a currency to add depth; check each existing currency's job first.
- A shared data change hits PvE, PvP and the Unity client. Run `npm run unity:sync`, `npm test` and, if outcomes changed on purpose, `npm run sim:golden`.
- Numbers belong in JSON; review fixes cite keys, not prose numbers.

## Sources (summarised in our own words)
- Hunicke, LeBlanc & Zubek, "MDA" (2004)
- Schell, *The Art of Game Design* (3rd ed., 2019)
- Sid Meier, "Interesting Decisions" (GDC 2012)
- Adams & Dormans, *Game Mechanics: Advanced Game Design* (2012)
- Quantic Foundry, Gamer Motivation Model
- Schreiber & Romero, *Game Balance* (2021)
- Sirlin, *Playing to Win* (2006) and "Balancing Multiplayer Competitive Games" (GDC 2009)
- Burgun, *Game Design Theory* (2012)
- Jaffe, "Cursed Problems in Game Design" (GDC 2019)
- Giovannetti, "Slay the Spire: Metrics Driven Design and Balance" (GDC 2019)
- Cook, "The Chemistry of Game Design" (2007)
- Hodent, *The Gamer's Brain* (2017)
