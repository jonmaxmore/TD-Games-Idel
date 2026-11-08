// ศึกปราบ chapter 1 (campaign.json, SPEC-castle-battle §13): the data holds together, stars follow each stage's goals, and
// the difficulty gate: the paced bot on the collection each home sect owns when it first plays a stage, Lv1, wins 1-1 at
// least 80% and the boss 1-10 30-60%, and each stage is at least 2 points harder than the one before (mean over homes);
// no single home sect falls under a floor, and 1-6 is lost without anti-air.
import { beforeAll, describe, expect, it } from 'vitest';
import { battle, createBattle, homeSects, ownedAt, rewardCard, stageCards, stages, starsOf, TICK_HZ } from '../src';
import { ownedTeamAt, playStage, withoutAntiAir } from './battleBot';

describe('campaign data', () => {
  it('10 stages 1-1..1-10, the last the boss; every card known; leaders among the enemy cards; mana and rewards set', () => {
    expect(stages.map((s) => s.id)).toEqual(Array.from({ length: 10 }, (_, i) => `1-${i + 1}`));
    expect(stages.map((s) => s.boss)).toEqual([...Array(9).fill(false), true]);
    for (const st of stages) {
      expect(stageCards(st).every((d) => d != null), st.id).toBe(true);
      if (st.enemy.leader) expect(st.enemy.collection, st.id).toEqual(expect.arrayContaining([st.enemy.leader, st.enemy.sub]));
      else expect(st.enemy.hand, st.id).toEqual(st.enemy.collection);
      expect(st.rules.fortsAtPct.every((p) => p > 0 && p < 100), st.id).toBe(true);
      expect(st.rules.manaStart.every((m) => m >= 0 && m <= battle.manaMax) && st.rules.fortBonus >= 0 && st.rules.regenPct > 0, st.id).toBe(true);
      expect(st.rewards.win.xp > 0 && st.rewards.win.coins > 0 && st.rewards.win.gold > 0, st.id).toBe(true);
      expect(st.nameTh && st.briefTh && st.teachTh && st.gimmicks.every((g) => g.nameTh && g.descTh), st.id).toBeTruthy();
      for (const home of homeSects) {
        const r = st.rewards.firstClear, card = rewardCard(r, home);
        expect('eggPoints' in r ? r.eggPoints > 0 && card == null : card != null && stageCards(st) != null, `${st.id} ${home}`).toBe(true);
      }
    }
  });
});

describe('stars', () => {
  const st = stages[0]!, ended = () => { const s = createBattle(1, st.enemy, st.enemy, { stage: st.rules }); s.winner = 0; return s; };
  it('each star needs the win; castleHp needs pct % of our max HP, under a win before sec, total every fort ours', () => {
    const s = ended();
    s.winner = 1;
    expect(starsOf(s, { ...st, stars: [{ kind: 'win' }, { kind: 'castleHp', pct: 0 }, { kind: 'total' }] })).toEqual([false, false, false]);
    const hp = ended();
    hp.castles[0].hp = hp.castles[0].maxHp / 2;
    expect(starsOf(hp, { ...st, stars: [{ kind: 'win' }, { kind: 'castleHp', pct: 50 }, { kind: 'castleHp', pct: 51 }] })).toEqual([true, true, false]);
    const fast = ended();
    fast.tick = 120 * TICK_HZ - 1;
    expect(starsOf(fast, { ...st, stars: [{ kind: 'under', sec: 120 }, { kind: 'under', sec: 119 }, { kind: 'kills', n: 1 }] })).toEqual([true, false, false]);
    const all = ended();
    for (const f of all.forts) f.owner = 0;
    expect(starsOf(all, { ...st, stars: [{ kind: 'total' }, { kind: 'win' }, { kind: 'win' }] })[0]).toBe(true);
    all.forts[1]!.owner = 1;
    expect(starsOf(all, { ...st, stars: [{ kind: 'total' }, { kind: 'win' }, { kind: 'win' }] })[0]).toBe(false);
  });

  it('stars can be set per stage: 1-1 asks for a total win, the rest the chapter\'s three', () => {
    expect(stages[0]!.stars.map((g) => g.kind)).toEqual(['win', 'castleHp', 'total']);
    for (const s of stages.slice(1)) expect(s.stars.map((g) => g.kind), s.id).toEqual(['win', 'castleHp', 'under']);
  });
});

describe('campaign balance', () => {
  // win % per stage per home sect (homeSects order), 100 seeds each
  let bySect: number[][] = [];
  beforeAll(() => {
    bySect = stages.map((st, i) => homeSects.map((home) => {
      let w = 0;
      for (let seed = 1; seed <= 100; seed++) w += +starsOf(playStage(seed, st, ownedTeamAt(home, i, 1)).state, st)[0];
      return w;
    }));
  }, 180_000);
  const table = () => bySect.map((r, i) => `${stages[i]!.id} ${r.join(' ')}`).join('\n');

  it('owned collection Lv1, paced bot, 100 seeds per home sect: 1-1 >= 80%, 1-10 30-60%, every stage >= 2 points below the last', () => {
    const win = bySect.map((r) => r.reduce((a, b) => a + b, 0) / homeSects.length);
    expect(win[0]!).toBeGreaterThanOrEqual(80);
    expect(win[9]!).toBeGreaterThanOrEqual(30);
    expect(win[9]!).toBeLessThanOrEqual(60);
    for (let i = 1; i < win.length; i++) expect(win[i]!, `stage ${stages[i]!.id} after ${win.join(',')}`).toBeLessThanOrEqual(win[i - 1]! - 2);
  });

  it('no home sect hits a wall: each wins 1-1..1-9 at least 40% and the boss 1-10 at least 30%, and the boss is its hardest stage', () => {
    homeSects.forEach((home, h) => {
      for (let i = 0; i < 9; i++) expect(bySect[i]![h]!, `${home} ${stages[i]!.id}\n${table()}`).toBeGreaterThanOrEqual(40);
      expect(bySect[9]![h]!, `${home} 1-10\n${table()}`).toBeGreaterThanOrEqual(30);
      expect(bySect[9]![h]!, `${home} 1-10\n${table()}`).toBeLessThan(Math.min(...bySect.slice(0, 9).map((r) => r[h]!)));
    });
  });

  it('1-6 teaches anti-air: with its own cards unable to hit fliers, every home sect wins at least 25 points less', () => {
    const i = stages.findIndex((s) => s.id === '1-6'), st = stages[i]!;
    homeSects.forEach((home, h) => {
      const theirs = new Set(stageCards(st).map((d) => d.id));
      const blind = withoutAntiAir(ownedAt(home, i).filter((c) => !theirs.has(c)), () => {
        let w = 0;
        for (let seed = 1; seed <= 100; seed++) w += +starsOf(playStage(seed, st, ownedTeamAt(home, i, 1)).state, st)[0];
        return w;
      });
      expect(blind, `${home}: ${bySect[i]![h]} -> ${blind}`).toBeLessThanOrEqual(bySect[i]![h]! - 25);
    });
  });
});
