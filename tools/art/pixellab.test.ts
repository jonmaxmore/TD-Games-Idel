// art/pixellab.json stays in step with docs/data: every roster disciple has a board figure and a card, every enemy and boss a
// board figure, every standing prop an object, and nothing else. Palettes resolve against effects.json > render.palette.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs generator without types
import { colorsOf, manifest } from './pixellab.mjs';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../docs/data/${f}.json`, import.meta.url), 'utf8'));
interface Asset { id: string; kind: string; size: number; prompt: string; palette: string[] }
const assets: Asset[] = manifest().assets;
const ids = (kind: string) => assets.filter((a) => a.kind === kind).map((a) => a.id).sort();

describe('pixellab manifest', () => {
  it('covers every roster disciple, enemy, boss and standing prop, once each', () => {
    const units = read('sects').roster.units.map((u: { id: string }) => u.id).sort();
    const en = read('enemies');
    const foes = [...en.enemies, ...en.bosses].map((e: { id: string }) => e.id);
    const props = Object.keys(read('maps').propTypes).filter((p) => !['roof', 'rice', 'ice-floor'].includes(p)); // flat ones are painted into the ground
    expect(ids('character')).toEqual([...units, ...foes].sort());
    expect(ids('card')).toEqual(units);
    expect(ids('object')).toEqual([...props, 'gate'].sort());
  });

  it('draws 96 on the board and 128 on cards, with a prompt and palette groups that exist', () => {
    for (const a of assets) {
      expect(a.size, `${a.kind}:${a.id}`).toBe(a.kind === 'card' ? 128 : 96);
      expect(a.prompt.length, a.id).toBeGreaterThan(20);
      expect(colorsOf(a).length, a.id).toBeGreaterThan(6);
    }
  });
});
