// Rules shared by every mode: Wu Xing, and the determinism ban on APIs that differ between devices.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { overcomeByPct, overcomePct, wuxingPct } from '../src';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

describe('wu xing', () => {
  // SPEC-core §7: overcomePct against the element it overcomes, overcomeByPct against the one that overcomes it (sects.json).
  it('overcoming and overcome-by', () => {
    expect(wuxingPct(['metal'], 'wood')).toBe(overcomePct);
    expect(wuxingPct(['metal'], 'fire')).toBe(overcomeByPct);
    expect(overcomePct).toBeGreaterThan(100);
    expect(overcomeByPct).toBeLessThan(100);
    expect(wuxingPct(['metal'], 'water')).toBe(100);
    expect(wuxingPct(['yinyang'], 'fire')).toBe(100);
  });
  it('several elements use the best one', () => expect(wuxingPct(['metal', 'water'], 'fire')).toBe(overcomePct));
});

describe('determinism', () => {
  // The rules must give the same result on every device and on the server: no clocks, no system randomness,
  // no DOM calls and no locale-dependent formatting. Maps and Sets are lookups only; the rules iterate arrays.
  it('the rules use no non-deterministic APIs', () => {
    const banned = /Math\.random|\bDate\b|performance\.|crypto\.|setTimeout|setInterval|\bwindow\.|\bdocument\.|toLocale|\bIntl\./;
    const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const src = readFileSync(SRC + f, 'utf8').replace(/\/\/[^\n]*/g, '');
      const m = src.match(banned);
      expect(m, `${f} uses ${m?.[0]}`).toBeNull();
    }
  });
});
