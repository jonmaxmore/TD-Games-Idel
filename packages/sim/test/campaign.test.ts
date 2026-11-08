// ศึกปราบ chapter (campaign.json, SPEC-castle-battle §13): the data holds together, stars follow the three goals, and the
// difficulty gate: the paced bot on the default fire team at Lv1 wins stage 1 at least 80% and the last stage 30-60%.
import { describe, expect, it } from 'vitest';
import { battle, createBattle, stageCards, stages, starsOf, STARS, TICK_HZ } from '../src';
import { fireTeamAt, playStage } from './battleBot';

describe('campaign data', () => {
  it('6-8 stages with unique ids, every named card known, a leader and sub in the enemy cards, rewards for a win', () => {
    expect(stages.length).toBeGreaterThanOrEqual(6);
    expect(stages.length).toBeLessThanOrEqual(8);
    expect(new Set(stages.map((s) => s.id)).size).toBe(stages.length);
    for (const st of stages) {
      expect(stageCards(st).every((d) => d != null), st.id).toBe(true);
      expect(st.enemy.collection, st.id).toEqual(expect.arrayContaining([st.enemy.leader, st.enemy.sub]));
      expect(st.rules.fortsAtPct.every((p) => p > 0 && p < 100), st.id).toBe(true);
      expect(st.rewards.win.xp > 0 && st.rewards.win.coins > 0 && st.rewards.win.gold > 0, st.id).toBe(true);
      expect(st.nameTh && st.briefTh && st.gimmickTh && st.gimmickDescTh, st.id).toBeTruthy();
    }
  });
});

describe('stars', () => {
  it('each star needs the win; the castle star needs castleHpPct of our HP, the fast star a win before winUnderSec', () => {
    const s = createBattle(1, stages[0]!.enemy, stages[0]!.enemy, { stage: stages[0]!.rules });
    s.winner = 1;
    expect(starsOf(s)).toEqual([false, false, false]);
    s.winner = 0;
    s.tick = STARS.winUnderSec * TICK_HZ - 1;
    s.castles[0].hp = (s.castles[0].maxHp * STARS.castleHpPct) / 100;
    expect(starsOf(s)).toEqual([true, true, true]);
    s.castles[0].hp -= 1;
    s.tick++;
    expect(starsOf(s)).toEqual([true, false, false]);
    expect(battle.matchTicks).toBeGreaterThan(STARS.winUnderSec * TICK_HZ);
  });
});

describe('campaign balance', () => {
  it('fire team Lv1, paced bot, 200 seeds: stage 1 >= 80% win, the last 30-60%, no stage much easier than the one before', () => {
    const win = stages.map((st) => {
      let w = 0;
      for (let seed = 1; seed <= 200; seed++) w += +starsOf(playStage(seed, st, fireTeamAt(1)).state)[0];
      return w / 2;
    });
    expect(win[0]!).toBeGreaterThanOrEqual(80);
    expect(win[win.length - 1]!).toBeGreaterThanOrEqual(30);
    expect(win[win.length - 1]!).toBeLessThanOrEqual(60);
    for (let i = 1; i < win.length; i++) expect(win[i]!, `stage ${stages[i]!.id} after ${win.join(',')}`).toBeLessThanOrEqual(win[i - 1]! + 5);
  });
});
