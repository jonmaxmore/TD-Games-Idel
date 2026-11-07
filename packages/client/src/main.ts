// The player's path through the app: title → team setup → castle battle → result → back.
// Dev and shots shortcut: ?mode=battle jumps straight into a match; &bot=1 lets bots play both sides, &speed=4 fast-forwards,
// &seed=N picks the match, &deck=fire|wood|metal|water|earth (a sect preset), all|mixed (every card) or a comma list of
// card ids to draw from (&leader=, &sub= the leaders).
import { battle, battleUnits, createBattle, sects, stepBattle, TICK_HZ, type Side } from '@five-sects/sim';
import { el, startMatch, type MatchResult } from './battle';
import { portrait } from './board';
import { aiTeam, ALL_NAME, COLLECTION, fixTeam, isBasic, PRESETS, presetMatch, presetTeam, resolveTeam, teamSetup, type Team } from './decks';
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

// ---- title: the name, a line of disciples facing a line of beasts, start ----
function title() {
  const r = el('div', 'screen title');
  const face = el('div', 'faceoff');
  const beasts = ['demon', 'divine', 'dragon'].flatMap((k) => COLLECTION.filter((c) => battleUnits.get(c)!.kind === k && battleUnits.get(c)!.size !== 'small').slice(0, k === 'divine' ? 2 : 1));
  const side = (cards: readonly string[], s: Side) => { const row = el('div', `line side${s}`); for (const c of cards) row.append(portrait(c, s, s === 1)); return row; };
  face.append(side(PRESETS[0]!.cards.slice(0, 4), 0), el('span', 'vs', 'ปะทะ'), side(beasts, 1));
  r.append(
    el('div', 'grow'), el('h1', '', 'ศึกห้าสำนัก'), el('p', 'sub', 'ศึกชิงเมือง · อัญเชิญศิษย์และสัตว์เทพ ยึดป้อม ทลายปราสาทศัตรูให้ได้ใน 3 นาที'), face,
    btn('เริ่มศึก', 'primary big start', () => go({ k: 'deck' })), el('div', 'grow'), el('p', 'dim center', 'คลิกการ์ดแล้วคลิกบนเส้นทาง หรือลากการ์ดลงสนาม · ปุ่ม 1–7 เลือกการ์ด · Space เล็งปืนใหญ่แล้วคลิกยิง · F เต็มจอ'),
  );
  app.append(r);
}

// ---- team setup: every card, filtered by kind, cost and role; leader, sub-leader and bench; presets; the dealt hand ----
const kindOf = (c: string) => battle.kinds.get(battleUnits.get(c)!.kind)!;
const roleLine = (c: string) => { const u = battleUnits.get(c)!, m = battle.moves.get(u.move)!; return `${kindOf(c)} · ${m.roleTh} · ${m.nameTh}`; };
function abilityText(c: string, level: number): string | null {
  const u = battleUnits.get(c)!;
  if (!u.ability) return null;
  const a = battle.abilities.get(u.ability.kind)!;
  return `${a.nameTh} Lv${level}: ${a.doesTh.replace('{v}', String(u.ability.lv[level - 1]))}`;
}
const colorOf = (c: string) => sects.get(battleUnits.get(c)!.sect)?.color ?? '#E3B04B';
// The filter bar: one row of chips per key, 'all' first; a card shows when it matches every key.
type Filter = { kind: string; cost: string; role: string };
const FILTERS: { key: keyof Filter; label: string; opts: [string, string][]; test: (c: string, v: string) => boolean }[] = [
  { key: 'kind', label: 'ชนิด', opts: [...battle.kinds], test: (c, v) => battleUnits.get(c)!.kind === v },
  { key: 'cost', label: 'ราคา', opts: [1, 2, 3, 4, 5, 6, 7].map((n) => [String(n), String(n)]), test: (c, v) => battleUnits.get(c)!.mana === Number(v) },
  { key: 'role', label: 'บทบาท', opts: [['บุก', 'ตัวบุก'], ['สกัด', 'ตัวสกัด']], test: (c, v) => battle.moves.get(battleUnits.get(c)!.move)!.roleTh === v },
];
function teamScreen() {
  const r = el('div', 'screen team');
  r.append(el('h1', '', 'จัดทัพ'));
  const body = el('div', 'team-body'), list = el('div', 'deck-list'), main = el('div', 'team-main'), bar = el('div', 'filters'), grid = el('div', 'team-cards many');
  main.append(bar, grid);
  body.append(list, main);
  const info = el('p', 'team-info'), handRow = el('div', 'hand-row'), redrawBtn = btn('', 'redraw', () => { redraws++; show(); });
  const seed = (Date.now() % 100000) + 1;
  const filter: Filter = { kind: '', cost: '', role: '' };
  let redraws = 0;
  const setTeam = (t: Team) => { profile.team = fixTeam(t); save(profile); redraws = 0; show(); };
  const describe = (c: string) => {
    const u = battleUnits.get(c)!, cap = u.perMatch, t = profile.team;
    const lv = c === t.leader ? 3 : c === t.sub ? 2 : 1, ab = abilityText(c, lv);
    info.textContent = `${u.nameTh} · ${roleLine(c)} · ${battle.sizes.get(u.size)!.nameTh} · ${cap == null ? 'ลงได้ไม่จำกัด' : `ลงได้ ${cap} ครั้ง`} · HP ${u.hp} · ตี ${u.dmg}${u.hitsAir ? ' · ตีอากาศได้' : ''} · ${u.tagTh}${ab ? ` · ${ab}` : ''}`;
  };
  const chips = FILTERS.map((f) => {
    const row = el('div', 'chips');
    row.append(el('span', 'chip-label', f.label));
    for (const [v, name] of [['', 'ทั้งหมด'] as [string, string], ...f.opts]) {
      const b = btn(name, 'chip', () => { filter[f.key] = v; show(); });
      b.dataset.f = `${f.key}:${v || 'all'}`;
      row.append(b);
    }
    bar.append(row);
    return row;
  });
  const count = el('small', 'count');
  bar.append(count);
  const show = () => {
    const t = profile.team, preset = presetMatch(t);
    for (const b of Array.from(list.querySelectorAll('.deck-row'))) b.classList.toggle('sel', (b as HTMLElement).dataset.id === (preset?.id ?? (t.bench.length === 0 ? 'all' : '')));
    FILTERS.forEach((f, i) => { for (const b of Array.from(chips[i]!.querySelectorAll('.chip'))) b.classList.toggle('on', (b as HTMLElement).dataset.f === `${f.key}:${filter[f.key] || 'all'}`); });
    const shown = COLLECTION.filter((c) => FILTERS.every((f) => !filter[f.key] || f.test(c, filter[f.key])));
    count.textContent = `แสดง ${shown.length} จาก ${COLLECTION.length} ตัว · เข้ากองสุ่ม ${COLLECTION.length - t.bench.length} ตัว`;
    grid.replaceChildren(...shown.map((id) => {
      const u = battleUnits.get(id)!, role = id === t.leader ? 'leader' : id === t.sub ? 'sub' : t.bench.includes(id) ? 'bench' : isBasic(id) ? 'basic' : '';
      const tile = el('div', `team-card ${role} kind-${u.kind}`);
      tile.dataset.id = id;
      tile.style.borderColor = colorOf(id);
      const face = el('span', 'face');
      face.append(cardArt(id) ?? portrait(id));
      const badge = { leader: 'แม่ทัพ', sub: 'รองแม่ทัพ', bench: 'สำรอง', basic: 'ยึดป้อม', '': '' }[role];
      tile.append(face, el('span', 'cost', String(u.mana)), nowrapWords(el('b'), u.nameTh), el('small', '', roleLine(id)));
      if (badge) tile.append(el('em', '', badge));
      if (!isBasic(id)) {
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
      m.dataset.id = id;
      m.style.borderColor = colorOf(id);
      const face = el('span', 'face');
      face.append(cardArt(id) ?? portrait(id));
      m.append(face, el('span', 'cost', String(u.mana)), nowrapWords(el('b'), u.nameTh), el('small', '', i === 0 ? 'ยึดป้อม' : i === 1 ? 'แม่ทัพ' : i === 2 ? 'รอง' : `สุ่ม · ${kindOf(id)}`));
      m.addEventListener('pointerenter', () => describe(id));
      return m;
    }));
    const left = battle.hand.redraws - redraws;
    redrawBtn.textContent = `สับมือใหม่ (เหลือ ${left})`;
    redrawBtn.disabled = left <= 0;
    describe(t.leader);
  };
  list.append(el('span', 'list-label', 'ทัพสำเร็จรูป'));
  for (const d of [{ id: 'all', nameTh: ALL_NAME, color: '#E3B04B', cards: COLLECTION }, ...PRESETS]) {
    const b = btn('', 'deck-row', () => setTeam(d.id === 'all' ? { ...profile.team, bench: [] } : presetTeam(d.id)));
    b.dataset.id = d.id;
    b.style.borderLeftColor = d.color;
    b.append(el('b', '', d.nameTh), el('small', '', d.id === 'all' ? `สุ่มจากทั้ง ${d.cards.length} ตัว` : `ศิษย์สำนักนี้ ${d.cards.length} ตัว · ตัวอื่นเป็นสำรอง`));
    list.append(b);
  }
  const row = el('div', 'row actions');
  row.append(btn('กลับ', '', () => go({ k: 'title' })), redrawBtn, btn('เข้าสู่ศึก', 'primary', () => go({ k: 'match', team: profile.team, seed, redraws })));
  r.append(body, info, handRow, row);
  app.append(r);
  show();
}

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
