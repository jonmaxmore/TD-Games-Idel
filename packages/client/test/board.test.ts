import { readFileSync } from 'node:fs';
import { palette } from '@five-sects/sim';
import { describe, expect, it } from 'vitest';

describe('board colours', () => {
  it('draws only effects.json render.palette colours on the canvas (an alpha suffix is ignored)', () => {
    const all = new Set([...palette.values()].flat().map((c) => c.toUpperCase()));
    const used = ['board.ts', 'main.ts'].flatMap((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').match(/#[0-9A-Fa-f]{6}/g) ?? []);
    expect(used.length).toBeGreaterThan(0);
    expect([...new Set(used.map((c) => c.toUpperCase()))].filter((c) => !all.has(c))).toEqual([]);
  });
});
