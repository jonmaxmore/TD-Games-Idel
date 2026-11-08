import { describe, expect, it } from 'vitest';
import { battle, battleCardIds, battleUnits, castleLevelOf, createBattle, leagues, progression, rewardFor, stages, startRank } from '@five-sects/sim';
import { aiProgress, build, buyEgg, levelUp, payMatch, progressOf, recordRanked, recordStage, stageOpen, upgradeTown } from '../src/camp';
import { aiTeam, defaultTeam, fixTeam, PRESETS, presetMatch, presetTeam, resolveTeam, teamSetup } from '../src/decks';
import { levelSum, migrate } from '../src/profile';

describe('profile', () => {
  it('starts with the all-cards default team and default settings, and keeps a known team', () => {
    const fresh = migrate(null);
    expect({ v: fresh.v, team: fresh.team, settings: fresh.settings, mode: fresh.mode }).toEqual({ v: 6, team: defaultTeam(), settings: { volume: 70, muted: false, shake: true }, mode: 'casual' });
    expect(Object.keys(fresh.cards)).toEqual(battleCardIds);
    expect([fresh.coins, fresh.gold, fresh.eggPoints, fresh.castleLevel, fresh.town.cannon, fresh.town.wall]).toEqual([0, 0, 0, 1, 0, 0]);
    for (const c of Object.values(fresh.cards)) expect(c).toEqual({ level: 1, xp: 0, dupes: 0 });
    const team = { leader: 'storm_dragon', sub: 'jade_bamboo_warden', bench: ['ember_imp'] };
    expect(migrate({ team }).team).toEqual(team);
    expect(migrate({ v: 2, deck: 'water' }).team).toEqual(presetTeam('water')); // an old deck save keeps its sect
  });

  it('a v3 team (a sect collection) becomes that sect preset with its own bench added', () => {
    const t = migrate({ v: 3, team: { collection: 'wood', leader: 'jade_bamboo_crane', sub: 'jade_bamboo_warden', bench: ['jade_bamboo_support'] } }).team;
    expect([t.leader, t.sub]).toEqual(['jade_bamboo_crane', 'jade_bamboo_warden']);
    expect(teamSetup(t).collection.filter((c) => !t.bench.includes(c)).sort()).toEqual(PRESETS.find((p) => p.id === 'wood')!.cards.filter((c) => c !== 'jade_bamboo_support').sort());
  });

  it('turns an old TD save or an unknown team into a valid profile, keeping its settings', () => {
    const old = migrate({ v: 1, consented: true, sect: 'fire', cleared: ['1-1'], settings: { volume: 30, muted: true, shake: false } });
    expect([old.team, old.settings]).toEqual([defaultTeam(), { volume: 30, muted: true, shake: false }]);
    expect(migrate({ deck: 'gone', settings: { volume: 500, muted: 'yes' } }).settings).toEqual({ volume: 70, muted: false, shake: true });
    expect(migrate('garbage').v).toBe(6);
  });
});

describe('profile v5: the account', () => {
  it('a v4 save keeps its team and settings and starts the account at level 1; bad numbers fall back field by field', () => {
    const v4 = { v: 4, team: { leader: 'storm_dragon', sub: 'jade_bamboo_warden', bench: [] }, settings: { volume: 40, muted: false, shake: true } };
    const p = migrate(v4);
    expect([p.v, p.team.leader, p.settings.volume, p.mode]).toEqual([6, 'storm_dragon', 40, 'casual']);
    const bad = migrate({ v: 5, mode: 'ranked', coins: -5, gold: 1.5, cards: { ember_imp: { level: 99, xp: 10 }, nope: { level: 5 } }, town: { cannon: 9, wall: 2 }, forge: { ember_imp: { helm: 123, junk: 1 } } });
    expect([bad.mode, bad.coins, bad.gold, bad.cards.ember_imp!.level, bad.town.cannon, bad.town.wall]).toEqual(['ranked', 0, 0, 1, 0, 2]);
    expect(bad.cards.nope).toBeUndefined();
    expect(bad.forge).toEqual({ ember_imp: { helm: 123 } });
  });

  it('a match pays xp to the hand, coins and gold; xp levels a card up and a castle level pays egg points once', () => {
    const p = migrate(null), hand = ['ember_imp', 'golden_lion'];
    expect(payMatch(p, hand, true, 'total')).toEqual(rewardFor(true, 'total'));
    expect([p.cards.ember_imp!.xp, p.coins, p.gold]).toEqual([rewardFor(true, 'total').xp, rewardFor(true, 'total').coins, rewardFor(true, 'total').gold]);
    expect(levelUp(p, 'jade_bamboo_blade')).toBeNull(); // no xp
    for (const id of battleCardIds) p.cards[id]!.xp = progression.xpToNext[0]!;
    let castle: number[] = [];
    for (const id of battleCardIds) castle = [...castle, ...levelUp(p, id)!.castle];
    expect(levelSum(p)).toBe(battleCardIds.length * 2);
    expect(castle).toEqual(Array.from({ length: castleLevelOf(levelSum(p)) - 1 }, (_, i) => i + 2));
    expect(p.eggPoints).toBe(castle.reduce((a, lv) => a + progression.castleLevels[lv - 1]!.eggPoints, 0));
  });

  it('forge items cost coins and count only once built; town tiers cost gold; eggs cost egg points and give dupe xp', () => {
    const p = migrate(null), slot = progression.forge[0]!;
    expect(build(p, 'ember_imp', slot.id, 0)).toBe('เหรียญไม่พอ');
    p.coins = slot.coins;
    expect(build(p, 'ember_imp', slot.id, 0)).toBeNull();
    expect(p.coins).toBe(0);
    expect(progressOf(p, slot.buildSec * 1000 - 1).gear).toEqual({});
    expect(progressOf(p, slot.buildSec * 1000).gear).toEqual({ ember_imp: [slot.id] });
    expect(upgradeTown(p, 'wall')).toBe('ทองคำไม่พอ');
    p.gold = progression.wallTiers[0]!.gold;
    expect(upgradeTown(p, 'wall')).toBeNull();
    expect(progressOf(p, 0).town).toEqual({ cannon: 0, wall: 1 });
    const egg = progression.eggs[0]!;
    expect(buyEgg(p, egg.id)).toBe('แต้มไข่ไม่พอ');
    p.eggPoints = egg.cost;
    const got = buyEgg(p, egg.id) as { card: string; xp: number };
    expect([p.eggPoints, p.cards[got.card]!.dupes, p.cards[got.card]!.xp]).toEqual([0, 1, egg.dupeXp]);
    expect(aiProgress(p).levels!.ember_imp).toBe(1);
  });
});

describe('profile v6: ศึกปราบ and ศึกฝีมือ', () => {
  it('a v5 save keeps its account and starts with no stars, the starting rank and no saved match; bad entries fall back', () => {
    const p = migrate({ v: 5, coins: 40, cards: { ember_imp: { level: 7, xp: 3 } } });
    expect([p.v, p.coins, p.cards.ember_imp!.level, p.campaign, p.rank, p.lastRanked]).toEqual([6, 40, 7, {}, startRank(), null]);
    const bad = migrate({ v: 6, campaign: { '1-1': { stars: [true, 'x', true], bestSec: 70 }, '1-2': { stars: [true] }, nope: { stars: [true, true, true] } }, rank: { league: 99 }, lastRanked: { seed: 'x' } });
    expect(bad.campaign).toEqual({ '1-1': { stars: [true, false, true], bestSec: 70 } });
    expect([bad.rank, bad.lastRanked]).toEqual([startRank(), null]);
    expect(migrate({ rank: { league: 1, div: 9, stars: 99, streak: 2, points: 0 } }).rank).toEqual({ league: 1, div: leagues[1]!.divisions, stars: 0, streak: 2, points: 0 });
  });

  it('stage stars add up over tries, the best time is the fastest win, and the next stage opens once this one is won', () => {
    const p = migrate(null), ids = stages.map((s) => s.id);
    expect([stageOpen(p, ids, 0), stageOpen(p, ids, 1)]).toEqual([true, false]);
    expect(recordStage(p, ids[0]!, [false, false, false], 180)).toEqual([false, false, false]);
    expect(stageOpen(p, ids, 1)).toBe(false);
    expect(recordStage(p, ids[0]!, [true, false, true], 100)).toEqual([true, false, true]);
    expect(recordStage(p, ids[0]!, [true, true, false], 130)).toEqual([false, true, false]);
    expect(p.campaign[ids[0]!]).toEqual({ stars: [true, true, true], bestSec: 100 });
    expect(stageOpen(p, ids, 1)).toBe(true);
  });

  it('a stage win pays the stage reward, a stage loss the normal loss; a ranked result moves the rank', () => {
    const p = migrate(null), st = stages[0]!;
    expect(payMatch(p, ['ember_imp'], true, 'castle', st)).toEqual(st.rewards.win);
    expect(payMatch(p, ['ember_imp'], false, 'castle', st)).toEqual(rewardFor(false, 'castle'));
    const { before, after } = recordRanked(p, true);
    expect([before, after.stars, p.rank]).toEqual([startRank(), 1, after]);
  });
});

describe('teams', () => {
  it('the collection is every card; a sect preset draws only its disciples and the AI answers it with the next preset', () => {
    expect(teamSetup(defaultTeam()).collection).toEqual(battleCardIds);
    for (const p of PRESETS) {
      const t = presetTeam(p.id);
      expect(presetMatch(t)?.id).toBe(p.id);
      for (let seed = 1; seed <= 20; seed++) expect(createBattle(seed, teamSetup(t), teamSetup(t)).hands[0].every((c) => p.cards.includes(c))).toBe(true);
      expect(presetMatch(aiTeam(t))).toBeDefined();
    }
    expect(presetMatch(aiTeam(defaultTeam()))).toBeUndefined();
  });

  it('a broken team falls back field by field: no basic leader, no duplicate sub, a bench of known cards that are neither', () => {
    const d = defaultTeam();
    expect(fixTeam({ leader: battle.hand.basic.get('fire'), sub: d.sub, bench: ['nope', d.sub, 'lava_dragon'] })).toEqual({ ...d, bench: ['lava_dragon'] });
    expect(fixTeam({ leader: d.sub }).sub).not.toBe(d.sub);
    expect(fixTeam({ leader: 'wandering_archer', sub: 'golden_lion' })).toEqual({ leader: 'wandering_archer', sub: 'golden_lion', bench: [] });
  });

  it('a URL team is a sect preset, all or mixed, or a card list, with an optional leader and sub-leader', () => {
    expect(resolveTeam(new URLSearchParams('deck=wood'))).toEqual(presetTeam('wood'));
    expect(resolveTeam(new URLSearchParams('deck=all&leader=frost_tide_naga'))?.leader).toBe('frost_tide_naga');
    expect(resolveTeam(new URLSearchParams('deck=mixed'))).toEqual(defaultTeam());
    const list = resolveTeam(new URLSearchParams('deck=ember_imp,lava_dragon,wandering_archer&leader=lava_dragon&sub=ember_imp'))!;
    expect(teamSetup(list).collection.filter((c) => !list.bench.includes(c)).sort()).toEqual(['ember_imp', 'lava_dragon', 'wandering_archer']);
    expect(battleUnits.get(list.leader)!.kind).toBe('dragon');
    expect(resolveTeam(new URLSearchParams('deck=nope'))).toBeNull();
    expect(resolveTeam(new URLSearchParams(''))).toBeNull();
  });
});
