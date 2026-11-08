import { describe, expect, it } from 'vitest';
import {
  battle, battleCardIds, castleLevelOf, collection, createBattle, homeCard, leagues, powerRatioMaxPct, powerScore, progression, rewardFor, routeOf, stages,
  starterCards, starterTeam, startRank, tierOf, validateDeck, rankedPool,
} from '@five-sects/sim';
import { aiProgress, build, buyCard, chooseHome, claim, levelUp, payMatch, playerPower, progressOf, recordRanked, recordStage, stageOpen, upgradeTown } from '../src/camp';
import { aiSetup, benchRoom, fixTeam, rankedSetup, resolveTeam, teamSetup } from '../src/decks';
import { levelSum, migrate, type Profile } from '../src/profile';

const won = (n: number) => Object.fromEntries(stages.slice(0, n).map((s) => [s.id, { stars: [true, false, false], bestSec: 100 }]));
const fresh = (home = 'metal'): Profile => { const p = migrate(null); chooseHome(p, home); return p; };

describe('profile v7: the collection', () => {
  it('a new save has no home sect and owns only the starter cards; picking a home adds its three and leads with them', () => {
    const p = migrate(null);
    expect([p.v, p.home, p.owned, p.claimed]).toEqual([7, null, battleCardIds.filter((c) => collection.starter.includes(c)), []]);
    expect([p.coins, p.gold, p.eggPoints, p.castleLevel, p.town.cannon, p.town.wall]).toEqual([0, 0, 0, 1, 0, 0]);
    chooseHome(p, 'water');
    expect([p.home, p.owned]).toEqual(['water', starterCards('water')]);
    expect([p.team.leader, p.team.sub, p.team.bench]).toEqual([starterTeam('water').leader, starterTeam('water').sub, []]);
    chooseHome(p, 'fire');
    expect(p.home).toBe('water'); // picked once
    expect(levelSum(p)).toBe(9);
  });

  it('a v6 save (every card was owned) keeps the starter set plus every card it levelled, played, trained or forged', () => {
    const v6 = { v: 6, team: { leader: 'storm_dragon', sub: 'jade_bamboo_warden', bench: [] }, campaign: won(2),
      cards: { golden_lion: { level: 4, xp: 0, dupes: 0 }, ember_imp: { level: 1, xp: 12, dupes: 0 }, lava_dragon: { level: 1, xp: 0, dupes: 1 }, blood_bat: { level: 1, xp: 0, dupes: 0 } },
      forge: { storm_dragon: { weapon: 5 } }, settings: { volume: 40, muted: false, shake: true } };
    const p = migrate(v6);
    const kept = ['golden_lion', 'ember_imp', 'lava_dragon', 'storm_dragon'];
    expect([p.v, p.home, p.settings.volume]).toEqual([7, null, 40]);
    expect(p.owned).toEqual(battleCardIds.filter((c) => collection.starter.includes(c) || kept.includes(c)));
    expect(p.team.leader).toBe('storm_dragon'); // still owned: kept
    expect(p.owned).not.toContain('blood_bat');
    expect(claim(p)).toEqual([]); // the won stages wait for the home sect
    chooseHome(p, 'earth');
    const second = homeCard('earth', 'burst')!;
    expect(p.owned).toEqual(battleCardIds.filter((c) => collection.starter.includes(c) || kept.includes(c) || starterCards('earth').includes(c) || c === second));
    expect(p.claimed).toEqual(['1-1', '1-2']); // 1-1 paid ember_imp, already owned: its egg price instead
    expect(p.eggPoints).toBe(tierOf('ember_imp').eggPoints! + progression.castleLevels.slice(1, castleLevelOf(levelSum(p))).reduce((a, l) => a + l.eggPoints, 0));
    expect(migrate(JSON.parse(JSON.stringify(p)))).toEqual(p); // a v7 save round-trips
  });

  it('turns an old TD save or garbage into a valid profile, keeping its settings; bad numbers fall back field by field', () => {
    const old = migrate({ v: 1, consented: true, sect: 'fire', cleared: ['1-1'], settings: { volume: 30, muted: true, shake: false } });
    expect([old.home, old.settings]).toEqual([null, { volume: 30, muted: true, shake: false }]);
    expect(migrate({ deck: 'gone', settings: { volume: 500, muted: 'yes' } }).settings).toEqual({ volume: 70, muted: false, shake: true });
    expect(migrate('garbage').v).toBe(7);
    const bad = migrate({ v: 7, home: 'nope', owned: ['ember_imp', 'nope', 3], mode: 'ranked', coins: -5, gold: 1.5, cards: { ember_imp: { level: 99, xp: 10 } }, town: { cannon: 9, wall: 2 } });
    expect([bad.home, bad.owned.includes('ember_imp'), bad.owned.includes('nope'), bad.mode, bad.coins, bad.gold, bad.cards.ember_imp!.level, bad.town.cannon, bad.town.wall]).toEqual([null, true, false, 'ranked', 0, 0, 1, 0, 2]);
    const r = migrate({ v: 7, campaign: { '1-1': { stars: [true, 'x', true], bestSec: 70 }, '1-2': { stars: [true] } }, rank: { league: 99 }, lastRanked: { seed: 'x' } });
    expect([r.campaign, r.rank, r.lastRanked]).toEqual([{ '1-1': { stars: [true, false, true], bestSec: 70 } }, startRank(), null]);
    expect(migrate({ rank: { league: 1, div: 9, stars: 99, streak: 2, points: 0 } }).rank).toEqual({ league: 1, div: leagues[1]!.divisions, stars: 0, streak: 2, points: 0 });
  });
});

describe('teams over owned cards', () => {
  it('the hand is a legal deck of owned cards and loaners; ranked picks from every card', () => {
    const p = fresh(), mine = teamSetup(p.team, p.owned);
    expect(validateDeck(mine, p.owned)).toBeNull();
    expect(createBattle(1, mine, aiSetup(p.team)).hands[0].every((c) => p.owned.includes(c) || battle.deck.loaners.includes(c))).toBe(true);
    expect(validateDeck(rankedSetup(p.team), rankedPool)).toBeNull();
    expect(validateDeck(teamSetup(p.team, p.owned, 18), p.owned, 18)).toBeNull(); // the starter hand costs exactly 18
  });

  it(`a bench is only kept while ${battle.deck.pick} owned cards stay to pick from, and benched cards are not picked`, () => {
    const p = fresh();
    expect(benchRoom(p.team, p.owned)).toBeLessThan(0); // 9 cards: 2 to pick from
    expect(fixTeam({ ...p.team, bench: ['wandering_archer'] }, p.owned, p.home).bench).toEqual([]);
    const many = [...p.owned, ...battleCardIds.filter((c) => !p.owned.includes(c) && c.startsWith('frost_tide') && !c.endsWith('banner'))];
    const t = fixTeam({ ...p.team, bench: many }, many, p.home);
    expect(t.bench.length).toBe(many.filter((c) => !collection.starter.includes(c) || c === 'wandering_archer').length - 2 - battle.deck.pick);
    expect(benchRoom(t, many)).toBe(0);
    expect(teamSetup(t, many).picks.some((c) => t.bench.includes(c))).toBe(false);
  });

  it('a broken team falls back to the home starter team; a sub never equals the leader', () => {
    const p = fresh('fire');
    expect(fixTeam({ leader: 'storm_dragon', sub: 'storm_dragon' }, p.owned, p.home)).toEqual({ ...starterTeam('fire'), bench: [] });
    expect(fixTeam({ leader: 'wandering_archer', sub: 'wandering_archer' }, p.owned, p.home)).toEqual({ leader: 'wandering_archer', sub: starterTeam('fire').sub, bench: [] });
  });

  it('a URL deck names the cards a dev match draws from: a sect, all or a card list', () => {
    expect(resolveTeam(new URLSearchParams('deck=wood'))!.cards.every((c) => c.startsWith('jade_bamboo'))).toBe(true);
    expect(resolveTeam(new URLSearchParams('deck=all&leader=frost_tide_naga'))!.team.leader).toBe('frost_tide_naga');
    const list = resolveTeam(new URLSearchParams('deck=ember_imp,lava_dragon,wandering_archer&leader=lava_dragon&sub=ember_imp'))!;
    expect([list.team.leader, list.team.sub]).toEqual(['lava_dragon', 'ember_imp']);
    expect(resolveTeam(new URLSearchParams('deck=nope'))).toBeNull();
    expect(resolveTeam(new URLSearchParams(''))).toBeNull();
  });
});

describe('rewards and the egg shop', () => {
  it('a first clear pays its card once; egg-point stages pay egg points; chapter stars pay at 15 and 30', () => {
    const p = fresh('wood');
    p.campaign = won(4);
    const got = claim(p);
    expect(got.map((g) => [g.stage, g.card, g.eggPoints])).toEqual([['1-1', 'ember_imp', 0], ['1-2', homeCard('wood', 'burst'), 0], ['1-3', homeCard('wood', 'stacker'), 0], ['1-4', null, 10]]);
    expect(claim(p)).toEqual([]);
    for (const st of stages) p.campaign[st.id] = { stars: [true, true, true], bestSec: 90 };
    const stars = claim(p).filter((g) => g.stars);
    expect(stars.map((g) => [g.stars, g.eggPoints])).toEqual([['ch1:15', 10], ['ch1:30', 10]]);
    expect(p.owned).toContain(homeCard('wood', 'large'));
  });

  it('the shop sells a chosen card after 1-10 at its tier price, from its castle level; an owned one trains for its dupeXp', () => {
    const p = fresh('fire'), card = battleCardIds.find((c) => routeOf(c, 'fire').kind === 'shop' && tierOf(c).id === 'common')!;
    expect(buyCard(p, card)).toBe('ร้านไข่เปิดเมื่อผ่านด่าน 1-10');
    p.campaign = won(10);
    claim(p);
    p.eggPoints = 0;
    expect(buyCard(p, card)).toMatch(/ปราสาท|แต้มไข่/);
    for (const c of p.owned) p.cards[c]!.level = 20;
    p.eggPoints = tierOf(card).eggPoints!;
    expect(buyCard(p, card)).toEqual({ card, xp: 0 });
    expect([p.owned.includes(card), p.eggPoints, p.cards[card]!.level]).toEqual([true, 0, 1]);
    p.eggPoints = tierOf(card).eggPoints!;
    expect(buyCard(p, card)).toEqual({ card, xp: tierOf(card).dupeXp });
    expect([p.cards[card]!.dupes, p.cards[card]!.xp]).toEqual([1, tierOf(card).dupeXp]);
    expect(buyCard(p, 'cloud_sword_banner')).toBe('ไม่ขายในร้านไข่');
  });

  it('a match pays xp to the owned cards of the hand, coins and gold; a castle level pays egg points once', () => {
    const p = fresh(), hand = [...p.owned.slice(0, 3), 'golden_lion'];
    expect(payMatch(p, hand, true, 'total')).toEqual(rewardFor(true, 'total'));
    expect([p.cards[hand[0]!]!.xp, p.cards.golden_lion!.xp, p.coins]).toEqual([rewardFor(true, 'total').xp, 0, rewardFor(true, 'total').coins]);
    for (const id of p.owned) p.cards[id]!.xp = 999;
    let castle: number[] = [];
    for (let i = 0; i < 3; i++) for (const id of p.owned) castle = [...castle, ...(levelUp(p, id)?.castle ?? [])];
    expect(castle).toEqual(Array.from({ length: castleLevelOf(levelSum(p)) - 1 }, (_, i) => i + 2));
    expect(p.eggPoints).toBe(castle.reduce((a, lv) => a + progression.castleLevels[lv - 1]!.eggPoints, 0));
  });

  it('forge items cost coins and count only once built; town tiers cost gold', () => {
    const p = fresh(), slot = progression.forge[0]!, card = p.owned[0]!;
    expect(build(p, card, slot.id, 0)).toBe('เหรียญไม่พอ');
    p.coins = slot.coins;
    expect(build(p, card, slot.id, 0)).toBeNull();
    expect(progressOf(p, slot.buildSec * 1000 - 1).gear).toEqual({});
    expect(progressOf(p, slot.buildSec * 1000).gear).toEqual({ [card]: [slot.id] });
    expect(upgradeTown(p, 'wall')).toBe('ทองคำไม่พอ');
    p.gold = progression.wallTiers[0]!.gold;
    expect(upgradeTown(p, 'wall')).toBeNull();
  });

  it('the casual AI plays at the card level whose power is nearest ours, within the ratio cap', () => {
    for (const lv of [1, 5, 12, 25]) {
      const p = fresh();
      for (const c of p.owned) p.cards[c]!.level = lv;
      const ai = aiSetup(p.team), prog = aiProgress(p, ai, 0);
      const mine = playerPower(p, 0), theirs = powerScore({ ...ai, progress: prog });
      expect(Math.max(mine, theirs) * 100, `Lv${lv}: ${mine} vs ${theirs}`).toBeLessThanOrEqual(powerRatioMaxPct * Math.min(mine, theirs));
    }
  });
});

describe('ศึกปราบ and ศึกฝีมือ records', () => {
  it('stage stars add up over tries, the best time is the fastest win, and the next stage opens once this one is won', () => {
    const p = fresh(), ids = stages.map((s) => s.id);
    expect([stageOpen(p, ids, 0), stageOpen(p, ids, 1)]).toEqual([true, false]);
    expect(recordStage(p, ids[0]!, [false, false, false], 180)).toEqual([false, false, false]);
    expect(recordStage(p, ids[0]!, [true, false, true], 100)).toEqual([true, false, true]);
    expect(recordStage(p, ids[0]!, [true, true, false], 130)).toEqual([false, true, false]);
    expect(p.campaign[ids[0]!]).toEqual({ stars: [true, true, true], bestSec: 100 });
    expect(stageOpen(p, ids, 1)).toBe(true);
  });

  it('a stage win pays the stage reward, a stage loss the normal loss; a ranked result moves the rank', () => {
    const p = fresh(), st = stages[0]!;
    expect(payMatch(p, [p.owned[0]!], true, 'castle', st)).toEqual(st.rewards.win);
    expect(payMatch(p, [p.owned[0]!], false, 'castle', st)).toEqual(rewardFor(false, 'castle'));
    const { before, after } = recordRanked(p, true);
    expect([before, after.stars, p.rank]).toEqual([startRank(), 1, after]);
  });
});
