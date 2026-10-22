// Checks the Blender pipeline output (npm run art:build) against art/manifest.json and docs/data/effects.json.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root));
const manifest = JSON.parse(read('art/manifest.json').toString());
const render = JSON.parse(read('docs/data/effects.json').toString()).render;

// PNG IHDR: width/height are big-endian u32 at bytes 16 and 20.
const pngSize = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

describe('blender sprites', () => {
  for (const a of manifest.assets.filter((x: { kind: string }) => x.kind !== 'promo')) {
    it(`${a.id}: atlas matches manifest and data sizes`, () => {
      const size = typeof a.size === 'string' ? render[a.size] : a.size;
      const [w, h] = typeof size === 'number' ? [size, size] : size;
      const atlas = JSON.parse(read(`${manifest.out}/${a.id}.json`).toString());
      expect(atlas.meta.actions).toEqual(a.actions);
      for (const [action, n] of Object.entries(a.actions) as [string, number][])
        for (let i = 0; i < n; i++) expect(atlas.frames[`${action}/${i}`].frame, `${action}/${i}`).toMatchObject({ w, h });
      expect(pngSize(read(`${manifest.out}/${a.id}.png`))).toEqual([atlas.meta.size.w, atlas.meta.size.h]);
      for (const g of a.palette) expect(render.palette[g], g).toBeDefined();
      expect(read(`prototypes/unity/Assets/Resources/sprites/${a.id}.png`).equals(read(`${manifest.out}/${a.id}.png`))).toBe(true);
    });
  }
});
