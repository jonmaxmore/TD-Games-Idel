import { SECT_ORDER } from './data';
import type { Command } from './types';

const int = (v: unknown) => Number.isInteger(v);

// Commands may come from replays or other players, so reject anything malformed before it
// touches state (non-integer tiles/ids would break integer units and path checks).
export function validCommand(c: Command): boolean {
  if (!c || typeof c !== 'object') return false;
  switch (c.t) {
    case 'place': return SECT_ORDER.includes(c.sect) && int(c.tx) && int(c.ty);
    case 'upgrade':
    case 'sell': return int(c.id);
    case 'merge': return int(c.a) && int(c.b) && c.a !== c.b;
    case 'nextWave': return true;
    case 'route': return c.choice === 'left' || c.choice === 'right';
    case 'skill': return int(c.member);
    default: return false;
  }
}
