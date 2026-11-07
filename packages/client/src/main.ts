// The player's path through the app: title → team setup → castle battle → result → back.
// Dev and shots shortcut: ?mode=battle jumps straight into a match; &bot=1 lets bots play both sides, &speed=4 fast-forwards,
// &seed=N picks the match, &deck=fire|wood|metal|water|earth|all the player's collection (&leader=, &sub= its leaders).
import { battle, battleUnits, createBattle, stepBattle, TICK_HZ, type Side } from '@five-sects/sim';
import { el, startMatch, type MatchResult } from './battle';
import { portrait } from './board';
import { aiTeam, collectionOf, COLLECTIONS, fixTeam, leaderChoices, resolveTeam, teamSetup, type Team } from './decks';
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
  else if (next.k === 'deck') teamScreen();
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
    btn('เริ่มศึก', 'primary big start', () => go({ k: 'deck' })), el('div', 'grow'), el('p', 'dim center', 'คลิกการ์ดแล้วคลิกบนเส้นทาง หรือลากการ์ดลงสนาม · ปุ่ม 1–7 เลือกการ์ด · Space เล็งปืนใหญ่แล้วคลิกยิง · F เต็มจอ'),
  );
  app.append(r);
}

// ---- team setup: a collection, its leader and sub-leader, a bench, then the dealt hand with redraws ----
const roleLine = (c: string) => { const u = battleUnits.get(c)!, m = battle.moves.get(u.move)!; return `ตัว${m.roleTh} · ${m.nameTh} · ${battle.sizes.get(u.size)!.nameTh}`; };
function abilityText(c: string, level: number): string | null {
  const u = battleUnits.get(c)!;
  if (!u.ability) return null;
  const a = battle.abilities.get(u.ability.kind)!;
  return `${a.nameTh} Lv${level}: ${a.doesTh.replace('{v}', String(u.ability.lv[level - 1]))}`;
}
function teamScreen() {
  const r = el('div', 'screen team');
  r.append(el('h1', '', 'จัดทัพ'));
  const body = el('div', 'team-body'), list = el('div', 'deck-list'), grid = el('div', 'team-cards');
  body.append(list, grid);
  const info = el('p', 'team-info'), handRow = el('div', 'hand-row'), redrawBtn = btn('', 'redraw', () => { redraws++; show(); });
  const seed = (Date.now() % 100000) + 1;
  let redraws = 0;
  const setTeam = (t: Team) => { profile.team = fixTeam(t); save(profile); redraws = 0; show(); };
  const describe = (c: string) => {
    const u = battleUnits.get(c)!, cap = u.perMatch, t = profile.team;
    const lv = c === t.leader ? 3 : c === t.sub ? 2 : 1, ab = abilityText(c, lv);
    info.textContent = `${u.nameTh} · ${roleLine(c)} · ${cap == null ? 'ลงได้ไม่จำกัด' : `ลงได้ ${cap} ครั้ง`} · HP ${u.hp} · ตี ${u.dmg}${u.hitsAir ? ' · ตีอากาศได้' : ''} · ${u.tagTh}${ab ? ` · ${ab}` : ''}`;
  };
  const show = () => {
    const t = profile.team, c = collectionOf(t.collection), lead = leaderChoices(c);
    for (const b of Array.from(list.children)) b.classList.toggle('sel', (b as HTMLElement).dataset.id === c.id);
    grid.classList.toggle('many', c.cards.length > 12);
    grid.replaceChildren(...c.cards.map((id) => {
      const u = battleUnits.get(id)!, role = id === t.leader ? 'leader' : id === t.sub ? 'sub' : t.bench.includes(id) ? 'bench' : basicIds.has(id) ? 'basic' : '';
      const tile = el('div', `team-card ${role}`);
      tile.dataset.id = id;
      tile.style.borderColor = collectionOf(u.sect).color;
      const face = el('span', 'face');
      face.append(cardArt(id) ?? portrait(id));
      const badge = { leader: 'แม่ทัพ', sub: 'รองแม่ทัพ', bench: 'สำรอง', basic: 'มีในมือเสมอ', '': '' }[role];
      tile.append(face, el('span', 'cost', String(u.mana)), nowrapWords(el('b'), u.nameTh), el('small', '', roleLine(id)));
      if (badge) tile.append(el('em', '', badge));
      if (lead.includes(id)) {
        const acts = el('div', 'acts');
        acts.append(
          btn('แม่ทัพ', id === t.leader ? 'on' : '', () => setTeam({ ...t, leader: id, sub: id === t.sub ? t.leader : t.sub })),
          btn('รอง', id === t.sub ? 'on' : '', () => setTeam({ ...t, sub: id, leader: id === t.leader ? t.sub : t.leader })),
          btn('สำรอง', role === 'bench' ? 'on' : '', () => setTeam({ ...t, bench: t.bench.includes(id) ? t.bench.filter((x) => x !== id) : [...t.bench, id] })),
        );
        tile.append(acts);
      }
      tile.addEventListener('pointerenter', () => describe(id));
      return tile;
    }));
    // The deal the match will start from: the same seed and redraws, played through the sim's own redraw command.
    const s = createBattle(seed, teamSetup(t), teamSetup(aiTeam(t)));
    stepBattle(s, Array.from({ length: redraws }, () => ({ t: 'redraw', side: 0 } as const)));
    handRow.replaceChildren(el('span', 'hand-label', 'มือในศึกนี้'), ...s.hands[0].map((id, i) => {
      const u = battleUnits.get(id)!, m = el('div', `hand-card${i < 3 ? ' fixed' : ''}`);
      m.style.borderColor = collectionOf(u.sect).color;
      const face = el('span', 'face');
      face.append(cardArt(id) ?? portrait(id));
      m.append(face, el('span', 'cost', String(u.mana)), nowrapWords(el('b'), u.nameTh), el('small', '', i === 0 ? 'ยึดป้อม' : i === 1 ? 'แม่ทัพ' : i === 2 ? 'รอง' : 'สุ่ม'));
      m.addEventListener('pointerenter', () => describe(id));
      return m;
    }));
    const left = battle.hand.redraws - redraws;
    redrawBtn.textContent = `สับมือใหม่ (เหลือ ${left})`;
    redrawBtn.disabled = left <= 0;
    describe(t.leader);
  };
  for (const d of COLLECTIONS) {
    const b = btn('', 'deck-row', () => setTeam({ collection: d.id } as Team));
    b.dataset.id = d.id;
    b.style.borderLeftColor = d.color;
    b.append(el('b', '', d.nameTh), el('small', '', `${d.cards.length} ตัว · คู่ต่อสู้ AI: ${collectionOf(d.vs).nameTh}`));
    list.append(b);
  }
  const row = el('div', 'row actions');
  row.append(btn('กลับ', '', () => go({ k: 'title' })), redrawBtn, btn('เข้าสู่ศึก', 'primary', () => go({ k: 'match', team: profile.team, seed, redraws })));
  r.append(body, info, handRow, row);
  app.append(r);
  show();
}
const basicIds = new Set(battle.hand.basic.values());

// ---- match → result ----
function match(team: Team, seed: number, redraws: number) {
  return startMatch(app, {
    seed, team, vs: aiTeam(team), redraws, speed: dev.speed, settings: profile.settings, saveSettings: () => save(profile),
    bots: [dev.bot ? 'rush' : null, 'rush'],
  }, (r) => result(team, seed, r));
}

const STEP_TH: Record<string, string> = { forts: 'จำนวนป้อมที่ถือ', mana: 'ปราณที่เหลือ', units: 'ศิษย์ที่ยังรอด', kills: 'จำนวนที่ฆ่าได้' };
// The result type in Thai (battle.json > results) as the headline, and why in one line.
function verdict(r: MatchResult): { head: string; why: string } {
  const we = r.winner === 0, name = battle.results.get(r.type)!;
  if (r.type === 'draw') return { head: name, why: r.castles[0] <= 0 ? 'ปราสาทแตกพร้อมกันทั้งสองฝ่าย' : 'หมดเวลา และเท่ากันทุกข้อ' };
  const head = we ? name : `ศัตรู${name}`;
  if (r.type === 'total') return { head, why: we ? 'ทลายปราสาทศัตรู และยึดป้อมได้ครบ' : 'ปราสาทเราแตก และศัตรูยึดป้อมได้ครบ' };
  if (r.type === 'castle') return { head, why: we ? 'ทลายปราสาทศัตรูได้' : 'ปราสาทเราแตก' };
  if (r.type === 'hp') return { head, why: `หมดเวลา: HP ปราสาท${we ? 'เรา' : 'ศัตรู'}เหลือมากกว่า` };
  return { head, why: `หมดเวลา HP ปราสาทเท่ากัน: ตัดสินที่${STEP_TH[r.step!]}` };
}

function result(team: Team, seed: number, r: MatchResult) {
  const box = el('div', 'modal result');
  const head = r.winner === 0 ? ['won', 'ชนะ!'] : r.winner === 1 ? ['lost', 'พ่ายแพ้'] : ['draw', 'เสมอ'];
  const t = Math.floor(r.tick / TICK_HZ), v = verdict(r);
  box.append(el('h2', head[0], head[1]), el('p', `type ${head[0]}`, v.head), el('p', 'why', v.why),
    el('p', 'dim', `ปราสาทเรา ${Math.max(0, r.castles[0])} · ปราสาทศัตรู ${Math.max(0, r.castles[1])} · เวลา ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`));
  const row = el('div', 'row');
  row.append(btn('เล่นอีกครั้ง', 'primary', () => go({ k: 'match', team, seed: seed + 1, redraws: 0 })), btn('จัดทัพใหม่', '', () => go({ k: 'deck' })), btn('หน้าแรก', '', () => go({ k: 'title' })));
  box.append(row);
  app.append(box);
}

void loadSprites().then(() => go(dev.battle ? { k: 'match', team: dev.team ?? profile.team, seed: dev.seed, redraws: 0 } : { k: 'title' }));
