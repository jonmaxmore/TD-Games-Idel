import { describe, expect, it } from 'vitest';
import { DECKS, resolveDeck } from '../src/decks';
import { migrate } from '../src/profile';

describe('profile', () => {
  it('starts with the first deck and default settings, and keeps a known deck', () => {
    expect(migrate(null)).toEqual({ v: 2, deck: DECKS[0]!.id, settings: { volume: 70, muted: false, shake: true } });
    expect(migrate({ deck: 'mixed' }).deck).toBe('mixed');
  });

  it('turns an old TD save or an unknown deck into a valid profile, keeping its settings', () => {
    expect(migrate({ v: 1, consented: true, sect: 'fire', cleared: ['1-1'], settings: { volume: 30, muted: true, shake: false } }))
      .toEqual({ v: 2, deck: DECKS[0]!.id, settings: { volume: 30, muted: true, shake: false } });
    expect(migrate({ deck: 'gone', settings: { volume: 500, muted: 'yes' } }).settings).toEqual({ volume: 70, muted: false, shake: true });
    expect(migrate('garbage').v).toBe(2);
  });
});

describe('decks', () => {
  it('every deck holds 8 known cards and names an opponent deck that exists', () => {
    for (const d of DECKS) {
      expect(d.cards).toHaveLength(8);
      expect(DECKS.some((x) => x.id === d.vs)).toBe(true);
    }
  });

  it('a URL deck is a choice id or a card list; unknown cards are dropped', () => {
    expect(resolveDeck('wood')?.id).toBe('wood');
    expect(resolveDeck('crimson_phoenix_blade,nope')?.cards).toEqual(['crimson_phoenix_blade']);
    expect(resolveDeck('nope')).toBeNull();
    expect(resolveDeck(null)).toBeNull();
  });
});
