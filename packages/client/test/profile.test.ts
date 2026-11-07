import { describe, expect, it } from 'vitest';
import { battle, battleCardIds, battleUnits, createBattle } from '@five-sects/sim';
import { aiTeam, defaultTeam, fixTeam, PRESETS, presetMatch, presetTeam, resolveTeam, teamSetup } from '../src/decks';
import { migrate } from '../src/profile';

describe('profile', () => {
  it('starts with the all-cards default team and default settings, and keeps a known team', () => {
    expect(migrate(null)).toEqual({ v: 4, team: defaultTeam(), settings: { volume: 70, muted: false, shake: true } });
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
    expect(migrate({ v: 1, consented: true, sect: 'fire', cleared: ['1-1'], settings: { volume: 30, muted: true, shake: false } }))
      .toEqual({ v: 4, team: defaultTeam(), settings: { volume: 30, muted: true, shake: false } });
    expect(migrate({ deck: 'gone', settings: { volume: 500, muted: 'yes' } }).settings).toEqual({ volume: 70, muted: false, shake: true });
    expect(migrate('garbage').v).toBe(4);
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
