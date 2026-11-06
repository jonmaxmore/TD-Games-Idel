import { describe, expect, it } from 'vitest';
import { migrate, recordEnd, route } from '../src/profile';

describe('profile and route', () => {
  it('walks a first run step by step to the lobby', () => {
    const p = migrate(null);
    const seen: string[] = [];
    const steps: Partial<typeof p>[] = [{ consented: true, birthYear: 2000 }, { introSeen: true }, {}, { sect: 'fire' }, { name: 'หลิวอวิ๋น' }];
    for (const change of steps) {
      const s = route(p);
      seen.push(s.k === 'battle' ? s.stageId : s.k);
      if (s.k === 'battle') recordEnd(p, s.stageId, false, [false]);
      Object.assign(p, change);
    }
    seen.push(route(p).k);
    expect(seen).toEqual(['consent', 'intro', 'T-0', 'sectPick', 'name', 'lobby']);
  });

  it('drops sects and stages that are not in the data, and sects without a roster', () => {
    expect(migrate({ consented: true, sect: 'metal', cleared: ['1-1', 'nope', '1-1'], stars: { '1-1': 2, x: 3 } })).toMatchObject({ sect: null, cleared: ['1-1'], stars: { '1-1': 2 } });
    expect(migrate({ sect: 'gone' }).sect).toBeNull();
    expect(migrate('garbage').consented).toBe(false);
  });

  it('keeps the best stars and ignores losses', () => {
    const p = migrate(null);
    recordEnd(p, '1-1', true, [true, true, false]);
    recordEnd(p, '1-1', true, [true, false, false]);
    recordEnd(p, '1-2', false, [false, false, false]);
    expect(p.stars).toEqual({ '1-1': 2 });
    expect(p.cleared).toEqual(['1-1']);
  });

  it('keeps valid sound and shake settings and resets bad ones', () => {
    expect(migrate(null).settings).toEqual({ volume: 70, muted: false, shake: true });
    expect(migrate({ settings: { volume: 30, muted: true, shake: false } }).settings).toEqual({ volume: 30, muted: true, shake: false });
    expect(migrate({ settings: { volume: 500, muted: 'yes' } }).settings).toEqual({ volume: 70, muted: false, shake: true });
  });
});
