// The lobby, the player's home (ui-flow.md §2.2): the purse and profile chip on top, our castle in the middle (it grows with
// the castle level), one primary button bottom right and the features the save has opened (unlocks.ts). Settings, profile
// and the egg shop open as overlays over it (Esc or ✕ closes). It owns its root until dispose(); main.ts decides what follows.
import { battleCardIds, castleLevelOf, leagues, progression, rankName, sects, stages, type Rank } from '@five-sects/sim';
import { el } from './battle';
import { playerPower } from './camp';
import { cardLog, eggShop } from './collectionView';
import { levelSum, type Mode, type Profile } from './profile';
import { applyVolume } from './sound';
import { conditionTh, nextStage, unlockState, type Feature } from './unlocks';

export const PLAYER_NAME = 'เจ้าสำนัก'; // no account until M1, so every save has the same name
const btn = (text: string, cls: string, onclick: () => void) => { const b = el('button', cls, text); b.type = 'button'; b.onclick = onclick; return b; };

// The rank as a badge in its league's place on the ladder (progression.json > ranked).
export function rankBadge(r: Rank): HTMLElement {
  const b = el('i', `rank-badge league-${leagues[r.league]!.id}`, rankName(r));
  b.title = 'ระดับศึกฝีมือ ขึ้นดาวเมื่อชนะ';
  return b;
}
export const starCount = (p: Profile) => stages.reduce((a, st) => a + (p.campaign[st.id]?.stars.filter(Boolean).length ?? 0), 0);
export const toggleFullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); };

// Our castle in pixel art, drawn at 1x and scaled up crisp: a wider wall, side towers, wall turrets and more keep roofs
// as the castle level rises. Colours from effects.json > render.palette.
export function castleArt(lv: number): HTMLCanvasElement {
  const W = 200, H = 120, c = el('canvas', 'castle-art'), g = c.getContext('2d')!;
  c.width = W; c.height = H;
  const box = (x: number, y: number, w: number, h: number, fill: string) => { g.fillStyle = '#1A1423'; g.fillRect(x - 1, y - 1, w + 2, h + 2); g.fillStyle = fill; g.fillRect(x, y, w, h); };
  const roof = (cx: number, y: number, w: number) => {
    g.fillStyle = '#1A1423'; g.fillRect(cx - w / 2 - 1, y - 1, w + 2, 7);
    g.fillStyle = '#B12F00'; g.fillRect(cx - w / 2, y, w, 5);
    g.fillStyle = '#E53C00'; g.fillRect(cx - w / 2 + 2, y, w - 4, 2);
    g.fillStyle = '#E3B04B'; g.fillRect(cx - w / 2 - 1, y + 4, 2, 2); g.fillRect(cx + w / 2 - 1, y + 4, 2, 2);
  };
  const cx = W / 2, ground = H - 18, wallW = Math.min(150, 70 + 5 * lv), wallH = 24, wx = cx - wallW / 2, wy = ground - wallH;
  // the mound it stands on, flaring out row by row
  for (let y = 0; y < H - ground; y++) {
    const w = Math.round(wallW + 34 + y * y * 0.45);
    g.fillStyle = y < 2 ? '#3E7A3A' : y < 8 ? '#2E4430' : '#24352A';
    g.fillRect(Math.round(cx - w / 2), ground + y, w, 1);
  }
  // the keep: one more roofed storey every few levels, each narrower
  const storeys = Math.min(4, 1 + Math.floor((lv + 2) / 5));
  let y = wy, w = 56;
  for (let i = 0; i < storeys; i++) {
    const h = 16;
    box(cx - w / 2 + 4, y - h, w - 8, h, i % 2 ? '#8F8A96' : '#C8C4CC');
    g.fillStyle = '#3A3442'; for (let k = cx - w / 2 + 10; k < cx + w / 2 - 10; k += 8) g.fillRect(k, y - h + 5, 3, 5);
    roof(cx, y - h - 5, w + 6);
    y -= h + 5; w -= 10;
  }
  g.fillStyle = '#E3B04B'; g.fillRect(cx - 1, y - 6, 2, 6);
  // the wall with its crenellations and the gate
  box(wx, wy, wallW, wallH, '#8F8A96');
  g.fillStyle = '#C8C4CC'; for (let x = wx; x < wx + wallW - 3; x += 7) g.fillRect(x, wy - 4, 4, 4);
  g.fillStyle = '#5A5266'; g.fillRect(wx, wy + wallH - 5, wallW, 5);
  box(cx - 8, wy + 8, 16, wallH - 8, '#5F471C');
  g.fillStyle = '#E3B04B'; g.fillRect(cx - 1, wy + 10, 2, wallH - 10);
  // side towers from Lv2, turrets on the wall from Lv8, banners from Lv3
  const tower = (x: number, h: number) => { box(x - 7, ground - h, 14, h, '#C8C4CC'); roof(x, ground - h - 5, 20); g.fillStyle = '#3A3442'; g.fillRect(x - 1, ground - h + 6, 3, 6); };
  if (lv >= 2) { tower(wx, wallH + 14); tower(wx + wallW, wallH + 14); }
  if (lv >= 8) { tower(wx + wallW * 0.22, wallH + 6); tower(wx + wallW * 0.78, wallH + 6); }
  if (lv >= 3) for (const x of [wx, wx + wallW]) { g.fillStyle = '#1A1423'; g.fillRect(x, ground - wallH - 34, 1, 14); g.fillStyle = '#D2412F'; g.fillRect(x + 1, ground - wallH - 34, 7, 5); }
  return c;
}

// An overlay sheet over the screen: a title, ✕, and the body. Esc, ✕ or a click outside closes it.
export function overlay(host: HTMLElement, title: string, body: HTMLElement, cls = ''): () => void {
  const back = el('div', `overlay ${cls}`), sheet = el('div', 'sheet panel'), head = el('div', 'sheet-head');
  back.setAttribute('role', 'dialog');
  back.setAttribute('aria-modal', 'true');
  back.setAttribute('aria-label', title);
  const x = btn('✕', 'btn btn-icon btn-sm close', () => close());
  x.setAttribute('aria-label', 'ปิด');
  head.append(el('h2', '', title), x);
  sheet.append(head, body);
  back.append(sheet);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey);
  let closed = false;
  function close() { if (closed) return; closed = true; removeEventListener('keydown', onKey); back.remove(); }
  host.append(back);
  x.focus();
  return close;
}

const KEYS: [string, string][] = [
  ['คลิกการ์ด แล้วคลิกบนเส้นทาง', 'ลงการ์ด (หรือลากการ์ดลงสนาม)'], ['1–7', 'เลือกการ์ดในมือ'], ['Space', 'เล็งปืนใหญ่ แล้วคลิกยิง'],
  ['Esc', 'ยกเลิกการ์ดที่เลือก / หยุดเกม / ปิดหน้าต่าง'], ['P', 'หยุดเกม'], ['F', 'เต็มจอ'],
];
export function settingsBody(p: Profile, save: () => void): HTMLElement {
  const box = el('div', 'settings');
  const set = p.settings, changed = () => { applyVolume(); save(); show(); };
  const mute = btn('', 'toggle', () => { set.muted = !set.muted; changed(); });
  mute.dataset.set = 'mute';
  const vol = el('input', 'volume');
  vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.value = String(set.volume);
  vol.oninput = () => { set.volume = Number(vol.value); applyVolume(); volNum.textContent = vol.value; };
  vol.onchange = () => save();
  const volNum = el('b', 'vol-num', String(set.volume));
  const shake = btn('', 'toggle', () => { set.shake = !set.shake; changed(); });
  const full = btn('', 'toggle', () => toggleFullscreen());
  full.dataset.set = 'fullscreen';
  const show = () => {
    mute.textContent = set.muted ? 'ปิดอยู่' : 'เปิดอยู่'; mute.classList.toggle('on', !set.muted);
    shake.textContent = set.shake ? 'สั่น' : 'นิ่ง'; shake.classList.toggle('on', set.shake);
    full.textContent = document.fullscreenElement ? 'เต็มจออยู่' : 'หน้าต่าง'; full.classList.toggle('on', !!document.fullscreenElement);
  };
  document.addEventListener('fullscreenchange', show);
  const row = (label: string, ...ctl: HTMLElement[]) => { const r = el('div', 'set-row'); r.append(el('span', '', label), ...ctl); return r; };
  const keys = el('table', 'keys');
  for (const [k, what] of KEYS) { const tr = el('tr'); tr.append(el('td', 'key', k), el('td', '', what)); keys.append(tr); }
  box.append(el('h3', '', 'เสียง'), row('เปิด/ปิดเสียง', mute), row('ความดัง', vol, volNum),
    el('h3', '', 'การแสดงผล'), row('เต็มจอ (F)', full), row('จอสั่นเมื่อโดนตี', shake),
    el('h3', '', 'ปุ่มลัด'), keys);
  show();
  return box;
}

function profileBody(p: Profile): HTMLElement {
  const box = el('div', 'profile'), sum = levelSum(p), cl = castleLevelOf(sum), next = progression.castleLevels[cl];
  const won = stages.filter((s) => p.campaign[s.id]?.stars[0]).length;
  const rows: [string, string | HTMLElement][] = [
    ['ปราสาท', `Lv${cl}${next ? ` · เลเวลการ์ดรวม ${sum}/${next.cardLevels} สู่ Lv${cl + 1}` : ` · เลเวลการ์ดรวม ${sum}`}`],
    ['สำนักต้นสังกัด', p.home ? sects.get(p.home)!.nameTh : '-'],
    ['พลังทัพ', `${playerPower(p, Date.now()).toLocaleString('en-US')} (ทัพที่จัดไว้ · ใช้จับคู่ศึกทั่วไป)`],
    ['การ์ด', `มีแล้ว ${p.owned.length}/${battleCardIds.length} ใบ`],
    ['ศึกปราบ', `ผ่าน ${won}/${stages.length} ด่าน · ดาว ${starCount(p)}/${stages.length * 3}`],
    ['ศึกฝีมือ', unlockState(p).open.has('ranked') ? rankBadge(p.rank) : 'เปิดเมื่อผ่านด่าน 1-10'],
  ];
  box.append(el('p', 'profile-name', PLAYER_NAME));
  for (const [k, v] of rows) { const r = el('div', 'set-row'); r.append(el('span', '', k), typeof v === 'string' ? el('b', '', v) : v); box.append(r); }
  box.append(el('p', 'dim small', 'บัญชีและชื่อผู้เล่นมาพร้อมระบบออนไลน์'));
  return box;
}

export interface LobbyNav { stage: (id: string) => void; map: () => void; mode: (m: Mode) => void; camp: () => void }

export function lobbyScreen(app: HTMLElement, p: Profile, save: () => void, nav: LobbyNav): () => void {
  const r = el('div', 'screen lobby');
  let closeSheet: (() => void) | null = null;
  const sheet = (title: string, body: () => HTMLElement, cls = '') => { closeSheet?.(); closeSheet = overlay(r, title, body(), cls); };
  const top = el('div', 'lobby-top'), purse = el('div', 'purse'), mid = el('div', 'lobby-mid'), bottom = el('div', 'lobby-bottom');
  const chip = btn('', 'profile-chip', () => sheet('โปรไฟล์', () => profileBody(p)));
  const gear = btn('ตั้งค่า', 'btn btn-secondary btn-md gear', () => sheet('ตั้งค่า', () => settingsBody(p, save)));
  top.append(chip, el('div', 'grow'), purse, gear);
  r.append(top, mid, bottom);
  app.append(r);

  const MODE_BTN: Record<'ranked' | 'casual', [string, string]> = { ranked: ['ศึกฝีมือ', 'จัดอันดับ · ค่าเท่ากัน'], casual: ['ศึกทั่วไป', 'กับ AI · เลเวลมีผล'] };
  function show() {
    const { open, next } = unlockState(p), cl = castleLevelOf(levelSum(p)), stage = nextStage(p);
    chip.replaceChildren(el('b', '', PLAYER_NAME), el('span', 'castle-lv', `ปราสาท Lv${cl}`));
    if (open.has('ranked')) chip.append(rankBadge(p.rank));
    purse.replaceChildren(el('span', 'coin', `เหรียญ ${p.coins}`), el('span', 'gold', `ทองคำ ${p.gold}`), el('span', 'egg', `แต้มไข่ ${p.eggPoints}`));
    const castle = el('div', 'lobby-castle');
    castle.append(castleArt(cl), el('p', 'castle-name', `ปราสาทของเรา · Lv${cl}`));
    mid.replaceChildren(el('h1', 'lobby-title', 'ศึกห้าสำนัก'), castle);

    const big = (cls: string, title: string, sub: string, go: () => void) => { const b = btn('', `cta ${cls}`, go); b.append(el('b', '', title), el('small', '', sub)); return b; };
    const primary = stage
      ? big('stage', `ศึกปราบ: ด่าน ${stage.id}`, stage.nameTh, () => nav.stage(stage.id))
      : big('ranked', 'ศึกฝีมือ', `จัดอันดับ · ${rankName(p.rank)}`, () => nav.mode('ranked'));
    primary.dataset.cta = stage ? 'stage' : 'ranked';
    const side = el('div', 'lobby-buttons');
    const add = (f: Feature | 'log' | null, title: string, sub: string, go: () => void) => {
      const b = btn('', 'mode', go);
      b.dataset.go = f ?? 'map';
      b.append(el('b', '', title), el('small', '', sub));
      side.append(b);
    };
    add(null, 'ศึกปราบ', `แผนที่ด่าน · ดาว ${starCount(p)}/${stages.length * 3}`, nav.map);
    if (open.has('ranked') && stage) add('ranked', ...MODE_BTN.ranked, () => nav.mode('ranked'));
    if (open.has('casual')) add('casual', ...MODE_BTN.casual, () => nav.mode('casual'));
    if (open.has('levelUp')) add('levelUp', 'ค่ายฝึก', [`เลื่อนขั้น`, open.has('forge') ? 'โรงหลอม' : '', open.has('town') ? 'เมือง' : ''].filter(Boolean).join(' · '), nav.camp);
    add('log', 'บันทึกการ์ด', `มีแล้ว ${p.owned.length}/${battleCardIds.length} ใบ`, () => sheet('บันทึกการ์ด', () => cardLog(p), 'log-sheet'));
    if (open.has('eggShop')) add('eggShop', 'ร้านไข่', `แต้มไข่ ${p.eggPoints}`, () => sheet('ร้านไข่', () => eggShop(p, save, show), 'log-sheet egg-sheet'));
    if (next) {
      const lock = btn('', 'mode locked', () => {});
      lock.disabled = true;
      lock.dataset.locked = next.id;
      lock.append(el('b', '', next.nameTh), el('small', '', `ยังไม่เปิด · ${conditionTh(next)}`));
      side.append(lock);
    }
    bottom.replaceChildren(side, primary);
  }
  show();
  return () => { closeSheet?.(); r.remove(); };
}
