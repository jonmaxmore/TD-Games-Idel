// Golden replays for engine ports (Unity C#). Written to disk by write-golden.ts (npm run sim:golden).
// Each file: { stageId, seed, commands: {tick: Command[]}, trace: [[tick, hash] every 100 ticks], final }
import { canonicalHash, canonicalString } from '../src/canonical';
import { ARTS, createGame, isOver, runReplay, step, TARGET_MODES, type Command, type DefendState, type Element } from '../src/index';
import { playBot } from '../test/bot';

export function golden(stageId: string, seed: number, opts: { earlyCall?: boolean; sect?: Element } = {}) {
  const commands: Record<number, Command[]> = {};
  const sect = opts.sect;
  playBot(createGame(stageId, seed, sect ?? null) as DefendState, { record: commands, maxDisciples: opts.earlyCall ? 8 : undefined, earlyCall: opts.earlyCall });
  const trace: [number, string][] = [];
  const end = runReplay({ stageId, seed, sect, commands }, 20 * 60 * 30, (s) => {
    if (s.tick % 100 === 0) trace.push([s.tick, canonicalHash(s as DefendState)]);
  }) as DefendState;
  return {
    stageId, seed, ...(sect ? { sect } : {}), commands, trace,
    final: { phase: end.phase, wave: end.wave, lives: end.lives, silver: end.silver, tick: end.tick, hash: canonicalHash(end), canonical: canonicalString(end) },
  };
}


// Scripted run that exercises the commands the bot never uses: merge, every secret art, every target
// mode, sell and manual card picks. Commands are recorded the same way as golden().
export function goldenActions(seed = 11) {
  const stageId = 'T-1';
  const s = createGame(stageId, seed) as DefendState;
  const commands: Record<number, Command[]> = {};
  const script: Record<number, Command[]> = {
    0: [
      { t: 'place', sect: 'metal', tx: 3, ty: 3 }, { t: 'place', sect: 'water', tx: 4, ty: 3 },
      { t: 'place', sect: 'fire', tx: 5, ty: 3 }, { t: 'place', sect: 'earth', tx: 3, ty: 6 }, { t: 'nextWave' },
    ],
    1: [{ t: 'upgrade', id: 1 }, { t: 'upgrade', id: 2 }],
    2: [{ t: 'upgrade', id: 1 }, { t: 'upgrade', id: 2 }],
    3: [{ t: 'merge', a: 1, b: 2 }],
    4: [{ t: 'place', sect: 'wood', tx: 6, ty: 3 }, { t: 'place', sect: 'yinyang', tx: 7, ty: 3 }],
  };
  TARGET_MODES.forEach((mode, i) => { script[10 + i] = [{ t: 'target', id: 3, mode }]; });
  ARTS.forEach((a, i) => { script[300 + i * 250] = [{ t: 'cast', art: a.id }]; });
  script[1500] = [{ t: 'sell', id: 4 }];
  let picks = 0;
  while (!isOver(s) && s.tick < 20 * 60 * 30) {
    const cmds = [...(script[s.tick] ?? [])];
    if (s.phase === 'picking' && s.offer && picks < 2) { cmds.push({ t: 'pick', card: s.offer[s.offer.length - 1]! }); picks++; }
    if (s.phase === 'break' && s.wave % 3 === 0) cmds.push({ t: 'nextWave' });
    if (cmds.length) commands[s.tick] = cmds;
    step(s, cmds);
  }
  return traceOf(stageId, seed, commands);
}

function traceOf(stageId: string, seed: number, commands: Record<number, Command[]>) {
  const trace: [number, string][] = [];
  const end = runReplay({ stageId, seed, commands }, 20 * 60 * 30, (st) => {
    if (st.tick % 100 === 0) trace.push([st.tick, canonicalHash(st as DefendState)]);
  }) as DefendState;
  return {
    stageId, seed, commands, trace,
    final: { phase: end.phase, wave: end.wave, lives: end.lives, silver: end.silver, tick: end.tick, hash: canonicalHash(end), canonical: canonicalString(end) },
  };
}

export const GOLDENS = {
  '1-1': () => golden('1-1', 42),
  'T-1': () => golden('T-1', 7),
  'T-1-actions': () => goldenActions(11),
  // Chapter finale: overlapping waves called mid-fight, both boss waves (disable at 10, seal at 20), wave recipes.
  '1-12-bosses': () => golden('1-12', 2, { earlyCall: true }),
  // Sect games: fire-sect roster with the burn ramp, wood-sect roster with poison spread (SPEC-core §4).
  'fire-1-12': () => golden('1-12', 3, { earlyCall: true, sect: 'fire' }),
  'wood-1-12': () => golden('1-12', 3, { earlyCall: true, sect: 'wood' }),
} as const;
