// ศึกฝีมือ (SPEC-castle-battle §14): the local star ladder from progression.json > ranked, and a saved ranked match (seed,
// setups, options, commands) replays through the sim to the same final hash.
import { describe, expect, it } from 'vitest';
import { battleCardIds, battleHash, leagues, progression, rankAfter, rankName, replayBattle, startRank, type BattleRecord, type Rank } from '../src';
import { MIXED, playBattle } from './battleBot';

const wins = (r: Rank, n: number, won: boolean | null = true) => { for (let i = 0; i < n; i++) r = rankAfter(r, won); return r; };

describe('ranked ladder', () => {
  it('starts at the lowest league\'s bottom division with no stars; a full division promotes with one star', () => {
    const L = leagues[0]!, r = startRank();
    expect(r).toEqual({ league: 0, div: L.divisions, stars: 0, streak: 0, points: 0 });
    expect(rankAfter(r, true)).toMatchObject({ stars: 1, streak: 1 });
    const full = { ...r, stars: L.stars, streak: 0 };
    expect(rankAfter(full, true)).toMatchObject({ league: 0, div: L.divisions - 1, stars: 1 });
    expect(rankAfter({ ...full, div: 1 }, true)).toMatchObject({ league: 1, div: leagues[1]!.divisions, stars: 1 });
  });

  it('a streak of streakLength wins earns a bonus star where the league has streakBonus; a loss or draw ends the streak', () => {
    const r = wins(startRank(), 3);
    expect(r).toMatchObject({ div: leagues[0]!.divisions - 1, stars: 1, streak: 3 }); // the third win adds two: 4 stars, over a 3-star division
    expect(rankName(r)).toBe(`${leagues[0]!.nameTh} II · 1/${leagues[0]!.stars} ดาว`);
    expect(rankAfter(r, null).streak).toBe(0);
    expect(rankAfter(r, false).streak).toBe(0);
  });

  it('a loss costs a star only where loseStars; at 0 stars it drops a division, never out of a floor league', () => {
    const stone = { ...startRank(), stars: 2 };
    expect(rankAfter(stone, false).stars).toBe(2);
    const si = leagues.findIndex((l) => l.loseStars && l.floor), S = leagues[si]!;
    expect(rankAfter({ league: si, div: 1, stars: 0, streak: 0, points: 0 }, false)).toMatchObject({ league: si, div: 2, stars: S.stars - 1 });
    expect(rankAfter({ league: si, div: S.divisions, stars: 0, streak: 0, points: 0 }, false)).toMatchObject({ league: si, div: S.divisions, stars: 0 });
    const ji = leagues.findIndex((l) => !l.floor), J = leagues[ji]!;
    expect(rankAfter({ league: ji, div: J.divisions, stars: 0, streak: 0, points: 0 }, false)).toMatchObject({ league: ji - 1, div: 1, stars: leagues[ji - 1]!.stars - 1 });
  });

  it('the top league counts points, never below 0; enough wins climb from the bottom to it', () => {
    const top = leagues.length - 1;
    const r = wins(startRank(), 200);
    expect([r.league, r.points > 0]).toEqual([top, true]);
    expect(rankAfter({ ...r, points: 5 }, false).points).toBe(0);
    expect(rankName(r)).toContain(leagues[top]!.nameTh);
  });
});

describe('ranked replay', () => {
  it('a saved normalized match (both sides\' commands, through JSON) replays to the same final hash, whatever progress the setups carry', () => {
    const maxed = { ...MIXED, progress: { levels: Object.fromEntries(battleCardIds.map((c) => [c, progression.maxLevel])) } };
    const played = playBattle(9, 'paced', 'rush', maxed, MIXED, { normalized: true });
    const rec: BattleRecord = JSON.parse(JSON.stringify({ seed: 9, setups: [maxed, MIXED], opts: { normalized: true }, commands: played.commands }));
    expect(battleHash(replayBattle(rec))).toBe(battleHash(played.state));
    const casual = replayBattle({ ...rec, opts: {} });
    expect(battleHash(casual)).not.toBe(battleHash(played.state));
  });
});
