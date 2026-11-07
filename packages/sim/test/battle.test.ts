// Castle battle (SPEC-castle-battle §11): the six rule tests, determinism, the bot balance gate and the golden.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  battle, battleHash, battleUnits, BATTLE_LEN, createBattle, decide, decision, fwd, stepBattle, summonZone, TICK_HZ,
  sects, type BattleCommand, type BattleEvent, type BattleState, type BattleUnitDef, type Fighter, type Side,
} from '../src';
import { DECK, playBattle, type Policy } from './battleBot';
import { BATTLE_GOLDEN, battleGolden, replayBattle, type BattleGolden } from './goldens';

const STRIKER = 'crimson_phoenix_striker', BANNER = 'crimson_phoenix_banner', BLADE = 'jade_bamboo_blade';
const fresh = () => createBattle(1, DECK, DECK);
const summon = (side: Side, card: string, d: number): BattleCommand => ({ t: 'summon', side, card, d });
const run = (s: BattleState, n: number) => { for (let i = 0; i < n; i++) stepBattle(s); };

describe('castle battle data', () => {
  it('every card has a move, a known size with its mana inside the band, and HP', () => {
    for (const u of battleUnits.values()) {
      const size = battle.sizes.get(u.size);
      expect(size, u.id).toBeDefined();
      expect(u.mana >= size!.min && u.mana <= size!.max, `${u.id} mana ${u.mana}`).toBe(true);
      expect(battle.speed.has(u.move), u.id).toBe(true);
      expect(u.hp, u.id).toBeGreaterThan(0);
      expect(sects.has(u.sect), u.id).toBe(true);
      expect(u.tagTh.length, `${u.id} tagTh`).toBeGreaterThan(0);
      for (const c of u.counters) expect(battle.counterTags.has(c), `${u.id} counters ${c}`).toBe(true);
    }
  });

  it('each preset sect deck is 8 distinct cards of that sect only', () => {
    for (const [sect, deck] of battle.sectDecks) {
      expect(new Set(deck).size, sect).toBe(8);
      for (const c of deck) expect(battleUnits.get(c)?.sect, `${sect} deck has ${c}`).toBe(sect);
    }
  });
});

// A test card made from the blade with some fields changed, removed again after fn.
function withCard(id: string, fields: Partial<BattleUnitDef>, fn: () => void): void {
  battleUnits.set(id, { ...battleUnits.get(BLADE)!, id, ...fields });
  try { fn(); } finally { battleUnits.delete(id); }
}
// Side 0's card at depth a, side 1's at depth b (own depths), both with plenty of mana.
function duel(c0: string, a: number, c1: string, b: number): BattleState {
  const s = createBattle(1, [c0], [c1]);
  s.mana = [20, 20];
  stepBattle(s, [summon(0, c0, 0), summon(1, c1, 0)]);
  s.units[0]!.d = fwd(0, a); s.units[1]!.d = fwd(1, b);
  return s;
}
const hitIds = (ev: BattleEvent[], from: number) => ev.filter((e) => e.e === 'hit' && e.from === from).map((e) => e.to);

describe('castle battle on-hit kits', () => {
  it('splash lands the hit on every enemy near the target, not on ones further off', () => {
    withCard('t_splash', { splash: 1000, range: 3000, cooldown: 1 }, () => {
      const s = createBattle(1, ['t_splash'], [BLADE]);
      s.mana = [20, 20];
      stepBattle(s, [summon(0, 't_splash', 0), summon(1, BLADE, 0), summon(1, BLADE, 0), summon(1, BLADE, 0)]);
      const [me, a, b, c] = s.units as [Fighter, Fighter, Fighter, Fighter];
      me.d = 2000; a.d = 4000; b.d = 4800; c.d = 6500;
      const ev = stepBattle(s);
      expect(hitIds(ev, me.id).sort()).toEqual([a.id, b.id].sort());
    });
  });

  it('a rooted unit stops walking but still fights; a slowed one walks slowPct slower', () => {
    withCard('t_root', { rootSec: undefined, root: 40, range: 1000, cooldown: 1000, move: 'guard' } as Partial<BattleUnitDef>, () => {
      const s = duel('t_root', 6000, BLADE, BATTLE_LEN - 6900);
      stepBattle(s);
      const blade = s.units[1]!;
      expect(blade.rootT).toBe(40);
      const d = blade.d;
      run(s, 10);
      expect(blade.d).toBe(d);
      s.units[0]!.d = blade.d - 500; // now in its reach while still rooted
      const hits: number[] = [];
      for (let i = 0; i < 20; i++) hits.push(...hitIds(stepBattle(s), blade.id).map(Number));
      expect(blade.rootT).toBeGreaterThan(0);
      expect(hits).toContain(s.units[0]!.id);
    });
    withCard('t_slow', { slow: 400, range: 1000, cooldown: 1000, move: 'guard', dmg: 1 }, () => {
      const s = duel('t_slow', 6000, BLADE, BATTLE_LEN - 6900);
      stepBattle(s);
      const blade = s.units[1]!;
      s.units[0]!.d = 0; // walk away from the guard so the blade keeps walking
      const d = blade.d;
      run(s, 20);
      const step = battle.speed.get('march')!;
      expect(d - blade.d).toBe(20 * Math.floor((step * (100 - battle.slowPct)) / 100));
    });
  });

  it('a stun freezes the target; a push knocks it back, but never a large unit', () => {
    withCard('t_stun', { stun: 30, range: 1000, cooldown: 1000, move: 'guard', dmg: 1 }, () => {
      const s = duel('t_stun', 6000, BLADE, BATTLE_LEN - 6900);
      stepBattle(s);
      expect(s.units[1]!.stunT).toBe(30);
    });
    withCard('t_push', { push: 1000, range: 1000, cooldown: 1000, move: 'guard', dmg: 1 }, () => {
      const s = duel('t_push', 6000, BLADE, BATTLE_LEN - 6700);
      const before = s.units[1]!.d;
      stepBattle(s);
      expect(s.units[1]!.d - before).toBe(1000);
    });
    withCard('t_push', { push: 1000, range: 1000, cooldown: 1000, move: 'guard', dmg: 1 }, () => {
      withCard('t_big', { size: 'large', hp: 2000, move: 'guard' }, () => {
        const s = duel('t_push', 6000, 't_big', BATTLE_LEN - 6700);
        const before = s.units[1]!.d;
        stepBattle(s);
        expect(s.units[1]!.d).toBe(before);
      });
    });
  });

  it('burning ground sets ground walkers on it burning, not fliers, and goes out', () => {
    withCard('t_fire', { ground: 20, range: 1000, cooldown: 1000, move: 'guard', dmg: 1, dot: null }, () => {
      withCard('t_fly', { move: 'fly', dmg: 0, hp: 500 }, () => {
        const s = createBattle(1, ['t_fire'], [BLADE, 't_fly']);
        s.mana = [20, 20];
        stepBattle(s, [summon(0, 't_fire', 0), summon(1, BLADE, 0), summon(1, 't_fly', 0)]);
        const [me, blade, fly] = s.units as [Fighter, Fighter, Fighter];
        me.d = 6000; blade.d = 6900; fly.d = 6900; blade.side = 1;
        stepBattle(s);
        expect(s.zones.length).toBe(1);
        expect(blade.burnT).toBe(0); // the hit itself (dot null) does not burn; the ground does next tick
        stepBattle(s);
        expect(blade.burnT).toBe(battle.burnTicks - 1); // set by the ground, then this tick's countdown
        expect(fly.burnT).toBe(0);
        run(s, 25);
        expect(s.zones.length).toBe(0);
      });
    });
  });

  it('armor takes a flat amount off each hit (at least 1 gets through); pierce ignores it', () => {
    withCard('t_wall', { armor: 10, move: 'guard', hp: 1000, dmg: 0 }, () => {
      const hitFor = (attacker: string) => {
        const s = duel(attacker, 6000, 't_wall', BATTLE_LEN - 6500);
        return stepBattle(s).find((e) => e.e === 'hit' && e.to === s.units[1]!.id)!.dmg;
      };
      withCard('t_a', { dmg: 14, kit: 'earth', dot: null }, () => expect(hitFor('t_a')).toBe(4));
      withCard('t_b', { dmg: 5, kit: 'earth', dot: null }, () => expect(hitFor('t_b')).toBe(1));
      withCard('t_c', { dmg: 14, kit: 'earth', dot: null, pierce: true }, () => expect(hitFor('t_c')).toBe(14));
    });
  });
});

describe('castle battle rules', () => {
  it('mana regenerates one point per 5 s, then 4 s, then 2 s: 57 over the match on top of the 5 at start', () => {
    const s = fresh();
    expect(s.mana).toEqual([battle.manaStart, battle.manaStart]);
    const gainedAt: number[] = [];
    s.mana = [0, 0];
    while (s.winner === null) {
      stepBattle(s);
      if (s.mana[0] > 0) { gainedAt.push(s.tick); s.mana = [0, 0]; }
    }
    expect(gainedAt[0]).toBe(100);
    expect(gainedAt.filter((t) => t <= 1200).length).toBe(12);
    expect(gainedAt.filter((t) => t > 1200 && t <= 2400).length).toBe(15);
    expect(gainedAt.filter((t) => t > 2400).length).toBe(30);
    expect(gainedAt[13]! - gainedAt[12]!).toBe(80);
    expect(gainedAt[28]! - gainedAt[27]!).toBe(40);
    const capped = fresh();
    run(capped, 2000);
    expect(capped.mana[0]).toBe(battle.manaMax);
  });

  it('a medium card cannot be summoned past its per-match cap; small cards have none', () => {
    const s = fresh();
    s.mana = [99, 99];
    const cap = battle.sizes.get('medium')!.perMatch!;
    for (let i = 0; i < cap; i++) expect(stepBattle(s, [summon(0, STRIKER, 0)]).some((e) => e.e === 'error')).toBe(false);
    expect(stepBattle(s, [summon(0, STRIKER, 0)]).find((e) => e.e === 'error')?.msg).toBe('card used up');
    for (let i = 0; i < cap + 2; i++) stepBattle(s, [summon(0, BLADE, 0)]);
    expect(s.units.filter((u) => u.card === BLADE).length).toBe(cap + 2);
    expect(s.units.filter((u) => u.card === STRIKER).length).toBe(cap);
  });

  it('rejects summons outside the zone, without mana or off-deck, and the zone stops short of enemies', () => {
    const s = fresh();
    const zone = summonZone(s, 0);
    expect(zone).toBe(Math.floor((BATTLE_LEN * 25) / 100));
    const msgs = (c: BattleCommand) => stepBattle(s, [c]).filter((e) => e.e === 'error').map((e) => e.msg);
    expect(msgs(summon(0, BLADE, zone + 1))).toEqual(['outside summon zone']);
    expect(msgs(summon(1, BLADE, -1))).toEqual(['outside summon zone']);
    expect(msgs(summon(0, 'not_a_card', 0))).toEqual(['card not in deck']);
    s.mana[0] = 0;
    expect(msgs(summon(0, BLADE, 0))).toEqual(['not enough mana']);
    s.mana = [20, 20];
    expect(msgs(summon(1, BLADE, zone))).toEqual([]);
    expect(s.units[0]!.home).toBe(BATTLE_LEN - zone); // side 1 measures from its own castle
    s.units[0]!.d = 3000; // an enemy deep in side 0's zone
    expect(summonZone(s, 0)).toBe(3000 - battle.summonGap);
    expect(msgs(summon(0, BLADE, 2500))).toEqual(['outside summon zone']);
    expect(s.mana[0]).toBe(20);
  });

  it('the castle gate stays open with enemies on it: a summon at depth 0 lands and fights', () => {
    const s = createBattle(1, [BLADE], [BLADE]);
    s.mana = [20, 20];
    stepBattle(s, [summon(1, BLADE, 0), summon(1, BLADE, 0)]);
    for (const u of s.units) u.d = 300; // at side 0's castle
    expect(summonZone(s, 0)).toBe(battle.homeZone);
    const ev = stepBattle(s, [summon(0, BLADE, 0)]);
    expect(ev.find((e) => e.e === 'error')).toBeUndefined();
    const mine = s.units.find((u) => u.side === 0)!;
    const hits: number[] = [];
    for (let i = 0; i < 20; i++) for (const e of stepBattle(s)) if (e.e === 'hit' && e.from === mine.id) hits.push(e.to!);
    expect(hits.length).toBeGreaterThan(0);
    expect(stepBattle(s, [summon(0, BLADE, battle.homeZone + 1)]).find((e) => e.e === 'error')?.msg).toBe('outside summon zone');
  });

  it('a capture unit takes a neutral fort after holding it and the summon zone grows to it', () => {
    const s = fresh();
    stepBattle(s, [summon(0, BANNER, summonZone(s, 0))]);
    const fort = s.forts[0]!;
    let ticks = 0;
    while (fort.owner === null && ticks++ < 400) stepBattle(s);
    expect(fort.owner).toBe(0);
    expect(summonZone(s, 0)).toBe(fwd(0, fort.d));
    expect(summonZone(s, 1)).toBe(Math.floor((BATTLE_LEN * 25) / 100));
  });

  it('a capture is blocked while an enemy stands on the fort', () => {
    const s = fresh();
    stepBattle(s, [summon(0, BANNER, summonZone(s, 0))]);
    const u = s.units[0]!;
    u.d = s.forts[0]!.d;
    s.units.push({ ...u, id: 99, side: 1, card: 'crimson_phoenix_control', hp: 9999, maxHp: 9999, cd: 9999 });
    u.hp = u.maxHp = 9999;
    run(s, battle.forts.captureTicks * 3);
    expect(s.forts[0]!.owner).toBe(null);
  });

  it('the match ends as soon as a castle falls', () => {
    const s = fresh();
    s.castles[1].hp = 0;
    const ev = stepBattle(s);
    expect(s.winner).toBe(0);
    expect(ev.find((e) => e.e === 'end')?.side).toBe(0);
    const tick = s.tick;
    expect(stepBattle(s, [summon(0, BLADE, 0)])).toEqual([]);
    expect(s.tick).toBe(tick);
  });

  it('ties at time break on forts held, deepest fort, mana left, units alive, then draw', () => {
    const s = fresh();
    expect(decision(s)).toEqual({ winner: -1, step: null });
    s.castles[0].hp = battle.castle.hp - 1;
    expect(decision(s)).toEqual({ winner: 1, step: 'castle' });
    s.castles[0].hp = battle.castle.hp;
    s.forts[0]!.owner = 0; s.forts[2]!.owner = 1; // one fort each, at equal depth
    expect(decide(s)).toBe(-1);
    s.forts[1]!.owner = 1;
    expect(decision(s)).toEqual({ winner: 1, step: 'forts' });
    s.forts[1]!.owner = 0; s.forts[0]!.owner = 1; // 1 holds forts 0 and 2, 0 holds the middle: 2 vs 1
    expect(decide(s)).toBe(1);
    s.forts[0]!.owner = null; // 0: middle (depth 50%), 1: fort 2 (depth 30%)
    expect(decision(s)).toEqual({ winner: 0, step: 'deepest' });
    s.forts[1]!.owner = null; s.forts[2]!.owner = null;
    s.mana[1] = 6;
    expect(decision(s)).toEqual({ winner: 1, step: 'mana' });
    s.mana[1] = 5;
    stepBattle(s, [summon(0, BLADE, 0)]);
    s.mana = [5, 5];
    expect(decision(s)).toEqual({ winner: 0, step: 'units' });
    s.tick = battle.matchTicks - 1;
    stepBattle(s);
    expect(s.winner).toBe(0);
  });

  it('the castle bell stuns every enemy in our half, once a match', () => {
    const s = fresh();
    s.mana = [20, 20];
    stepBattle(s, [summon(1, BLADE, 0), summon(1, STRIKER, 0)]);
    s.units[0]!.d = BATTLE_LEN / 2; s.units[1]!.d = BATTLE_LEN / 2 + 1;
    const ev = stepBattle(s, [{ t: 'art', side: 0 }]);
    expect(ev.filter((e) => e.e === 'stun').map((e) => e.id)).toEqual([s.units[0]!.id]);
    expect(stepBattle(s, [{ t: 'art', side: 0 }]).find((e) => e.e === 'error')?.msg).toBe('art used');
  });

  it('a flier walks over ground enemies and only units that hit air can hit it', () => {
    battleUnits.set('test_fly', { ...battleUnits.get(BLADE)!, id: 'test_fly', move: 'fly', hp: 500 });
    try {
      const s = createBattle(1, ['test_fly'], ['jade_bamboo_control']); // control: ground only
      s.mana = [20, 20];
      stepBattle(s, [summon(0, 'test_fly', 0), summon(1, 'jade_bamboo_control', 2000)]);
      const [fly, guard] = [s.units[0]!, s.units[1]!];
      const hits: number[] = [];
      for (let i = 0; i < 330; i++) for (const e of stepBattle(s)) if (e.e === 'hit' && e.to === fly.id) hits.push(e.from!);
      expect(fly.d).toBeGreaterThan(guard.d);
      expect(hits.includes(guard.id)).toBe(false);
    } finally {
      battleUnits.delete('test_fly');
    }
  });
});

describe('cheap counters expensive (reference §1c)', () => {
  // Side 0 sends one large card from the front of its base zone; side 1 answers with one cheap card. 60 s, no forts held.
  const castleLoss = (big: string, answer: string | null) => {
    const s = createBattle(1, [big], answer ? [answer] : [BLADE]);
    s.mana = [20, 20];
    stepBattle(s, [summon(0, big, 4000), ...(answer ? [summon(1, answer, 3000)] : [])]);
    run(s, 1200);
    return battle.castle.hp - s.castles[1].hp;
  };
  it('a 3-mana guard that hits air takes more than half off what the 8-mana phoenix does to the castle', () => {
    expect(castleLoss('crimson_phoenix_beast', 'crimson_phoenix_control') * 2).toBeLessThan(castleLoss('crimson_phoenix_beast', null));
  });
  it('a 4-mana single-target striker kills the 8-mana bamboo warden that lives through the castle alone', () => {
    const survives = (answer: string | null) => {
      const s = createBattle(1, ['jade_bamboo_warden'], answer ? [answer] : [BLADE]);
      s.mana = [20, 20];
      stepBattle(s, [summon(0, 'jade_bamboo_warden', 4000), ...(answer ? [summon(1, answer, 3000)] : [])]);
      const id = s.units[0]!.id;
      run(s, 1200);
      return s.units.some((u) => u.id === id);
    };
    expect(survives(null)).toBe(true);
    expect(survives('jade_bamboo_striker')).toBe(false);
  });
});

describe('castle battle determinism', () => {
  it('two runs of the same seed and commands hash the same every tick', () => {
    const { commands } = playBattle(3, 'rush', 'defend');
    const a: string[] = [], b: string[] = [];
    replayBattle(3, [DECK, DECK], commands, (s) => a.push(battleHash(s)));
    replayBattle(3, [DECK, DECK], commands, (s) => b.push(battleHash(s)));
    expect(a.length).toBeGreaterThan(1000);
    expect(a).toEqual(b);
  });

  it('the committed golden is up to date and replays to its hashes', () => {
    const g = JSON.parse(readFileSync(BATTLE_GOLDEN, 'utf8')) as BattleGolden;
    expect(JSON.stringify(battleGolden(g.seed), null, 1) + '\n' === readFileSync(BATTLE_GOLDEN, 'utf8'), 'battle-1.json is stale: run npm run sim:golden').toBe(true);
    let i = 0;
    const end = replayBattle(g.seed, g.decks, g.commands, (s) => {
      if (s.tick % 100 === 0) expect(battleHash(s), `tick ${s.tick}`).toBe(g.trace[i++]![1]);
    });
    expect(battleHash(end)).toBe(g.final.hash);
  });
});

describe('castle battle balance', () => {
  it('rush vs defend on mirror decks, 200 seeds, both side orders: left wins 45-55%, draws at most 5%, a castle falls in 40-60%, 120-170 s', () => {
    const SEEDS = 200;
    let left = 0, draws = 0, games = 0, ko = 0, ticks = 0;
    for (const [p0, p1] of [['rush', 'defend'], ['defend', 'rush']] as [Policy, Policy][])
      for (let seed = 1; seed <= SEEDS; seed++) {
        const s = playBattle(seed, p0, p1).state, w = s.winner;
        games++;
        ticks += s.tick;
        if (s.castles[0].hp <= 0 || s.castles[1].hp <= 0) ko++;
        if (w === 0) left++;
        if (w === -1) draws++;
      }
    expect((left * 100) / games).toBeGreaterThanOrEqual(45);
    expect((left * 100) / games).toBeLessThanOrEqual(55);
    expect((draws * 100) / games).toBeLessThanOrEqual(5);
    expect((ko * 100) / games).toBeGreaterThanOrEqual(40);
    expect((ko * 100) / games).toBeLessThanOrEqual(60);
    expect(ticks / games / TICK_HZ).toBeGreaterThanOrEqual(120);
    expect(ticks / games / TICK_HZ).toBeLessThanOrEqual(170);
  });
});
