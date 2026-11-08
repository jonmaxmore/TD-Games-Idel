import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '@five-sects/sim';
import { quitRule, SURRENDER_AFTER_SEC } from '../src/quit';

describe('leaving a match from the pause menu', () => {
  it('ศึกฝีมือ: the only way out is ยอมแพ้, closed before the 60th second, then a confirmed loss', () => {
    const early = quitRule('ranked', 0);
    expect(early).toMatchObject({ label: 'ยอมแพ้', surrender: true });
    expect(early.why).toContain(String(SURRENDER_AFTER_SEC));
    expect(quitRule('ranked', SURRENDER_AFTER_SEC * TICK_HZ - 1).why).not.toBeNull();
    const open = quitRule('ranked', SURRENDER_AFTER_SEC * TICK_HZ);
    expect(open.why).toBeNull();
    expect(open.confirm?.body).toContain('แพ้');
  });

  it('ศึกปราบ and ศึกทั่วไป leave without a result, but only after a confirm that says so', () => {
    const r = quitRule('casual', 0);
    expect(r).toMatchObject({ surrender: false, why: null });
    expect(r.confirm?.body).toContain('ไม่นับผล');
  });

  it('a friend-room match can be left at once, after a confirm, as a forfeit the server decides', () => {
    const r = quitRule('online', 0);
    expect(r).toMatchObject({ label: 'ยอมแพ้และออก', surrender: false, why: null });
    expect(r.confirm?.body).toContain('แพ้');
  });

  it('a replay just stops', () => {
    expect(quitRule('replay', 0)).toMatchObject({ surrender: false, why: null, confirm: null });
  });
});
