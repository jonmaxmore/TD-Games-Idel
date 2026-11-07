import { describe, expect, it } from 'vitest';
import { battle, battleUnits } from '@five-sects/sim';
import { COLLECTIONS, defaultTeam, fixTeam, resolveTeam, teamSetup } from '../src/decks';
import { migrate } from '../src/profile';

describe('profile', () => {
  it('starts with the first collection\'s default team and default settings, and keeps a known team', () => {
    expect(migrate(null)).toEqual({ v: 3, team: defaultTeam(COLLECTIONS[0]!.id), settings: { volume: 70, muted: false, shake: true } });
    const team = { collection: 'wood', leader: 'jade_bamboo_crane', sub: 'jade_bamboo_warden', bench: ['jade_bamboo_support'] };
    expect(migrate({ team }).team).toEqual(team);
    expect(migrate({ v: 2, deck: 'water' }).team).toEqual(defaultTeam('water')); // an old deck save keeps its sect
  });

  it('turns an old TD save or an unknown team into a valid profile, keeping its settings', () => {
    expect(migrate({ v: 1, consented: true, sect: 'fire', cleared: ['1-1'], settings: { volume: 30, muted: true, shake: false } }))
      .toEqual({ v: 3, team: defaultTeam(COLLECTIONS[0]!.id), settings: { volume: 30, muted: true, shake: false } });
    expect(migrate({ deck: 'gone', settings: { volume: 500, muted: 'yes' } }).settings).toEqual({ volume: 70, muted: false, shake: true });
    expect(migrate('garbage').v).toBe(3);
  });
});

describe('teams', () => {
  it('every collection has a default team of its own cards and names an opponent collection that exists', () => {
    for (const c of COLLECTIONS) {
      const t = defaultTeam(c.id);
      expect(c.cards).toContain(t.leader);
      expect(c.cards).toContain(t.sub);
      expect(t.leader).not.toBe(t.sub);
      expect(COLLECTIONS.some((x) => x.id === c.vs)).toBe(true);
    }
  });

  it('a broken team falls back field by field: no basic or foreign leader, no duplicate sub, a bench of its own cards only', () => {
    const d = defaultTeam('fire');
    expect(fixTeam({ collection: 'fire', leader: battle.hand.basic.get('fire'), sub: 'jade_bamboo_warden', bench: ['nope', d.leader, 'crimson_phoenix_kite'] }))
      .toEqual({ ...d, bench: ['crimson_phoenix_kite'] });
    expect(fixTeam({ collection: 'fire', leader: d.sub }).sub).not.toBe(d.sub);
    expect(teamSetup(d).collection.every((c) => battleUnits.get(c)!.sect === 'fire')).toBe(true);
  });

  it('a URL team is a collection id with an optional leader and sub-leader', () => {
    expect(resolveTeam(new URLSearchParams('deck=wood'))).toEqual(defaultTeam('wood'));
    expect(resolveTeam(new URLSearchParams('deck=all&leader=frost_tide_naga'))?.leader).toBe('frost_tide_naga');
    expect(resolveTeam(new URLSearchParams('deck=nope'))).toBeNull();
    expect(resolveTeam(new URLSearchParams(''))).toBeNull();
  });
});
