# Frozen reference code

`packages/sim` (TypeScript rules) and `packages/client` (Phaser 3) are frozen since ADR 0006 (C# everywhere).
The rules now live once, in C#: `prototypes/unity/Assets/Scripts/Sim` (`FiveSects.Sim`), tested by `tools/simtest` (`npm test`).

- Do not change or extend anything here. The data in `docs/data` keeps evolving, so these packages will drift from it.
- `npm run legacy:test` / `legacy:dev` still run them for reference.
- Still TS-only: the assault mode (`sim/src/assault.ts`). Port it to C# when assault stages are built in Unity, then delete this folder.
