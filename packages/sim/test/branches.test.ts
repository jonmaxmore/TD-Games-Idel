// Tier-3 branches (SPEC-pc-v2 §5): the upgrade to tier 3 picks branch a (the original technique) or b, and the
// choice travels in the upgrade command so a replay reproduces it.
import { describe, expect, it } from 'vitest';
import { branchB, canonicalHash, canonicalString, type Branch, type Command, type Disciple, type Enemy, type SimEvent } from '../src';
import { playStage } from './bot';
import { replay } from './goldens';
import { defend, NEXT, place, run, up } from './helpers';

// One tier-3 disciple of a kit at (3,3) on the training ground, the field emptied so a test places its own enemies.
function tier3(kit: string, branch: Branch) {
  const s = defend('T-1', 1);
  s.silver = 100000;
  run(s, 1, place(kit, 3, 3), NEXT);
  const d = s.disciples[0]!;
  run(s, 1, up(d.id));
  run(s, 1, { t: 'upgrade', id: d.id, branch });
  while (s.enemies.length === 0) run(s, 1);
  const template = s.enemies[0]!;
  s.enemies = [];
  s.spawnQueue = [];
  // stunT keeps an enemy where it is put (a stunned enemy does not walk)
  const foe = (dx: number, dy: number, o: Partial<Enemy> = {}): Enemy => {
    const e: Enemy = { ...template, id: s.nextId++, x: d.x + dx, y: d.y + dy, d: 5000, hp: 100000, maxHp: 100000, type: 'cultist', air: false, stunT: 999, burnT: 0, poison: 0, poisonT: 0, slowT: 0, ...o };
    s.enemies.push(e);
    return e;
  };
  Object.assign(d, { cd: 0, hits: 0 });
  return { s, d, foe };
}
const hitsFrom = (ev: SimEvent[], d: Disciple) => ev.filter((e) => e.e === 'hit' && e.from === d.id);
const stunsFrom = (ev: SimEvent[], d: Disciple) => ev.filter((e) => e.e === 'stun' && e.from === d.id);

describe('tier-3 branches', () => {
  it('the upgrade to tier 3 records its branch; a kit without branch b refuses it', () => {
    const { d } = tier3('metal', 'b');
    expect([d.level, d.branch]).toEqual([3, 'b']);
    expect(tier3('metal', 'a').d.branch).toBe('a');
    const s = defend('T-1', 1);
    s.silver = 100000;
    run(s, 1, place('yinyang', 3, 3));
    const y = s.disciples[0]!;
    run(s, 1, up(y.id));
    const silver = s.silver;
    expect(run(s, 1, { t: 'upgrade', id: y.id, branch: 'b' }).some((e) => e.e === 'error' && e.msg === 'no such branch')).toBe(true);
    expect([y.level, s.silver]).toEqual([2, silver]);
  });

  it('metal: a crit pierces to a second enemy on a; b hits twice as hard below 30% HP instead', () => {
    for (const branch of ['a', 'b'] as const) {
      const { s, d, foe } = tier3('metal', branch);
      foe(0, 0); foe(100, 0);
      d.hits = 5; // the 6th hit is a sure crit
      expect(hitsFrom(run(s, 1), d).length, branch).toBe(branch === 'a' ? 2 : 1);
    }
    const strike = (branch: Branch, hpPct: number) => {
      const { s, d, foe } = tier3('metal', branch);
      foe(0, 0, { hp: hpPct * 1000 });
      return hitsFrom(run(s, 1), d)[0]!.dmg!; // same seed: the same crit roll in every run
    };
    expect(strike('b', 29)).toBeGreaterThanOrEqual(2 * strike('b', 31) - 1);
    expect(strike('b', 29)).toBeLessThanOrEqual(2 * strike('b', 31) + 1);
    expect(strike('a', 29)).toBe(strike('a', 31));
  });

  it('wood: a makes poisoned enemies take 25% more; b roots every enemy in range every 8 s and they take more damage while rooted', () => {
    const poisoned = (branch: Branch) => {
      const { s, d, foe } = tier3('wood', branch);
      foe(0, 0, { poison: 3, poisonT: 60, poisonDps: 1 });
      return hitsFrom(run(s, 1), d)[0]!.dmg!;
    };
    expect(poisoned('a')).toBe(Math.floor((poisoned('b') * 125) / 100));
    for (const branch of ['a', 'b'] as const) {
      const { s, d, foe } = tier3('wood', branch);
      foe(0, 0); foe(500, 0); foe(0, 500);
      d.rootT = 8 * 20 - 1;
      expect(stunsFrom(run(s, 1), d).length, branch).toBe(branch === 'a' ? 1 : 3);
    }
    // b: an enemy its roots hold takes takenPct more from every hit while held, and only then.
    const strike = (rooted: boolean) => {
      const { s, d, foe } = tier3('wood', 'b');
      foe(0, 0);
      d.rootT = rooted ? branchB.rootEvery - 1 : 0; // the roots land on this tick's attack, before the hit's damage on the next
      run(s, 1);
      d.cd = 0;
      return hitsFrom(run(s, 1), d)[0]!.dmg!;
    };
    expect(branchB.rootTakenPct).toBeGreaterThan(0);
    expect(strike(true)).toBe(Math.floor((strike(false) * (100 + branchB.rootTakenPct)) / 100));
  });

  it('water: a pushes the target back a tile every 12 s; b freezes more often than every 5th hit', () => {
    for (const branch of ['a', 'b'] as const) {
      const { s, d, foe } = tier3('water', branch);
      const e = foe(0, 0);
      Object.assign(d, { hits: branchB.freezeEvery - 1, pushT: 12 * 20 - 1 });
      const ev = run(s, 1);
      expect(e.d, `${branch} push`).toBe(branch === 'a' ? 4000 : 5000);
      expect(stunsFrom(ev, d).length, `${branch} freeze on hit ${branchB.freezeEvery}`).toBe(branch === 'a' ? 0 : 1);
    }
  });

  it('fire: a sends the phoenix every 20 s; b splashes wider and burns longer (wildfire)', () => {
    for (const branch of ['a', 'b'] as const) {
      const { s, d, foe } = tier3('fire', branch);
      const target = foe(0, 0);
      const edge = foe(1000, 0, { d: 4000 }); // past the 0.8-tile splash, inside wildfire's (and further from the gate: not the target)
      run(s, 1);
      expect(target.burnT, `${branch} burn`).toBe(branch === 'a' ? 60 : (60 * branchB.burnPct) / 100);
      expect(edge.burnT > 0, `${branch} splash reach`).toBe(branch === 'b');
      d.pushT = 20 * 20 - 1;
      expect(run(s, 1).some((e) => e.e === 'phoenix'), `${branch} phoenix`).toBe(branch === 'a');
    }
  });

  it('earth: a widens the bell to r 2 for 1 s; b keeps r 1 and stuns twice as long as the bell', () => {
    for (const branch of ['a', 'b'] as const) {
      const { s, d, foe } = tier3('earth', branch);
      const near = foe(0, 500, { stunT: 1 }), far = foe(0, 1500, { stunT: 1 }); // stunT 1: stays put this tick, then free
      d.bellT = 10 * 20 - 1;
      run(s, 1);
      expect([near.stunT, far.stunT], branch).toEqual(branch === 'a' ? [20, 20] : [80, 0]);
    }
  });

  it('a replay carries the branch: the same commands replay to the same hash, and without it they do not', () => {
    const commands: Record<number, Command[]> = {};
    const s = playStage('1-12', 1, 'fire', { branch: 'b', record: commands });
    const picks = Object.values(commands).flat().filter((c) => c.t === 'upgrade' && c.branch === 'b');
    expect(picks.length).toBeGreaterThan(0);
    expect(canonicalString(s)).toContain(',b;');
    expect(canonicalHash(replay('1-12', 1, 'fire', commands))).toBe(canonicalHash(s));
    const stripped: Record<number, Command[]> = {};
    for (const [t, cs] of Object.entries(commands)) stripped[Number(t)] = cs.map(({ branch: _drop, ...c }) => c);
    expect(canonicalHash(replay('1-12', 1, 'fire', stripped))).not.toBe(canonicalHash(s));
  });
});
