// The player's path from app start to play (docs/specs/SPEC-front-flow.md §2) and the lobby (SPEC-core §6).
// first run: consent → intro → tutorial T-0 → sect pick → name → lobby; later runs: lobby. route() decides.
// Dev shortcut: ?stage=1-1&sect=fire&seed=1 jumps straight into a battle; &bot=1 lets the test bot play, &speed=8 fast-forwards.
import { allegiance, roleDefs, roleUnlocks, rosterSects, sects, skills, stages, TICK_HZ, unitList, upcomingSects } from '@five-sects/sim';
import { el, startBattle, STARS, type BattleResult } from './battle';
import {
  chapterStars, chapterStarsMax, load, migrate, nextStage, PLAYLIST, recordEnd, route, save, TUTORIAL, type LobbyTab, type Profile, type Screen,
} from './profile';
import { initSound } from './sound';
import { nowrapWords } from './words';

const app = document.getElementById('app')!;
// The UI is designed 720 px tall; scale it to the window height and let the width fill the whole window (no bars).
const fit = () => {
  const k = Math.min(innerHeight / 720, innerWidth / 1100);
  app.style.setProperty('--k', String(k));
  app.style.width = `${innerWidth / k}px`;
  app.style.height = `${innerHeight / k}px`;
};
addEventListener('resize', fit);
fit();
// F toggles browser full screen (PC).
addEventListener('keydown', (e) => {
  if (e.key !== 'f' || e.target instanceof HTMLInputElement) return;
  if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen();
});
const q = new URLSearchParams(location.search);
const jump = q.get('stage');
const dev = { bot: q.get('bot') === '1', speed: Number(q.get('speed') ?? 1), seed: Number(q.get('seed') ?? 1), sect: q.get('sect') };
const profile: Profile = load();
initSound(profile.settings);
let dispose: (() => void) | void;

function go(next: Screen) {
  if (dispose) dispose();
  dispose = undefined;
  app.replaceChildren();
  Object.assign(window, { __flow: { profile, screen: next } });
  switch (next.k) {
    case 'consent': return consent();
    case 'intro': dispose = intro(next.page); return;
    case 'battle': dispose = battle(next.stageId); return;
    case 'sectPick': return sectPick();
    case 'sectDetail': return sectDetail(next.sect, next.confirm);
    case 'name': return nameScreen();
    case 'lobby': return lobby(next.tab);
  }
}

function done(change: Partial<Profile>) {
  Object.assign(profile, change);
  save(profile);
  go(route(profile));
}

// ---- small view helpers ----
function btn(text: string, cls: string, onclick: (() => void) | null): HTMLButtonElement {
  const b = el('button', cls, text);
  if (onclick) b.onclick = onclick; else b.disabled = true;
  return b;
}
function page(cls: string, title?: string): HTMLDivElement {
  const r = el('div', `screen ${cls}`);
  if (title) r.append(el('h1', '', title));
  app.append(r);
  return r;
}
function toast(msg: string) {
  app.querySelector('.flow-toast')?.remove();
  const t = el('div', 'toast flow-toast', msg);
  app.append(t);
  setTimeout(() => t.remove(), 1800);
}
function dialog(title: string, body: string, buttons: HTMLButtonElement[]): HTMLDivElement {
  const d = el('div', 'modal');
  const box = el('div', 'dialog');
  const row = el('div', 'row');
  row.append(...buttons);
  box.append(el('h2', '', title), el('p', '', body), row);
  d.append(box);
  app.append(d);
  return d;
}
const starRow = (got: number, max: number) => el('span', 'stars', Array.from({ length: max }, (_, i) => (i < got ? '◆' : '◇')).join(' '));
const difficulty = (n: number) => (n <= 1 ? 'ง่าย' : n === 2 ? 'ปานกลาง' : 'ยาก');
function stageName(id: string): string {
  const st = stages.get(id);
  if (!st || id === TUTORIAL) return st?.nameTh ?? id;
  return `บท ${st.chapter} ด่าน ${id.split('-')[1]} — ${st.nameTh}`;
}
const ROLE_COLOR: Record<string, string> = { striker: '#E3B04B', burst: '#FF9E7B', control: '#4FB3FF', stacker: '#5BC46A', support: '#C8C4CC' };

// ---- consent ----
function consent() {
  const r = page('consent', 'ก่อนเริ่มเล่น');
  const thisYear = new Date().getFullYear();
  let year: number | null = null;
  const yearText = el('div', 'year empty', 'คลิก - / + เพื่อเลือก');
  const start = btn('เริ่มเล่น', 'primary big', () => done({ consented: true, birthYear: year }));
  start.disabled = true;
  // A first tap lands mid-range; after that the steps move from the chosen year.
  const step = (d: number) => btn(d > 0 ? `+${d}` : `${d}`, '', () => {
    year = Math.min(thisYear, Math.max(1930, year == null ? 2000 : year + d));
    yearText.textContent = String(year);
    yearText.className = 'year';
    start.disabled = false;
  });
  const picker = el('div', 'year-picker');
  picker.append(step(-10), step(-1), yearText, step(1), step(10));
  r.append(
    el('p', '', 'การกด "เริ่มเล่น" ถือว่ายอมรับข้อตกลงการใช้งานและนโยบายความเป็นส่วนตัว (PDPA) เราเก็บรหัสผู้เล่นและความคืบหน้าเพื่อเซฟเกมเท่านั้น'),
    el('p', 'dim', 'ปีเกิด (ใช้ตั้งเพดานการใช้จ่ายของผู้เยาว์)'),
    picker, el('div', 'grow'), start,
  );
}

// ---- intro: three pages, tap to go on, or skip ----
const INTRO = [
  'คืนจันทร์สีเลือด นิกายจันทร์โลหิตบุกหมู่บ้านเชิงเขา',
  'ห้าสำนักแห่งยุทธภพส่งศิษย์ลงมาช่วย แต่ละสำนักมีวิชาของตัวเอง',
  'จงวางศิษย์ขวางทางมาร อย่าให้ผ่านประตูหมู่บ้าน',
];
function intro(n: number) {
  const r = page('intro');
  const next = () => (n + 1 < INTRO.length ? go({ k: 'intro', page: n + 1 }) : done({ introSeen: true }));
  const skip = btn('ข้าม', 'skip', () => done({ introSeen: true }));
  skip.addEventListener('click', (e) => e.stopPropagation());
  r.append(skip, el('div', 'grow'), el('p', 'story', INTRO[n]!), el('div', 'grow'), el('p', 'dim center', `${n + 1} / ${INTRO.length}   ·   คลิกเพื่อไปต่อ`));
  r.onclick = next;
  const t = setTimeout(next, 6000);
  return () => clearTimeout(t);
}

// ---- loading → battle → result ----
const TIPS = [
  'ดอกเบี้ยได้เมื่อเคลียร์สนามหมด เรียกระลอกก่อนเวลาได้โบนัส แต่เสียดอกเบี้ยรอบนั้น',
  'บางตัวบินข้ามหลังคา ศิษย์ที่ตีได้แค่พื้นจะตีไม่ถึง',
  'อัปเกรดแล้วได้ท่าใหม่ คลิกศิษย์ที่วางแล้วเพื่อดูท่าถัดไป',
  'หมอผีฟื้นเลือดเพื่อนไม่ได้ ถ้าเพื่อนติดไฟหรือติดพิษอยู่',
];
function battle(stageId: string) {
  const opts = { stageId, sect: dev.sect ?? profile.sect, seed: dev.seed, bot: dev.bot, speed: dev.speed, settings: profile.settings, saveSettings: () => save(profile) };
  if (jump) return startBattle(app, opts, (r) => result(stageId, r));
  // The loading beat stays at least a second so it reads as a scene change; the board is built after it.
  const rule = allegiance.find((a) => a.element === profile.sect);
  const tips = rule ? [...TIPS, `กฎสำนัก: ${rule.ruleTh}`] : TIPS;
  const r = page('loading');
  const bar = el('div', 'bar');
  bar.append(el('div', 'fill'));
  r.append(
    el('div', 'grow'), el('p', 'sect', profile.sect ? sects.get(profile.sect)!.nameTh : ''), el('h1', '', stageName(stageId)), bar,
    el('div', 'grow'), el('p', 'dim center', tips[Math.max(0, PLAYLIST.indexOf(stageId) + 1) % tips.length]!),
  );
  let stop: (() => void) | undefined;
  const t = setTimeout(() => { r.remove(); stop = startBattle(app, opts, (res) => result(stageId, res)); }, 1000);
  return () => { clearTimeout(t); stop?.(); };
}

function result(stageId: string, r: BattleResult) {
  recordEnd(profile, stageId, r.won, r.stars);
  save(profile);
  const box = el('div', 'modal');
  box.append(el('h2', r.won ? 'won' : 'lost', r.won ? 'ชนะ!' : 'พ่ายแพ้'));
  stages.get(stageId)!.stars.forEach((k, i) => box.append(el('p', r.stars[i] ? 'star on' : 'star', `${r.stars[i] ? '◆' : '◇'} ${STARS[k] ?? k}`)));
  const sec = Math.floor(r.tick / TICK_HZ);
  box.append(el('p', '', `เวลา ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} · เสียชีวิต ${r.livesLost}`));
  if (stageId === TUTORIAL) box.append(btn('ไปต่อ', 'primary', () => go(route(profile))));
  else {
    const i = PLAYLIST.indexOf(stageId);
    const next = r.won && i >= 0 ? PLAYLIST[i + 1] : undefined;
    if (next) box.append(btn('ด่านถัดไป', 'primary', () => go({ k: 'battle', stageId: next })));
    box.append(btn('เล่นอีกครั้ง', next ? '' : 'primary', () => go({ k: 'battle', stageId })), btn('กลับลานสำนัก', '', () => go(route(profile))));
  }
  app.append(box);
}

// ---- sect pick: every sect can be read about; only those with a roster can be joined ----
function sectPick() {
  const r = page('sect-pick', 'เลือกสำนักต้นสังกัด');
  for (const a of allegiance) {
    const def = sects.get(a.element)!;
    const ready = rosterSects.includes(a.element);
    const b = btn('', ready ? 'sect-row' : 'sect-row soon', () => go({ k: 'sectDetail', sect: a.element, confirm: false }));
    b.style.borderLeftColor = def.color;
    b.append(el('b', '', def.nameTh), el('small', '', `ความยาก ${difficulty(a.difficulty)}${ready ? '' : ' · กำลังพัฒนา'}`));
    r.append(b);
  }
  for (const u of upcomingSects) {
    const b = btn('', 'sect-row soon', null);
    b.append(el('b', '', u.nameTh), el('small', '', `เปิดเดือนที่ ${u.opensMonth}`));
    r.append(b);
  }
}

function sectDetail(sect: string, confirm: boolean) {
  const def = sects.get(sect)!;
  const a = allegiance.find((x) => x.element === sect)!;
  const ready = rosterSects.includes(sect);
  const r = page('sect-detail');
  r.style.borderTopColor = def.color;
  const h = el('h1', '', def.nameTh);
  h.style.color = def.color;
  r.append(h, el('p', 'dim', `กฎประจำสำนัก · ความยาก ${difficulty(a.difficulty)}`), el('p', 'rule', a.ruleTh));
  const us = unitList.filter((u) => u.sect === sect);
  if (us.length === 0) r.append(el('p', 'dim', 'ศิษย์ 5 บทบาทของสำนักนี้กำลังพัฒนา จะเปิดในอัปเดตถัดไป'));
  for (const u of us) {
    const head = el('b', '', `${roleDefs.get(u.roleId)?.nameTh ?? ''} · ${u.nameTh}`);
    head.style.color = ROLE_COLOR[u.roleId] ?? '';
    const item = el('div', 'unit');
    item.append(head, el('p', '', u.descTh));
    r.append(item);
  }
  const row = el('div', 'row actions');
  row.append(btn('กลับ', '', () => go({ k: 'sectPick' })), btn(ready ? 'เข้าสำนักนี้' : 'กำลังพัฒนา', 'primary', ready ? () => go({ k: 'sectDetail', sect, confirm: true }) : null));
  r.append(el('div', 'grow'), row);
  // Told plainly before the pick: changing later needs the sect-change token (SPEC-front-flow §5).
  if (confirm)
    dialog('ยืนยันเข้าสำนักนี้?', 'เปลี่ยนสำนักภายหลังต้องใช้ "ป้ายย้ายสังกัด" ความก้าวหน้าของแต่ละสำนักไม่หาย', [
      btn('ยกเลิก', '', () => go({ k: 'sectDetail', sect, confirm: false })),
      btn('ยืนยัน', 'primary', () => done({ sect })),
    ]);
}

// ---- name ----
const NAME_A = ['หลิว', 'เซียว', 'หาน', 'ซือ', 'เยว่', 'ฉิน', 'ไป๋', 'หลง', 'เมิ่ง', 'ซ่ง'];
const NAME_B = ['อวิ๋น', 'เฟิง', 'เสวี่ย', 'หยาง', 'อี้', 'หลาน', 'จิ่ว', 'ซิน', 'เหอ', 'ชิง'];
const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)]!;
const randomName = () => pick(NAME_A) + pick(NAME_B);

// Length in what a reader counts as letters: a Thai vowel or tone mark belongs to its consonant.
function nameProblem(n: string): string | null {
  const len = [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(n)].length;
  if (len < 2 || len > 12) return 'ชื่อต้องยาว 2–12 ตัวอักษร';
  if (/\p{Extended_Pictographic}/u.test(n)) return 'มีตัวอักษรที่แสดงไม่ได้ (เช่นอีโมจิ)';
  if (!/\p{L}/u.test(n)) return 'ชื่อต้องมีตัวอักษร';
  return null;
}

function nameScreen() {
  const r = page('name', 'ฉายาของท่าน');
  const field = el('input', 'field');
  field.value = randomName();
  field.maxLength = 40;
  const error = el('p', 'error');
  field.oninput = () => { error.textContent = ''; };
  const row = el('div', 'row');
  row.append(btn('สุ่มชื่อ', '', () => { field.value = randomName(); error.textContent = ''; }), btn('ยืนยัน', 'primary', () => {
    const n = field.value.trim().replace(/\s+/g, ' ');
    const problem = nameProblem(n);
    // The server re-checks names against the profanity list once accounts move online (M1).
    if (problem) error.textContent = problem; else done({ name: n });
  }));
  r.append(field, error, row);
}

// ---- lobby (ลานสำนัก) ----
// SPEC-core §6 tabs and the stage that opens each; Battle sits in the middle and is the largest.
const TABS: { id: LobbyTab | 'hall' | 'shop'; th: string; opensAt: string | null }[] = [
  { id: 'disciples', th: 'ศิษย์', opensAt: '1-2' },
  { id: 'hall', th: 'ศาลา', opensAt: '1-4' },
  { id: 'battle', th: 'ศึก', opensAt: null },
  { id: 'home', th: 'ลานสำนัก', opensAt: null },
  { id: 'shop', th: 'ร้าน', opensAt: '1-4' },
];
const opened = (at: string | null) => at == null || profile.cleared.includes(at);

// The one line of "what next" that is always on the lobby (SPEC-core §1).
function nextGoal(): string {
  const next = PLAYLIST.find((id) => !profile.cleared.includes(id));
  if (next) {
    const after = PLAYLIST[PLAYLIST.indexOf(next) + 1]; // roles join in the stage after the one cleared
    const unlocks = [
      ...(roleUnlocks.find(([k]) => k === after)?.[1] ?? []).map((id) => `บทบาท${roleDefs.get(id)?.nameTh ?? id}`),
      ...TABS.filter((t) => t.opensAt === next).map((t) => `หน้า${t.th}`),
    ];
    return `เป้าถัดไป: ผ่าน ${next}${unlocks.length ? ` เพื่อปลด ${unlocks.join(', ')}` : ''}`;
  }
  const missing = chapterStarsMax() - chapterStars(profile);
  return missing > 0 ? `เป้าถัดไป: อีก ${missing} ดาวครบบทที่ 1` : 'จบบทที่ 1 ครบทุกดาวแล้ว! บทที่ 2 เปิดในอัปเดตถัดไป';
}

function lobby(tab: LobbyTab) {
  const def = sects.get(profile.sect!)!;
  const top = el('div', 'lobby-top');
  const seal = el('span', 'seal');
  seal.style.background = def.color;
  top.append(seal, el('b', 'who', `${profile.name} · ${def.nameTh}`), el('span', 'total', `◆ ${chapterStars(profile)} / ${chapterStarsMax()}`));
  const body = el('div', 'screen lobby-body');
  const tabs = el('nav', 'tabs');
  for (const t of TABS) {
    const open = opened(t.opensAt);
    const b = btn('', `${t.id === tab ? 'primary' : ''}${open ? '' : ' locked'}${t.id === 'battle' ? ' main' : ''}`, () => {
      if (!open) toast(`ผ่านด่าน ${t.opensAt} เพื่อปลด`);
      else if (t.id === 'hall' || t.id === 'shop') comingSoon(t.id);
      else go({ k: 'lobby', tab: t.id });
    });
    b.append(el('span', '', t.th));
    if (!open) b.append(el('small', '', `ผ่าน ${t.opensAt}`));
    tabs.append(b);
  }
  app.append(top, el('p', 'goal', nextGoal()), body, tabs);
  if (tab === 'battle') chapterMap(body);
  else if (tab === 'disciples') disciples(body);
  else home(body);
}

function home(r: HTMLElement) {
  // Side shortcuts unlock with progress (release-systems §5); the systems behind them come later.
  const side = el('div', 'side');
  for (const [text, at] of [['ภารกิจรายวัน', '1-1'], ['กล่องจดหมาย', '1-1'], ['อีเวนต์', '1-4']] as const) {
    const open = opened(at);
    side.append(btn(open ? text : `${text} · ผ่าน ${at}`, open ? '' : 'locked', () => toast(open ? 'เร็วๆ นี้' : `ผ่านด่าน ${at} เพื่อปลด`)));
  }
  const next = nextStage(profile);
  const enter = btn('', 'primary enter', () => go({ k: 'battle', stageId: next }));
  enter.append(el('b', '', 'เข้าสู่ยุทธภพ'), el('span', '', stageName(next)));
  r.append(side, el('div', 'grow'), enter, starRow(profile.stars[next] ?? 0, stages.get(next)!.stars.length), el('div', 'grow'));
  if (import.meta.env.DEV)
    r.append(btn('[ทดสอบ] เริ่มใหม่ (ลบเซฟ)', 'locked', () => dialog('ลบเซฟทั้งหมดแล้วเริ่มใหม่?', 'ย้อนกลับไม่ได้', [
      btn('ยกเลิก', '', () => go({ k: 'lobby', tab: 'home' })),
      btn('ลบ', 'primary', () => { save(migrate(null)); location.reload(); }),
    ])));
}

// Chapter 1 as a path of stages: stars won, the next stage open, later ones locked; cleared ones can be replayed.
function chapterMap(r: HTMLElement) {
  r.append(el('h2', '', 'บทที่ 1 · หมู่บ้านเชิงเขา'));
  const next = PLAYLIST.find((id) => !profile.cleared.includes(id));
  for (const id of PLAYLIST) {
    const open = profile.cleared.includes(id) || id === next;
    const b = btn('', `stage-row${id === next ? ' primary' : ''}`, open ? () => go({ k: 'battle', stageId: id }) : null);
    const text = el('span', 'text');
    text.append(el('b', '', stageName(id)));
    if (!open) text.append(el('small', '', 'ผ่านด่านก่อนหน้าเพื่อปลด'));
    b.append(text, starRow(profile.stars[id] ?? 0, stages.get(id)!.stars.length));
    r.append(b);
  }
}

// Tier names in order; tier 3 shows both branches ("a / b") when the kit has two.
function tierNames(kit: string): string {
  const ks = skills.get(kit) ?? [];
  return [...new Set(ks.map((k) => k.lvl))].map((lvl) => ks.filter((k) => k.lvl === lvl).map((k) => k.nameTh).join(' / ')).join(' › ');
}

// What each disciple of the player's sect does, when it joins, and the technique each tier teaches.
function disciples(r: HTMLElement) {
  r.append(el('h2', '', `ศิษย์ของ${sects.get(profile.sect!)!.nameTh}`));
  for (const u of unitList.filter((x) => x.sect === profile.sect)) {
    const at = roleUnlocks.find(([, rs]) => rs.includes(u.roleId))?.[0];
    const have = at == null || profile.cleared.includes(at) || at === nextStage(profile); // a role joins in the stage its key names
    const card = el('div', `unit card-unit${have ? '' : ' locked'}`);
    const head = nowrapWords(el('b'), `${u.nameTh} · ${roleDefs.get(u.roleId)?.nameTh ?? ''}${have ? '' : `  (ปลดที่ ${at})`}`);
    if (have) head.style.color = ROLE_COLOR[u.roleId] ?? '';
    card.style.borderLeftColor = u.color;
    card.append(head, el('p', '', u.descTh), el('p', 'skill', `ท่าตามขั้น: ${tierNames(u.element)}`));
    r.append(card);
  }
}

// Tabs whose systems come later say what they will hold instead of doing nothing.
function comingSoon(tab: 'hall' | 'shop') {
  const d = dialog('เร็วๆ นี้', tab === 'hall'
    ? 'ศาลา: ตู้วีรชนประจำสัปดาห์ ตู้ถาวร ตู้อุปกรณ์ แสดงอัตรา การันตี และประวัติการสุ่มทุกครั้ง'
    : 'ร้าน: หยก แพ็ก บัตรรายเดือน ตั๋วยุทธภพ ของใน PvP เป็นของตกแต่งเท่านั้น', [btn('ปิด', '', () => d.remove())]);
}

go(jump ? { k: 'battle', stageId: jump } : route(profile));
