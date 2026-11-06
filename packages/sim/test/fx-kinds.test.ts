// The view-only `kind` on hit and stun events, which the client turns into each technique's own effect.
import { describe, expect, it } from 'vitest';
import { branchB, type Branch, type Enemy } from '../src';
import { defend, NEXT, place, run, up } from './helpers';

function tier3(kit: string, branch: Branch, foe: Partial<Enemy> = {}) {
  const s = defend('T-1', 1);
  s.silver = 100000;
  run(s, 1, place(kit, 3, 3), NEXT);
  const d = s.disciples[0]!;
  run(s, 1, up(d.id));
  run(s, 1, { t: 'upgrade', id: d.id, branch });
  while (s.enemies.length === 0) run(s, 1);
  s.enemies = [{ ...s.enemies[0]!, id: s.nextId++, x: d.x, y: d.y, d: 5000, hp: 100000, maxHp: 100000, type: 'cultist', air: false, stunT: 999, ...foe }];
  s.spawnQueue = [];
  Object.assign(d, { cd: 0, hits: 0 });
  return { s, d };
}
const kinds = (kit: string, branch: Branch, foe: Partial<Enemy> = {}, timers: object = {}) => {
  const { s, d } = tier3(kit, branch, foe);
  Object.assign(d, timers);
  return run(s, 1).filter((e) => e.from === d.id && (e.e === 'hit' || e.e === 'stun')).map((e) => `${e.e}:${e.kind ?? ''}`);
};

describe('effect kinds on events', () => {
  it('tags each tier-3 branch b proc, and only the proc', () => {
    expect(kinds('metal', 'b', { hp: 20000 })).toContain('hit:execute');
    expect(kinds('metal', 'b', { hp: 50000 })).not.toContain('hit:execute');
    expect(kinds('fire', 'b')).toContain('hit:wildfire');
    expect(kinds('fire', 'a')).not.toContain('hit:wildfire');
    expect(kinds('wood', 'b', {}, { rootT: branchB.rootEvery })).toContain('stun:root');
    expect(kinds('water', 'b', {}, { hits: branchB.freezeEvery - 1 })).toContain('stun:freeze');
    expect(kinds('earth', 'b', {}, { bellT: 10000 })).toContain('stun:bell');
  });
});
