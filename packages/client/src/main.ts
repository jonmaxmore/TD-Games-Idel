// The player's path through the app: title → deck pick → castle battle → result → back.
// Dev and shots shortcut: ?mode=battle jumps straight into a match; &bot=1 lets bots play both sides, &speed=4 fast-forwards,
// &seed=N picks the match, &deck=fire|wood|metal|water|earth|all the player's collection (&leader=, &sub= its leaders).
import { battle, battleUnits, TICK_HZ, type Side } from '@five-sects/sim';
import { el, startMatch, type MatchResult } from './battle';
import { portrait } from './board';
import { aiTeam, collectionOf, COLLECTIONS, fixTeam, resolveTeam, type Team } from './decks';
import { load, save, type Profile } from './profile';
import { initSound } from './sound';
import { cardArt, loadSprites } from './sprites';
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
  if (e.key !== 'f') return;
  if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen();
});
const q = new URLSearchParams(location.search);
const dev = { battle: q.get('mode') === 'battle', bot: q.get('bot') === '1', speed: Number(q.get('speed') ?? 1), seed: Number(q.get('seed') ?? 1), team: resolveTeam(q) };
const profile: Profile = load();
initSound(profile.settings);

type Screen = { k: 'title' } | { k: 'deck' } | { k: 'match'; team: Team; seed: number; redraws: number };
let dispose: (() => void) | void;

function go(next: Screen) {
  if (dispose) dispose();
  dispose = undefined;
  app.replaceChildren();
  Object.assign(window, { __flow: { screen: next.k } });
  if (next.k === 'title') title();
  else if (next.k === 'deck') deckPick();
  else dispose = match(next.team, next.seed, next.redraws);
}

function btn(text: string, cls: string, onclick: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.onclick = onclick;
  return b;
}

// ---- title: the name, two lines of disciples facing off, start ----
function title() {
  const r = el('div', 'screen title');
  const face = el('div', 'faceoff');
  const [a, b] = [COLLECTIONS[0]!, collectionOf(COLLECTIONS[0]!.vs)];
  const side = (d: typeof a, s: Side) => { const row = el('div', `line side${s}`); for (const c of d.cards.slice(0, 4)) row.append(portrait(c, s, s === 1)); return row; };
  face.append(side(a, 0), el('span', 'vs', 'ปะทะ'), side(b, 1));
  r.append(
    el('div', 'grow'), el('h1', '', 'ศึกห้าสำนัก'), el('p', 'sub', 'ศึกชิงเมือง · อัญเชิญศิษย์ ยึดป้อม ทลายปราสาทศัตรูให้ได้ใน 3 นาที'), face,
    btn('เริ่มศึก', 'primary big start', () => go({ k: 'deck' })), el('div', 'grow'), el('p', 'dim center', 'คลิกการ์ดแล้วคลิกบนเส้นทาง หรือลากการ์ดลงสนาม · ปุ่ม 1–8 เลือกการ์ด · Space ตีระฆัง · F เต็มจอ'),
  );
  app.append(r);
}

// ---- deck pick: a deck per sect or the mixed one, its eight cards, then into battle ----
function deckPick() {
  const r = el('div', 'screen deck');
  r.append(el('h1', '', 'เลือกสำรับ'));
  const body = el('div', 'deck-body');
  const list = el('div', 'deck-list');
  const cards = el('div', 'deck-cards');
  body.append(list, cards);
  const show = () => {
    const d = collectionOf(profile.team.collection);
    for (const b of Array.from(list.children)) b.classList.toggle('sel', (b as HTMLElement).dataset.id === d.id);
    cards.replaceChildren(...d.cards.map((c) => {
      const u = battleUnits.get(c)!, cap = battle.sizes.get(u.size)!.perMatch;
      const t = el('div', 'deck-card');
      t.style.borderColor = deckColor(u.sect);
      const face = el('span', 'face');
      face.append(cardArt(c) ?? portrait(c));
      t.append(face, el('span', 'cost', String(u.mana)), nowrapWords(el('b'), u.nameTh),
        nowrapWords(el('small'), `${battle.moves.get(u.move)!.nameTh} · ${battle.sizes.get(u.size)!.nameTh} · ${cap == null ? 'ลงได้ไม่จำกัด' : `ลงได้ ${cap} ครั้ง`}`),
        nowrapWords(el('small', 'does'), battle.moves.get(u.move)!.doesTh),
        nowrapWords(el('small', 'stats'), `HP ${u.hp} · ตี ${u.dmg} · ระยะ ${(u.range / 1000).toFixed(1)}${u.hitsAir ? ' · ตีอากาศได้' : ''}`));
      return t;
    }));
  };
  for (const d of COLLECTIONS) {
    const b = btn('', 'deck-row', () => { profile.team = fixTeam({ collection: d.id }); save(profile); show(); });
    b.dataset.id = d.id;
    b.style.borderLeftColor = d.color;
    b.append(el('b', '', d.nameTh), el('small', '', `คู่ต่อสู้ AI: ${collectionOf(d.vs).nameTh}`));
    list.append(b);
  }
  const row = el('div', 'row actions');
  row.append(btn('กลับ', '', () => go({ k: 'title' })), btn('เข้าสู่ศึก', 'primary', () => go({ k: 'match', team: profile.team, seed: (Date.now() % 100000) + 1, redraws: 0 })));
  r.append(body, row);
  app.append(r);
  show();
}
const deckColor = (sect: string) => collectionOf(sect).color;

// ---- match → result ----
function match(team: Team, seed: number, redraws: number) {
  return startMatch(app, {
    seed, team, vs: aiTeam(team), redraws, speed: dev.speed, settings: profile.settings, saveSettings: () => save(profile),
    bots: [dev.bot ? 'rush' : null, 'rush'],
  }, (r) => result(team, seed, r));
}

const STEP_TH: Record<string, string> = { forts: 'จำนวนป้อมที่ถือ', deepest: 'ป้อมที่ลึกที่สุด', mana: 'ปราณที่เหลือ', units: 'ศิษย์ที่ยังรอด' };
function reason(r: MatchResult): string {
  const we = r.winner === 0;
  if (r.broken) return we ? 'ทลายปราสาทศัตรูได้' : 'ปราสาทเราแตก';
  if (r.step === 'castle') return `หมดเวลา: HP ปราสาท${we ? 'เรา' : 'ศัตรู'}เหลือมากกว่า`;
  if (r.step) return `หมดเวลา HP ปราสาทเท่ากัน: ตัดสินที่${STEP_TH[r.step]}`;
  return 'หมดเวลา และเท่ากันทุกข้อ';
}

function result(team: Team, seed: number, r: MatchResult) {
  const box = el('div', 'modal result');
  const head = r.winner === 0 ? ['won', 'ชนะ!'] : r.winner === 1 ? ['lost', 'พ่ายแพ้'] : ['draw', 'เสมอ'];
  const t = Math.floor(r.tick / TICK_HZ);
  box.append(el('h2', head[0], head[1]), el('p', 'why', reason(r)),
    el('p', 'dim', `ปราสาทเรา ${Math.max(0, r.castles[0])} · ปราสาทศัตรู ${Math.max(0, r.castles[1])} · เวลา ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`));
  const row = el('div', 'row');
  row.append(btn('เล่นอีกครั้ง', 'primary', () => go({ k: 'match', team, seed: seed + 1, redraws: 0 })), btn('เปลี่ยนสำรับ', '', () => go({ k: 'deck' })), btn('หน้าแรก', '', () => go({ k: 'title' })));
  box.append(row);
  app.append(box);
}

void loadSprites().then(() => go(dev.battle ? { k: 'match', team: dev.team ?? profile.team, seed: dev.seed, redraws: 0 } : { k: 'title' }));
