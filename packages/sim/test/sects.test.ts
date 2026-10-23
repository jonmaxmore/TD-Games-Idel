// Sect x role rosters and the sect rules (sects.json > roster, SPEC-core §4).
import { describe, expect, it } from 'vitest';
import { createGame, step, UNITS, unlockedUnits, type DefendState, type Enemy } from '../src/index';

const game = (stage: string, sect: 'fire' | 'wood' | 'metal' | null) => createGame(stage, 1, sect) as DefendState;

describe('roster sects', () => {
  it('unlock roles along chapter 1 and all of them on training grounds', () => {
    expect(unlockedUnits('fire', '1-1')).toEqual(['crimson_phoenix_striker', 'crimson_phoenix_burst']);
    expect(unlockedUnits('wood', '1-2')).toEqual(['jade_bamboo_striker', 'jade_bamboo_burst', 'jade_bamboo_control']);
    expect(unlockedUnits('fire', '1-12')).toHaveLength(5);
    expect(unlockedUnits('wood', 'T-0')).toHaveLength(5);
  });

  it('a sect without a roster plays the legacy element disciples', () => {
    const s = game('1-1', 'metal');
    expect(s.sect).toBeNull();
    expect(s.unlocked).toEqual(['metal']);
  });

  it('a roster unit fights with its kit but counts as its sect element', () => {
    const s = game('1-12', 'fire');
    step(s, [{ t: 'place', sect: 'crimson_phoenix_striker', tx: 3, ty: 3 }]);
    const d = s.disciples[0]!;
    expect(d.els).toEqual(['metal']);
    expect(d.el).toBe('fire');
    expect(d.unit).toBe('crimson_phoenix_striker');
    expect(s.silver).toBe((createGame('1-12', 1, 'fire') as DefendState).silver - UNITS['crimson_phoenix_striker']!.cost);
  });

  it('rejects merging roster disciples', () => {
    const s = game('1-12', 'wood');
    s.silver = 10000;
    step(s, [{ t: 'place', sect: 'jade_bamboo_striker', tx: 3, ty: 3 }, { t: 'place', sect: 'jade_bamboo_burst', tx: 4, ty: 3 }]);
    for (let i = 0; i < 2; i++) step(s, s.disciples.map((d) => ({ t: 'upgrade' as const, id: d.id })));
    const ev = step(s, [{ t: 'merge', a: 1, b: 2 }]);
    expect(ev.some((e) => e.e === 'error')).toBe(true);
  });
});

describe('sect rules', () => {
  const burnTicks = (sect: 'fire' | null) => {
    const s = game('1-12', sect);
    step(s, [{ t: 'nextWave' }]);
    while (s.enemies.length === 0) step(s);
    const e = s.enemies[0]!;
    e.hp = e.maxHp = 100000;
    let lost = 0;
    for (let t = 0; t < 100; t++) { e.burnT = 60; e.burnDps = 20; const before = e.hp; step(s); lost += before - e.hp; }
    return lost;
  };
  it('fire: a burn that keeps going hits harder', () => {
    expect(burnTicks('fire')).toBeGreaterThan(burnTicks(null));
  });

  it('wood: a poisoned enemy that dies poisons its neighbours', () => {
    const s = game('1-12', 'wood');
    step(s, [{ t: 'nextWave' }]);
    while (s.enemies.length < 2) step(s);
    const [a, b] = s.enemies as [Enemy, Enemy];
    b.x = a.x; b.y = a.y; b.poison = 0;
    a.poison = 2; a.poisonT = 40; a.poisonDps = 10; a.hp = 0;
    step(s);
    expect(b.poison).toBeGreaterThan(0);
  });
});
