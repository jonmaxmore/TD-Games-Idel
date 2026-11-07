import { readdirSync, readFileSync } from 'node:fs';
import { palette } from '@five-sects/sim';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tools without types
import { pngColors } from '../../../tools/art/png.mjs';
// @ts-expect-error plain .mjs tools without types
import { spriteManifest } from '../../../tools/art/pixellab.mjs';

const dir = new URL('../public/sprites/', import.meta.url);
const pngs = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('.png'));

describe('sprites', () => {
  it('every opaque pixel of every sprite is an effects.json render.palette colour, with no half-transparent pixels', () => {
    const all = new Set([...palette.values()].flat().map((c) => c.toUpperCase()));
    expect(pngs.length).toBeGreaterThan(0);
    for (const f of pngs) {
      const { colors, partial } = pngColors(readFileSync(new URL(f, dir))) as { colors: Set<string>; partial: number };
      expect([...colors].filter((c) => !all.has(c)), f).toEqual([]);
      expect(partial, f).toBe(0);
    }
  });

  it('manifest.json lists exactly the sprites on disk (npm run art:pixellab -- --manifest)', () => {
    expect(JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'))).toEqual(spriteManifest());
  });
});
