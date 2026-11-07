import { describe, expect, it } from 'vitest';
import { wordRuns } from '../src/words';

describe('Thai word runs', () => {
  it('keeps every Thai word whole and the text unchanged', () => {
    const runs = wordRuns('สาย A · กระบี่ในใจ');
    expect(runs.map((r) => r.text).join('')).toBe('สาย A · กระบี่ในใจ');
    expect(runs.filter((r) => r.word).map((r) => r.text)).toEqual(['สาย', 'A', 'กระบี่', 'ใน', 'ใจ']);
  });
});
