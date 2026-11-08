// A card as every screen describes it (battle tooltip, team screen, ค่ายฝึก, บันทึกการ์ด, ร้านไข่): the numbers come from the
// sim's unitStats with the setup and progress that screen's match would use, so what is shown is what a summon gets.
// No DOM here; battle.ts cardTip lays it out.
import { battle, battleUnits, progression, TICK_HZ, TILE, unitStats, type BattleSetup, type Progress } from '@five-sects/sim';

export interface CardInfo {
  hp: number; dmg: number;
  stats: string; // HP · ตี · role · move · size (· ตีอากาศได้)
  reach: string; // range, attacks per second, armor, target
  ability: string | null; // its ability at the level it plays on this team, or null
  desc: string; // descTh: what it does, in full
}

// One decimal place at most, no trailing zero.
const num = (x: number) => String(Math.round(x * 10) / 10);

// setup: the team the card would play in (leader, sub); p: that side's progress, null for base stats (ศึกฝีมือ).
export function cardInfo(card: string, setup: BattleSetup, p: Progress | null): CardInfo {
  const u = battleUnits.get(card)!, m = battle.moves.get(u.move)!, st = unitStats(setup, card, p);
  const target = u.hitsAir && u.hitsGround ? 'ตีได้ทั้งพื้นและฟ้า' : u.hitsAir ? 'ตีได้เฉพาะตัวบิน' : 'ตีได้เฉพาะตัวบนพื้น';
  const a = u.ability ? battle.abilities.get(u.ability.kind)! : null;
  const unlocked = st.abilityLevel === progression.abilityLevel && card !== setup.leader ? ` (ปลดที่ Lv${progression.abilityAt})` : '';
  return {
    hp: st.hp, dmg: st.dmg,
    stats: `HP ${st.hp} · ตี ${st.dmg} · ${m.roleTh} · ${m.nameTh} · ${battle.sizes.get(u.size)?.nameTh ?? u.size}${u.hitsAir ? ' · ตีอากาศได้' : ''}`,
    reach: [`ระยะ ${num(u.range / TILE)} ช่อง`, `ตี ${num(TICK_HZ / u.cooldown)} ครั้ง/วิ`, ...(u.armor > 0 ? [`เกราะ ${u.armor}`] : []), target].join(' · '),
    ability: a ? `${a.nameTh} Lv${st.abilityLevel}${unlocked}: ${a.doesTh.replace('{v}', String(st.ability))}` : null,
    desc: u.descTh,
  };
}
