# M0 tasks
- [x] Workspace scaffold (package.json, tsconfig, vitest config) — verify: `npm test`, `npm run typecheck`
- [x] sim: rng, data loader, wuxing — verify: unit tests
- [x] sim: state/step/commands/hash + determinism test
- [x] sim: defend stages 1-1, 1-2, 1-4, training ground; effects, combos, economy, stars — verify: rule tests + headless run
- [x] sim: assault 1-3 — verify: win/lose tests
- [x] sim:replay script — verify: same hash twice
- [x] client: scenes, sprites, FX, input, save — verify: manual play
- [x] Playwright smoke + 60fps check

## Follow-ups from code review (M1)
- [ ] Move FX / assault / outpost constants into structured data (docs/adr/0001-sim-tuning-constants.md)
- [ ] Panels re-evaluate affordability live; prevent double-tap before a pending place applies
- [ ] Emit events for fire death explosions so the client can show them
- [ ] Golden Bell as a real path blocker (data says blocks 3 enemies, immune 4s)
