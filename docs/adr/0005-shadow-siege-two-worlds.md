# ADR 0005: Core direction "Shadow Siege" with idle PvE, and two power worlds

- Status: accepted
- Date: 2026-10-23
- Evidence: [docs/research/idle-hybrid.md](../research/idle-hybrid.md), [docs/design/economy.md](../design/economy.md) (หลักสองโลก), [docs/design/sect-allegiance.md](../design/sect-allegiance.md)

## Context
After playing the prototype, the owner judged the game "too fixed": runs got boring. The owner asked for:
- More of an idle feel, in the vein of AFK Journey, MapleStory: Idle RPG and Legend of Mushroom: Rush.
- A TD/RTS flavour that is clearly newer than the market.

Research found:
- Pure idle TD (The Tower, Galaxy Defense) is saturated at mid-tier revenue.
- Idle RPGs that sell power earn the most. MapleStory: Idle RPG made over $100M in 45 days.
- No 2024–26 title found mixes idle TD with async attack and defence against other players' layouts.

## Decision
- **Core loop (direction B, "ศึกเงาห้าสำนัก"):**
  - Each player's defence layout defends while they are offline.
  - Players plan async attacks on other players' layouts: which attackers to send, in which waves and with which timed ultimates.
  - The server runs every fight with `packages/sim` and keeps the replay.
  - An idle PvE layer (direction A, ค่ายกล idle) is the onboarding path and the daily progression.
- **Sects:**
  - The player picks a sect after the tutorial. All sects share 5 roles but play differently.
  - 5 sects at launch, a 6th in month 2, a 7th in month 4.
  - Changing sect needs a sold token, also given by some events.
- **Two power worlds:**
  - **PvE power:** levels, stars, enhancement, items, heroes and guild tech. It is sold to the fullest.
  - **Every PvP mode** (ranked, async raids, guild war, tournaments) uses normalized stats.
  - Heroes are PvP sidegrades within ±2% win-rate.
  - PvE revenue funds the esports program.

## Consequences
- **Async raids:** they used to scale with league. They now normalize fully; otherwise money buys PvP power indirectly.
- **Sim:** must express attacker units and attack plans as commands, so the server can verify every raid. Golden replays will be needed for both sides.
- **Design docs to write:**
  - Roster with visible evolution at every tier: `roster.md`.
  - PvE economy: `pve-economy.md`.
  - Live ops and guild: `liveops.md`.
  - Progression: `progression.md`.
- **Risks:**
  - Idle players may dislike being raided. Losing a defence must cost little.
  - A single best layout may get copied by everyone. Counter with weekly map rotation and sect bans.
  - Server cost of re-running every raid must be measured.
