// Golden replays: a seed plus the commands a player sent, with the canonical hash every 100 ticks and the final
// state. A rule change that alters an outcome shows up as a hash mismatch until the goldens are rewritten on
// purpose (npm run sim:golden). The server verifies a submitted run exactly like replay() below.
// File layout: { stageId, seed, sect?, commands: {tick: Command[]}, trace: [[tick, hash]], final }
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { arts, canonicalHash, canonicalString, createDefend, isOver, stepDefend, type Command, type DefendState } from '../src';
import { playStage } from './bot';

export const GOLDEN_DIR = fileURLToPath(new URL('../goldens/', import.meta.url));
export const TARGET_MODES = ['first', 'strong', 'weak', 'close'];
const MAX_TICKS = 20 * 60 * 30;

type Commands = Record<number, Command[]>;
export interface Golden {
  stageId: string; seed: number; sect?: string; commands: Commands; trace: [number, string][];
  final: { phase: string; wave: number; lives: number; silver: number; tick: number; hash: string; canonical: string };
}

export const ALL: Record<string, () => Golden> = {
  '1-1': () => golden('1-1', 42),
  'T-1': () => golden('T-1', 7),
  'T-1-actions': () => actions(11),
  // Chapter finale won by the fire sect: both boss waves (disable at 10, seal at 20), healers, stealth, wave recipes.
  '1-12-bosses': () => golden('1-12', 1, false, 'fire'),
  // Sect games with waves called mid-fight: fire roster (burn ramp, striker burn, phoenix), wood roster (poison
  // spread, poison through armour). Seeds chosen so both reach and win wave 20 (SPEC-core §4).
  'fire-1-12': () => golden('1-12', 2, true, 'fire'),
  'wood-1-12': () => golden('1-12', 2, true, 'wood'),
};

export function golden(stageId: string, seed: number, earlyCall = false, sect: string | null = null): Golden {
  const commands: Commands = {};
  playStage(stageId, seed, sect, { record: commands, earlyCall });
  return trace(stageId, seed, sect, commands);
}

const place = (sect: string, tx: number, ty: number): Command => ({ t: 'place', sect, tx, ty });

// Scripted run that exercises the commands the bot never uses: merge, every secret art, every target mode,
// sell and manual card picks.
export function actions(seed: number): Golden {
  const stageId = 'T-1';
  const s = createDefend(stageId, seed);
  const commands: Commands = {};
  const script: Commands = {
    0: [place('metal', 3, 3), place('water', 4, 3), place('fire', 5, 3), place('earth', 3, 6), { t: 'nextWave' }],
    1: [{ t: 'upgrade', id: 1 }, { t: 'upgrade', id: 2 }],
    2: [{ t: 'upgrade', id: 1 }, { t: 'upgrade', id: 2 }],
    3: [{ t: 'merge', a: 1, b: 2 }],
    4: [place('wood', 6, 3), place('yinyang', 7, 3)],
  };
  TARGET_MODES.forEach((mode, i) => (script[10 + i] = [{ t: 'target', id: 3, mode }]));
  arts.forEach((a, i) => (script[300 + i * 250] = [{ t: 'cast', art: a.id }]));
  script[1500] = [{ t: 'sell', id: 4 }];
  let picks = 0;
  while (!isOver(s) && s.tick < MAX_TICKS) {
    const cmds = [...(script[s.tick] ?? [])];
    if (s.phase === 'picking' && s.offer != null && picks < 2) { cmds.push({ t: 'pick', card: s.offer[s.offer.length - 1]! }); picks++; }
    if (s.phase === 'break' && s.wave % 3 === 0) cmds.push({ t: 'nextWave' });
    if (cmds.length > 0) commands[s.tick] = cmds;
    stepDefend(s, cmds);
  }
  return trace(stageId, seed, null, commands);
}

// Replays the commands from a fresh state, exactly as a server would verify a run.
export function replay(stageId: string, seed: number, sect: string | null, commands: Commands, onTick?: (s: DefendState) => void): DefendState {
  const s = createDefend(stageId, seed, sect);
  while (!isOver(s) && s.tick < MAX_TICKS) {
    stepDefend(s, commands[s.tick] ?? []);
    onTick?.(s);
  }
  return s;
}

// Only the fields each command uses, in a fixed order, so files stay small and diffable.
export function toJson(c: Command): Record<string, unknown> {
  const o: Record<string, unknown> = { t: c.t };
  switch (c.t) {
    case 'place': o.sect = c.sect; o.tx = c.tx ?? 0; o.ty = c.ty ?? 0; break;
    case 'upgrade': o.id = c.id ?? 0; if (c.branch != null) o.branch = c.branch; break;
    case 'sell': o.id = c.id ?? 0; break;
    case 'merge': o.a = c.a ?? 0; o.b = c.b ?? 0; break;
    case 'target': o.id = c.id ?? 0; o.mode = c.mode; break;
    case 'cast': o.art = c.art; if ((c.tx ?? 0) !== 0 || (c.ty ?? 0) !== 0) { o.tx = c.tx; o.ty = c.ty; } break;
    case 'pick': o.card = c.card; break;
  }
  return o;
}

function trace(stageId: string, seed: number, sect: string | null, commands: Commands): Golden {
  const tr: [number, string][] = [];
  const end = replay(stageId, seed, sect, commands, (st) => { if (st.tick % 100 === 0) tr.push([st.tick, canonicalHash(st)]); });
  const cmds: Commands = {};
  for (const k of Object.keys(commands).map(Number).sort((a, b) => a - b)) cmds[k] = commands[k]!.map(toJson) as unknown as Command[];
  return {
    stageId, seed, ...(sect != null ? { sect } : {}), commands: cmds, trace: tr,
    final: { phase: end.phase, wave: end.wave, lives: end.lives, silver: end.silver, tick: end.tick, hash: canonicalHash(end), canonical: canonicalString(end) },
  };
}

export const goldenPath = (name: string) => `${GOLDEN_DIR}golden-${name}.json`;
export const serialize = (g: Golden) => JSON.stringify(g, null, 1) + '\n';
export const readGolden = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Golden;

export function writeAll(): void {
  for (const [name, make] of Object.entries(ALL)) {
    const g = make();
    writeFileSync(goldenPath(name), serialize(g));
    console.log(`${name} ${g.final.phase} ticks ${g.final.tick} trace ${g.trace.length} hash ${g.final.hash}`);
  }
}
