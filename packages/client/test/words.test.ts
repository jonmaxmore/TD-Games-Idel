import { describe, expect, it } from 'vitest';
import { wordRuns } from '../src/words';

describe('no-wrap runs', () => {
  it('keeps a Thai name whole and the text unchanged', () => {
    const runs = wordRuns('สาย A · กระบี่ในใจ');
    expect(runs.map((r) => r.text).join('')).toBe('สาย A · กระบี่ในใจ');
    expect(runs.filter((r) => r.word).map((r) => r.text)).toEqual(['สาย', 'A', '·', 'กระบี่ในใจ']);
  });
});
