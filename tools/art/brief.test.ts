// Art docs stay in sync with game data: every sect has a card and a mockup, cards match the generator,
// and the design docs link each asset they cover. Regenerate: npm run art:brief / npm run art:mockups
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs generator without types
import { cards } from './brief.mjs';

const root = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const sects = JSON.parse(read('docs/data/sects.json'));
const ids: string[] = sects.sects.map((s: { element: string }) => s.element);

describe('art docs', () => {
  it('every sect has a card and a mockup', () => {
    for (const id of ids) {
      expect(existsSync(new URL(`docs/art/assets/${id}.md`, root)), `card ${id}`).toBe(true);
      expect(existsSync(new URL(`docs/art/mockups/${id}.png`, root)), `mockup ${id}`).toBe(true);
    }
  });

  it('committed cards match the generator (npm run art:brief)', () => {
    for (const [file, md] of Object.entries(cards() as Record<string, string>))
      expect(read(`docs/art/assets/${file}`), file).toBe(md);
  });

  it('design docs link their assets', () => {
    const chars = read('docs/art/character-design.md');
    for (const s of sects.sects) expect(chars, s.element).toContain(`assets/${s.element}.md`);
    const bible = read('docs/art/art-bible.md');
    for (const d of ['character-design', 'monster-design', 'vfx-design', 'ui-design', 'map-design']) expect(bible, d).toContain(`${d}.md`);
  });
});
