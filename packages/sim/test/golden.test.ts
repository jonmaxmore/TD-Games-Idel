// The committed goldens must be exactly what the current rules and bot produce, and every golden must replay
// to its recorded hashes. A mismatch means a rule changed: if on purpose, rewrite them with npm run sim:golden.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalHash } from '../src';
import { actions, ALL, GOLDEN_DIR, goldenPath, readGolden, replay, serialize } from './goldens';

describe('goldens', () => {
  it('committed goldens are up to date', () => {
    for (const [name, make] of Object.entries(ALL))
      expect(serialize(make()) === readFileSync(goldenPath(name), 'utf8'), `golden-${name}.json is stale: run npm run sim:golden`).toBe(true);
  });

  it('every golden replays to its hashes', () => {
    const files = readdirSync(GOLDEN_DIR).filter((f) => f.startsWith('golden-')).sort();
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const g = readGolden(GOLDEN_DIR + f);
      let i = 0;
      const end = replay(g.stageId, g.seed, g.sect ?? null, g.commands, (s) => {
        if (s.tick % 100 !== 0 || i >= g.trace.length) return;
        expect(canonicalHash(s), `${f} tick ${s.tick}`).toBe(g.trace[i]![1]);
        i++;
      });
      expect(canonicalHash(end), `${f} final`).toBe(g.final.hash);
    }
  });

  it('the actions golden exercises every command', () => {
    const all = new Set(Object.values(actions(11).commands).flat().map((c) => c.t));
    for (const t of ['merge', 'cast', 'target', 'sell', 'pick', 'upgrade', 'place']) expect(all.has(t as never), t).toBe(true);
  });
});
