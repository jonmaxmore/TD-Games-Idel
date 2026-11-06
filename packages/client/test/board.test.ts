import { palette } from '@five-sects/sim';
import { describe, expect, it } from 'vitest';
import { FX } from '../src/board';

describe('board colours', () => {
  it('draws tier-3 looks, technique effects and status marks only in effects.json render.palette colours', () => {
    const all = new Set([...palette.values()].flat().map((c) => c.toUpperCase()));
    expect(Object.entries(FX).filter(([, c]) => !all.has(c.toUpperCase()))).toEqual([]);
  });
});
