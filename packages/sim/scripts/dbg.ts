import { createBattle, fixedHand, stepBattle } from '../src';
for (const ans of [null, 'jade_bamboo_striker']) {
  const s = createBattle(1, fixedHand(['jade_bamboo_warden']), fixedHand(ans ? [ans] : ['jade_bamboo_blade']));
  s.mana = [20, 20];
  stepBattle(s, [{ t: 'summon', side: 0, card: 'jade_bamboo_warden', d: 4000 }, ...(ans ? [{ t: 'summon' as const, side: 1 as const, card: ans, d: 3000 }] : [])]);
  const id = s.units[0]!.id;
  let dealt = 0, last = 0;
  for (let i = 0; i < 1200; i++) {
    for (const e of stepBattle(s)) if (e.e === 'hit' && e.to === id) dealt += e.dmg!;
    const w = s.units.find((u) => u.id === id);
    if (!w) { console.log('dead at', i); break; }
    last = w.hp;
  }
  console.log(ans, 'hp left', last, 'castle1', s.castles[1].hp, 'dealt', dealt, s.units.map((u) => u.card + ':' + u.hp));
}
