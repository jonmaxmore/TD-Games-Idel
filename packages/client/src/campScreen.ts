// ค่ายฝึก: every owned card with its level and realm, the picked card's level-up and forge slots, and town upgrades (forge and town
// once unlocked). It owns its root until dispose(); main.ts decides what follows. Only owned cards are listed.
import { battleUnits, cardStats, castleLevelOf, progression, sects } from '@five-sects/sim';
import { el, realmBadge } from './battle';
import { portrait } from './board';
import { build, canLevel, forgeState, levelUp, progressOf, townTiers, upgradeTown, xpNeed, type TownKey } from './camp';
import { levelSum, type Profile } from './profile';
import { unlockState } from './unlocks';
import { cardArt } from './sprites';
import { nowrapWords } from './words';

const btn = (text: string, cls: string, onclick: () => void) => { const b = el('button', cls, text); b.onclick = onclick; return b; };
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function campScreen(app: HTMLElement, p: Profile, save: () => void, back: () => void): () => void {
  const r = el('div', 'screen camp');
  const head = el('div', 'camp-head'), purse = el('div', 'purse');
  head.append(btn('กลับ', '', back), el('h1', '', 'ค่ายฝึก'), purse);
  const grid = el('div', 'camp-cards'), detail = el('div', 'camp-detail panel'), side = el('div', 'camp-side');
  const town = el('div', 'panel town'), note = el('p', 'camp-note');
  const open = unlockState(p).open;
  side.append(town);
  const body = el('div', 'camp-body');
  body.append(grid, detail);
  if (open.has('town')) body.append(side);
  r.append(head, body, note);
  app.append(r);
  let pick = p.team.leader;
  const say = (msg: string, bad = false) => { note.textContent = msg; note.classList.toggle('bad', bad); };
  const act = (msg: string | null, ok: string) => { if (msg) say(msg, true); else { save(); say(ok); } show(); };

  const tile = (id: string) => {
    const u = battleUnits.get(id)!, c = p.cards[id]!, t = btn('', `camp-card${id === pick ? ' sel' : ''}${canLevel(p, id) ? ' ready' : ''}`, () => { pick = id; show(); });
    t.dataset.id = id;
    t.style.borderColor = sects.get(u.sect)?.color ?? '#E3B04B';
    const face = el('span', 'face');
    face.append(cardArt(id) ?? portrait(id));
    const need = xpNeed(c.level), bar = el('span', 'xp'), fill = el('i');
    fill.style.width = `${need == null ? 100 : Math.min(100, (100 * c.xp) / need)}%`;
    bar.append(fill);
    t.append(face, realmBadge(c.level), nowrapWords(el('b'), u.nameTh), bar);
    return t;
  };

  function showDetail(now: number) {
    const u = battleUnits.get(pick)!, c = p.cards[pick]!, need = xpNeed(c.level);
    const st = cardStats(u, progressOf(p, now));
    const face = el('span', 'face big');
    face.append(cardArt(pick) ?? portrait(pick));
    const lvl = btn(need == null ? 'ขั้นสูงสุดแล้ว' : `เลื่อนขั้น (ใช้ ${need} แต้มฝึก)`, 'primary level-up', () => {
      const res = levelUp(p, pick);
      if (!res) return act('แต้มฝึกยังไม่พอ', '');
      const up = res.castle.length > 0 ? ` · ปราสาทขึ้น Lv${castleLevelOf(levelSum(p))} ได้แต้มไข่ ${res.castle.reduce((a, lv) => a + progression.castleLevels[lv - 1]!.eggPoints, 0)}` : '';
      act(null, `${u.nameTh} ขึ้น Lv${p.cards[pick]!.level}${up}`);
    });
    lvl.disabled = !canLevel(p, pick);
    const slots = el('div', 'slots');
    for (const f of progression.forge) {
      const s = forgeState(p, pick, f.id, now), bonus = [f.hpPct ? `HP +${f.hpPct}%` : '', f.dmgPct ? `ตี +${f.dmgPct}%` : ''].filter(Boolean).join(' ');
      const b = btn('', `slot ${s.k}`, () => act(build(p, pick, f.id, Date.now()), `เริ่มหลอม${f.itemTh}`));
      b.dataset.slot = f.id;
      b.append(el('b', '', f.nameTh), el('small', '', f.itemTh), el('small', 'bonus', bonus),
        el('span', 'state', s.k === 'built' ? 'หลอมแล้ว' : s.k === 'building' ? `กำลังหลอม ${mmss(s.leftSec)}` : `${f.coins} เหรียญ · ${mmss(f.buildSec)}`));
      b.disabled = s.k !== 'none';
      slots.append(b);
    }
    detail.replaceChildren(face, realmBadge(c.level), nowrapWords(el('h2'), u.nameTh),
      el('p', 'stats', `HP ${st.hp} · ตี ${st.dmg} (ฐาน HP ${u.hp} · ตี ${u.dmg})`),
      el('p', 'dim', need == null ? 'ถึงขั้นจิตก่อรูปแล้ว' : `แต้มฝึก ${c.xp}/${need}${c.dupes > 0 ? ` · ไข่ฝึก ${c.dupes} ครั้ง` : ''}`),
      lvl, ...(open.has('forge') ? [el('h3', '', 'โรงหลอม'), el('p', 'dim small', 'อุปกรณ์ที่หลอมแล้วให้ค่าสถานะแม้ไม่สวม'), slots] : []),
      el('p', 'dim small', 'ศึกฝีมือ (จัดอันดับ) ใช้ค่าพื้นฐานเท่ากันทุกตัว ไม่นับเลเวลและอุปกรณ์'));
  }

  function showTown() {
    town.replaceChildren(el('h3', '', 'เมือง'));
    for (const [k, name] of [['cannon', progression.cannonNameTh], ['wall', progression.wallNameTh]] as [TownKey, string][]) {
      const tiers = townTiers(k), at = p.town[k], next = tiers[at];
      const now = at === 0 ? 'ระดับพื้นฐาน' : k === 'cannon' ? `ตี +${progression.cannonTiers[at - 1]!.dmg} · ผลักไกลขึ้น` : `HP ปราสาท +${progression.wallTiers[at - 1]!.hp}`;
      const b = btn(next ? `อัปเกรด (${next.gold} ทองคำ)` : 'สูงสุดแล้ว', 'up', () => act(upgradeTown(p, k), `${name} ขึ้นระดับ ${p.town[k]}`));
      b.dataset.town = k;
      b.disabled = !next;
      const row = el('div', 'town-row');
      row.append(el('b', '', `${name} ระดับ ${at}/${tiers.length}`), el('small', '', now), b);
      town.append(row);
    }
  }

  function show() {
    const now = Date.now(), sum = levelSum(p), cl = castleLevelOf(sum), next = progression.castleLevels[cl];
    purse.replaceChildren(
      el('span', 'castle-lv', `ปราสาท Lv${cl}`), el('small', 'dim', next ? `เลเวลรวม ${sum}/${next.cardLevels}${next.unlockTh ? ` · ปลด${next.unlockTh}` : ''}` : `เลเวลรวม ${sum}`),
      el('span', 'coin', `เหรียญ ${p.coins}`), el('span', 'gold', `ทองคำ ${p.gold}`), el('span', 'egg', `แต้มไข่ ${p.eggPoints}`));
    grid.replaceChildren(...p.owned.map(tile));
    showDetail(now);
    showTown();
  }
  show();
  // Forge timers count down while the screen is open.
  const timer = setInterval(() => { if (Object.values(p.forge).some((f) => Object.values(f).some((t) => t > Date.now() - 1000))) showDetail(Date.now()); }, 1000);
  return () => { clearInterval(timer); r.remove(); };
}
