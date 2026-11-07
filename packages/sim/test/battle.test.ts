// Castle battle (SPEC-castle-battle §11): the six rule tests, determinism, the bot balance gate and the golden.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  battle, battleHash, battleUnits, BATTLE_LEN, createBattle, decide, fwd, stepBattle, summonZone,
  type BattleCommand, type BattleState, type Side,
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
    }
  });
});

describe('castle battle rules', () => {
  it('mana regenerates one point per 5 s, then 4 s, then 3 s: 47 over the match on top of the 5 at start', () => {
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
    expect(gainedAt.filter((t) => t > 2400).length).toBe(20);
    expect(gainedAt[13]! - gainedAt[12]!).toBe(80);
    expect(gainedAt[28]! - gainedAt[27]!).toBe(60);
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
    expect(decide(s)).toBe(-1);
    s.castles[0].hp = 2999;
    expect(decide(s)).toBe(1);
    s.castles[0].hp = 3000;
    s.forts[0]!.owner = 0; s.forts[2]!.owner = 1; // one fort each, at equal depth
    expect(decide(s)).toBe(-1);
    s.forts[1]!.owner = 1;
    expect(decide(s)).toBe(1); // more forts
    s.forts[1]!.owner = 0; s.forts[0]!.owner = 1; // 1 holds forts 0 and 2, 0 holds the middle: 2 vs 1
    expect(decide(s)).toBe(1);
    s.forts[0]!.owner = null; // 0: middle (depth 50%), 1: fort 2 (depth 30%)
    expect(decide(s)).toBe(0);
    s.forts[1]!.owner = null; s.forts[2]!.owner = null;
    s.mana[1] = 6;
    expect(decide(s)).toBe(1);
    s.mana[1] = 5;
    stepBattle(s, [summon(0, BLADE, 0)]);
    s.mana = [5, 5];
    expect(decide(s)).toBe(0);
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
  it('rush vs defend on mirror decks, 200 seeds, both side orders: left wins 45-55%, draws at most 10%', () => {
    const SEEDS = 200;
    let left = 0, draws = 0, games = 0;
    for (const [p0, p1] of [['rush', 'defend'], ['defend', 'rush']] as [Policy, Policy][])
      for (let seed = 1; seed <= SEEDS; seed++) {
        const w = playBattle(seed, p0, p1).state.winner;
        games++;
        if (w === 0) left++;
        if (w === -1) draws++;
      }
    expect((left * 100) / games).toBeGreaterThanOrEqual(45);
    expect((left * 100) / games).toBeLessThanOrEqual(55);
    expect((draws * 100) / games).toBeLessThanOrEqual(10);
  });
});
