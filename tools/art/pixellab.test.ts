// art/pixellab.json stays in step with docs/data: every roster disciple has a board figure and a card, every enemy and boss a
// board figure, every standing prop an object, and nothing else. Palettes resolve against effects.json > render.palette.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs generator without types
import { colorsOf, manifest, plan } from './pixellab.mjs';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../docs/data/${f}.json`, import.meta.url), 'utf8'));
interface Asset { id: string; kind: string; size: number; prompt: string; palette: string[]; role?: string }
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

  it('plans attack and cast on 4 directions for disciples, walk and hurt for enemies, and an effect per kit', () => {
    const jobs = plan() as { key: string; kind: string }[];
    const anims = (id: string) => jobs.filter((j) => j.key.startsWith(`anim:${id}:`)).map((j) => j.key.split(':').slice(2).join(':')).sort();
    const four = (n: string) => ['east', 'north', 'south', 'west'].map((d) => `${n}:${d}`);
    expect(anims('crimson_phoenix_striker')).toEqual([...four('attack'), ...four('cast')]);
    expect(anims('cultist')).toEqual([...four('hurt'), ...four('walk')]);
    const enemies = new Set([...read('enemies').enemies, ...read('enemies').bosses].map((e: { id: string }) => e.id));
    for (const a of assets.filter((x) => x.kind === 'character')) expect(a.role === 'enemy', a.id).toBe(enemies.has(a.id));
    const vfx = jobs.filter((j) => j.kind === 'vfx').map((j) => j.key);
    for (const kit of ['metal', 'fire', 'water', 'earth', 'wood', 'yinyang']) expect(vfx).toContain(`vfx:${kit}-hit`);
  });
});
