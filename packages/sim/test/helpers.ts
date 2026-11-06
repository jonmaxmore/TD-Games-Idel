import { createDefend, stepDefend, type Command, type DefendState, type SimEvent } from '../src';

export const defend = (id = 'T-1', seed = 1, sect: string | null = null) => createDefend(id, seed, sect);

export function run(s: DefendState, ticks: number, ...cmds: Command[]): SimEvent[] {
  const ev = stepDefend(s, cmds);
  for (let i = 1; i < ticks; i++) ev.push(...stepDefend(s, []));
  return ev;
}

export const place = (sect: string, tx: number, ty: number): Command => ({ t: 'place', sect, tx, ty });
export const up = (id: number): Command => ({ t: 'upgrade', id });
export const NEXT: Command = { t: 'nextWave' };

// Interest is paid once per wave when the field is clear; calling a wave pays nothing.
export function interestAtClear(s: DefendState): number {
  s.enemies.length = 0; s.spawnQueue.length = 0; s.phase = 'clearing';
  return run(s, 1).find((e) => e.e === 'interest')!.amount!;
}
