import { describe, expect, it } from 'vitest';
import { battle, battleCardIds, battleUnits, chapter, classesOf, COUNTER_CLASSES, progression, stageOf, stages } from '@five-sects/sim';
import ui from '../../../docs/data/ui.json';
import { lossTip, versusTip } from '../src/tips';
import { conditionTh, nextStage, UNLOCKS, unlockState } from '../src/unlocks';
import { migrate } from '../src/profile';

const winUpTo = (id: string) => Object.fromEntries(stages.slice(0, stages.findIndex((s) => s.id === id) + 1).map((s) => [s.id, { stars: [true, false, false], bestSec: 90 }]));
const state = (raw: object) => { const u = unlockState(migrate(raw)); return { open: [...u.open].sort(), next: u.next?.id ?? null }; };

describe('lobby unlocks', () => {
  it('names real stages, the real chapter and a real castle level', () => {
    for (const u of UNLOCKS) {
      if (u.stage) expect(stageOf(u.stage), u.id).toBeDefined();
      if (u.chapter) expect(u.chapter).toBe(chapter.id);
      if (u.castleLevel) expect(u.castleLevel).toBeLessThanOrEqual(progression.castleLevels.length);
    }
    expect(new Set(UNLOCKS.map((u) => u.id)).size).toBe(UNLOCKS.length);
  });

  it('opens features as ศึกปราบ stages are won, with the first locked one next', () => {
    expect(state({})).toEqual({ open: [], next: 'levelUp' });
    expect(state({ campaign: winUpTo('1-1') })).toEqual({ open: [], next: 'levelUp' });
    expect(state({ campaign: winUpTo('1-2') })).toEqual({ open: ['levelUp'], next: 'casual' });
    expect(state({ campaign: winUpTo('1-4') })).toEqual({ open: ['casual', 'forge', 'levelUp'], next: 'eggShop' });
    expect(state({ campaign: winUpTo('1-6') })).toEqual({ open: ['casual', 'forge', 'levelUp', 'ranked', 'town'], next: 'eggShop' });
  });

  it('a lost stage (no win star) opens nothing', () => {
    expect(state({ campaign: { ...winUpTo('1-1'), '1-2': { stars: [false, false, false], bestSec: null } } }).open).toEqual([]);
  });

  it('opens the egg shop at castle Lv2 from card levels alone', () => {
    const lv2 = progression.castleLevels[1]!.cardLevels, cards: Record<string, object> = {};
    battleCardIds.forEach((id, i) => { cards[id] = { level: i < lv2 - battleCardIds.length ? 2 : 1, xp: 0, dupes: 0 }; });
    expect(state({ cards }).open).toContain('eggShop');
  });

  it('an older save that already used a feature keeps it without stage wins', () => {
    const first = battleCardIds[0]!;
    const used = state({ cards: { [first]: { level: 3, xp: 0, dupes: 1 } }, forge: { [first]: { weapon: 1 } }, town: { cannon: 1, wall: 0 } });
    expect(used.open).toEqual(['eggShop', 'forge', 'levelUp', 'town']);
  });

  it('says each locked condition in Thai and points the lobby at the first stage not won', () => {
    expect(UNLOCKS.map(conditionTh)).toEqual(['ผ่านด่าน 1-2', 'ผ่านด่าน 1-3', 'ผ่านด่าน 1-4', 'ปราสาท Lv2', 'ผ่านด่าน 1-6', 'ผ่านบทที่ 1']);
    expect(nextStage(migrate({}))?.id).toBe('1-1');
    expect(nextStage(migrate({ campaign: winUpTo('1-3') }))?.id).toBe('1-4');
    expect(nextStage(migrate({ campaign: winUpTo('1-6') }))).toBeNull();
  });
});

describe('match tips', () => {
  it('ui.json names only real counter classes, each countered by some card', () => {
    expect(ui.lossTip.order.every((c) => COUNTER_CLASSES.includes(c) && battle.counterTags.has(c))).toBe(true);
    expect(Object.keys(ui.lossTip.classTh).sort()).toEqual([...ui.lossTip.order].sort());
    for (const c of ui.lossTip.order) expect(battleCardIds.some((id) => battleUnits.get(id)!.counters.includes(c)), c).toBe(true);
    expect(versusTip(7)).toBe(ui.versusTipsTh[7 % ui.versusTipsTh.length]);
  });

  it('a loss names the enemy card that hurt us most and a card of ours that counters it', () => {
    const flier = battleCardIds.find((id) => battleUnits.get(id)!.move === 'fly' && battleUnits.get(id)!.kind !== 'dragon')!;
    const ground = battleCardIds.find((id) => battleUnits.get(id)!.move === 'march')!;
    const tip = lossTip({ [ground]: 40, [flier]: 300 }, battleCardIds)!;
    expect(tip).toContain(battleUnits.get(flier)!.nameTh);
    expect(tip).toContain(battle.counterTags.get('air')!);
    const example = battleCardIds.find((id) => battleUnits.get(id)!.counters.includes('air'))!;
    expect(tip).toContain(battleUnits.get(example)!.nameTh);
    expect(classesOf(battleUnits.get(flier)!)).toContain('air');
    expect(lossTip({}, battleCardIds)).toBeNull();
    // a card with no named class (a medium support) is passed over for the next one that hurt us
    const classless = battleCardIds.find((id) => !ui.lossTip.order.some((c) => classesOf(battleUnits.get(id)!).includes(c)));
    if (classless) expect(lossTip({ [classless]: 999, [flier]: 5 }, battleCardIds)).toContain(battleUnits.get(flier)!.nameTh);
  });
});
