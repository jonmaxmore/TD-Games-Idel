import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tools without types
import { decodePng, encodePng } from './png.mjs';
// @ts-expect-error plain .mjs tools without types
import { stylize } from './stylize.mjs';

const palette = JSON.parse(readFileSync(new URL('../../docs/data/effects.json', import.meta.url), 'utf8')).render.palette as Record<string, string[]>;
type Img = { width: number; height: number; rgba: Uint8Array };
const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const at = (m: Img, x: number, y: number) => '#' + [0, 1, 2].map((k) => m.rgba[(y * m.width + x) * 4 + k]!.toString(16).padStart(2, '0')).join('').toUpperCase();

// A 9x9 fire figure: a 7x7 block of mid fire with a one-pixel black line down its middle, on clear ground.
function figure(): Img {
  const m: Img = { width: 9, height: 9, rgba: new Uint8Array(9 * 9 * 4) };
  for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) m.rgba.set([...rgb(x === 4 && y > 1 && y < 7 ? '#1A1423' : '#B12F00'), 255], (y * 9 + x) * 4);
  return m;
}

describe('stylize', () => {
  const out = stylize(figure(), palette) as Img;

  it('gives the silhouette edge the darkest tone of the dominant family, not black', () => {
    expect(at(out, 1, 1)).toBe('#561700');
    expect(at(out, 7, 4)).toBe('#561700');
    expect(at(out, 0, 0)).toBe('#000000'); // still clear
    expect(out.rgba[3]).toBe(0);
  });

  it('turns a black line inside the figure into a darker shade of the fill beside it', () => {
    const line = at(out, 4, 4);
    expect(line).not.toBe('#1A1423');
    expect(palette.fire).toContain(line);
    expect(at(out, 3, 4)).toBe('#B12F00'); // the fill itself is untouched
  });

  it('keeps a dark fill dark: a black block is not an outline', () => {
    const m = figure();
    for (let y = 2; y < 7; y++) for (let x = 2; x < 7; x++) m.rgba.set([...rgb('#1A1423'), 255], (y * 9 + x) * 4);
    expect(at(stylize(m, palette), 4, 4)).toBe('#1A1423');
  });

  it('is deterministic and round-trips through PNG', () => {
    const png = encodePng(out);
    expect(Buffer.compare(png, encodePng(stylize(figure(), palette)))).toBe(0);
    expect(decodePng(png)).toEqual({ width: 9, height: 9, rgba: out.rgba });
  });
});
