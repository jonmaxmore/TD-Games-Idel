// The player's path through the app (ui-flow.md §3): title (a click starts the sound) → lobby → team setup → versus →
// castle battle → result (rewards, one next step) → back. ศึกปราบ: lobby → stage map or the next stage's briefing → team
// setup or straight in → versus → stage match → result with stars. ศึกฝีมือ: the result moves the rank and keeps the match
// for a replay.
// Dev and shots shortcut: ?mode=battle jumps straight into a match, without the versus screen (&stage=1-4 a ศึกปราบ stage); &bot=1 lets bots play both sides, &speed=4 fast-forwards,
// &seed=N picks the match, &deck=fire|wood|metal|water|earth (a sect preset), all|mixed (every card) or a comma list of
// card ids to draw from (&leader=, &sub= the leaders).
import { battle, battleUnits, chapter, createBattle, sects, stageOf, stages, STARS, stepBattle, TICK_HZ, type Side, type Stage } from '@five-sects/sim';
import { el, realmBadge, startMatch, type MatchResult } from './battle';
import { aiProgress, canLevel, payMatch, progressOf, recordRanked, recordStage, stageOpen } from './camp';
import { campScreen } from './campScreen';
import { portrait } from './board';
import { aiTeam, ALL_NAME, COLLECTION, fixTeam, isBasic, PRESETS, presetMatch, presetTeam, resolveTeam, teamName, teamSetup, type Team } from './decks';
import { lobbyScreen, rankBadge, starCount, toggleFullscreen } from './lobby';
import { load, save, type Mode, type Profile } from './profile';
import { initSound, unlockAudio } from './sound';
import { cardArt, loadSprites } from './sprites';
import { lossTip, versusTip } from './tips';
import { unlockState } from './unlocks';
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
addEventListener('keydown', (e) => { if (e.key === 'f') toggleFullscreen(); });
const q = new URLSearchParams(location.search);
const dev = { battle: q.get('mode') === 'battle', bot: q.get('bot') === '1', speed: Number(q.get('speed') ?? 1), seed: Number(q.get('seed') ?? 1), team: resolveTeam(q), stage: stageOf(q.get('stage') ?? '')?.id };
const profile: Profile = load();
initSound(profile.settings);

type Fight = { team: Team; seed: number; redraws: number; stage?: string };
type Screen =
  | { k: 'title' } | { k: 'lobby' } | { k: 'deck'; stage?: string } | { k: 'camp' } | { k: 'campaign' } | { k: 'brief'; stage: string } | { k: 'replay' }
  | ({ k: 'versus' } & Fight) | ({ k: 'match' } & Fight);
let dispose: (() => void) | void;

function go(next: Screen) {
  if (dispose) dispose();
  dispose = undefined;
  app.replaceChildren();
  Object.assign(window, { __flow: { screen: next.k } });
  if (next.k === 'title') dispose = title();
  else if (next.k === 'lobby') dispose = lobbyScreen(app, profile, () => save(profile), {
    stage: (id) => go({ k: 'brief', stage: id }), map: () => go({ k: 'campaign' }), camp: () => go({ k: 'camp' }),
    mode: (m) => { profile.mode = m; save(profile); go({ k: 'deck' }); },
  });
  else if (next.k === 'deck') teamScreen(next.stage ? stageOf(next.stage) : undefined);
  else if (next.k === 'camp') dispose = campScreen(app, profile, () => save(profile), () => go({ k: 'lobby' }));
  else if (next.k === 'versus') dispose = versus(next);
  else if (next.k === 'campaign') campaignMap();
  else if (next.k === 'brief') briefing(stageOf(next.stage)!);
  else if (next.k === 'replay') dispose = replay();
  else dispose = match(next.team, next.seed, next.redraws, next.stage ? stageOf(next.stage) : undefined);
}

function btn(text: string, cls: string, onclick: () => void): HTMLButtonElement {
  const b = el('button', cls, text);
  b.onclick = onclick;
  return b;
}

// ---- title: the name, a line of disciples facing a line of beasts, "คลิกเพื่อเริ่ม" (the click also starts the sound) ----
function title(): () => void {
  const r = el('div', 'screen title');
  const face = el('div', 'faceoff');
  const beasts = ['demon', 'divine', 'dragon'].flatMap((k) => COLLECTION.filter((c) => battleUnits.get(c)!.kind === k && battleUnits.get(c)!.size !== 'small').slice(0, k === 'divine' ? 2 : 1));
  const side = (cards: readonly string[], s: Side) => { const row = el('div', `line side${s}`); for (const c of cards) row.append(portrait(c, s, s === 1)); return row; };
  face.append(side(PRESETS[0]!.cards.slice(0, 4), 0), el('span', 'vs', 'ปะทะ'), side(beasts, 1));
  r.append(el('div', 'grow'), el('h1', '', 'ศึกห้าสำนัก'), el('p', 'sub', 'ศึกชิงเมือง · อัญเชิญศิษย์และสัตว์เทพ ยึดป้อม ทลายปราสาทศัตรูให้ได้ใน 3 นาที'), face,
    el('p', 'start-hint', 'คลิกเพื่อเริ่ม'), el('div', 'grow'));
  app.append(r);
  const start = () => { unlockAudio(); go({ k: 'lobby' }); };
  const onKey = (e: KeyboardEvent) => { if (e.key !== 'f') start(); };
  r.addEventListener('pointerdown', start);
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}

// The two ways into a match besides ศึกปราบ: ศึกทั่วไป (levels, forge and town count) and ศึกฝีมือ (every card at base stats).
const MODES: [Mode, string][] = [['casual', 'ศึกทั่วไป'], ['ranked', 'ศึกฝีมือ (เลเวลเท่ากัน)']];
const modeName = (m: Mode) => MODES.find((x) => x[0] === m)![1];

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
function teamScreen(stage?: Stage) {
  const r = el('div', 'screen team');
  r.append(el('h1', '', `จัดทัพ · ${stage ? `ศึกปราบ ${stage.id} ${stage.nameTh}` : modeName(profile.mode)}`));
  const lv = (c: string) => realmBadge(profile.cards[c]!.level);
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
      tile.append(face, el('span', 'cost', String(u.mana)), lv(id), nowrapWords(el('b'), u.nameTh), el('small', '', roleLine(id)));
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
      m.append(face, el('span', 'cost', String(u.mana)), lv(id), nowrapWords(el('b'), u.nameTh), el('small', '', i === 0 ? 'ยึดป้อม' : i === 1 ? 'แม่ทัพ' : i === 2 ? 'รอง' : `สุ่ม · ${kindOf(id)}`));
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
  row.append(btn('กลับ', '', () => go(stage ? { k: 'brief', stage: stage.id } : { k: 'lobby' })), redrawBtn, btn('เข้าสู่ศึก', 'primary', () => go({ k: 'versus', team: profile.team, seed, redraws, stage: stage?.id })));
  r.append(body, info, handRow, row);
  app.append(r);
  show();
}

// ---- ศึกปราบ: the stage map, then a stage's briefing ----
const stars = (got: readonly boolean[]) => got.map((x) => (x ? '★' : '☆')).join('');
// Where each stage sits on the map, in % of the map box, along a winding road from the bottom left.
const MAP_AT: [number, number][] = [[11, 76], [27, 38], [44, 72], [60, 30], [76, 66], [89, 26], [70, 12], [50, 14]];
function campaignMap() {
  const r = el('div', 'screen campaign');
  r.append(el('h1', '', `ศึกปราบ · ${chapter.nameTh}`), el('p', 'dim center', `ดาวทั้งหมด ${starCount(profile)}/${stages.length * 3} · ชนะด่านหนึ่งเพื่อเปิดด่านถัดไป`));
  const map = el('div', 'stage-map');
  const ids = stages.map((s) => s.id);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  const road = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  road.setAttribute('points', stages.map((_, i) => MAP_AT[i]!.join(',')).join(' '));
  svg.append(road);
  map.append(svg);
  stages.forEach((st, i) => {
    const open = stageOpen(profile, ids, i), got = profile.campaign[st.id]?.stars ?? [false, false, false];
    const b = btn('', `stage-node${open ? '' : ' locked'}${got[0] ? ' won' : ''}`, () => { if (open) go({ k: 'brief', stage: st.id }); });
    b.dataset.stage = st.id;
    b.disabled = !open;
    b.style.left = `${MAP_AT[i]![0]}%`;
    b.style.top = `${MAP_AT[i]![1]}%`;
    b.append(el('span', 'id', st.id), nowrapWords(el('b'), st.nameTh), el('span', 'stars', open ? stars(got) : 'ยังไม่เปิด'));
    if (open) b.append(el('small', '', st.gimmickTh));
    map.append(b);
  });
  const row = el('div', 'row actions');
  row.append(btn('กลับล็อบบี้', '', () => go({ k: 'lobby' })));
  r.append(map, row);
  app.append(r);
}

function briefing(st: Stage) {
  const r = el('div', 'screen brief');
  const best = profile.campaign[st.id];
  r.append(el('h1', '', `ด่าน ${st.id} · ${st.nameTh}`), el('p', 'brief-text', st.briefTh));
  const gim = el('div', 'panel gimmick-box');
  gim.append(el('h2', '', `กลไก: ${st.gimmickTh}`), el('p', '', st.gimmickDescTh));
  const foe = el('div', 'panel enemy-box');
  const cards = el('div', 'enemy-cards');
  for (const c of st.enemy.collection) {
    const u = battleUnits.get(c)!, t = el('div', 'enemy-card');
    t.style.borderColor = colorOf(c);
    t.append(portrait(c, 1, true), nowrapWords(el('b'), u.nameTh), el('small', '', c === st.enemy.leader ? 'แม่ทัพ' : c === st.enemy.sub ? 'รอง' : kindOf(c)));
    cards.append(t);
  }
  const regen = st.rules.regenPct === 100 ? 'ไหลปกติ' : `ไหล ${st.rules.regenPct}% ของปกติ`;
  foe.append(el('h2', '', `ทัพศัตรู · ทุกตัว Lv${st.level}`), el('p', 'dim', `ปราณเริ่ม ${st.rules.manaStart} · ${regen} · ป้อม ${st.rules.fortsAtPct.length} แห่ง`), cards);
  const goals = el('div', 'panel goals-box');
  goals.append(el('h2', '', 'เป้าหมายดาว'));
  STARS.namesTh.forEach((name, i) => goals.append(el('p', best?.stars[i] ? 'got' : '', `${best?.stars[i] ? '★' : '☆'} ${name}`)));
  const w = st.rewards.win;
  goals.append(el('p', 'dim', `ชนะได้ แต้มฝึก +${w.xp} · เหรียญ +${w.coins} · ทองคำ +${w.gold}`));
  if (best?.bestSec != null) goals.append(el('p', 'dim', `ชนะเร็วสุด ${Math.floor(best.bestSec / 60)}:${String(best.bestSec % 60).padStart(2, '0')}`));
  const body = el('div', 'brief-body');
  const left = el('div', 'brief-col');
  left.append(gim, goals);
  body.append(left, foe);
  const row = el('div', 'row actions');
  row.append(btn('แผนที่', '', () => go({ k: 'campaign' })), btn('จัดทัพ', '', () => go({ k: 'deck', stage: st.id })),
    btn('เข้าสู่ศึก', 'primary', () => go({ k: 'versus', team: profile.team, seed: (Date.now() % 100000) + 1, redraws: 0, stage: st.id })));
  r.append(body, row);
  app.append(r);
}

// ---- versus → match → result ----
// About 1.5 s before every match: our leader against theirs, both team names, the mode or stage, and one tip. A click skips it.
function versus(f: Fight): () => void {
  const stage = f.stage ? stageOf(f.stage) : undefined, foe = stage ? stage.enemy : aiTeam(f.team);
  const r = el('div', 'screen versus');
  const side = (card: string, s: Side, team: string, role: string) => {
    const box = el('div', `vs-side side${s}`), face = el('div', 'vs-face');
    face.append(portrait(card, s, s === 1));
    box.style.setProperty('--sect', colorOf(card));
    box.append(face, nowrapWords(el('b'), battleUnits.get(card)!.nameTh), el('small', '', role), el('span', 'vs-team', team));
    return box;
  };
  const mode = stage ? `ศึกปราบ ด่าน ${stage.id} · ${stage.nameTh}` : modeName(profile.mode);
  const mid = el('div', 'vs-mid');
  mid.append(el('span', 'vs-word', 'ปะทะ'), el('span', 'vs-mode', mode));
  const row = el('div', 'vs-row');
  row.append(side(f.team.leader, 0, teamName(f.team), 'แม่ทัพเรา'), mid, side(foe.leader, 1, stage ? stage.nameTh : teamName(foe as Team), 'แม่ทัพศัตรู'));
  r.append(el('div', 'grow'), row, el('p', 'vs-tip', `เคล็ดลับ: ${versusTip(f.seed)}`), el('p', 'dim center small', 'คลิกเพื่อข้าม'), el('div', 'grow'));
  app.append(r);
  const start = () => go({ ...f, k: 'match' });
  const timer = setTimeout(start, 1500);
  r.addEventListener('pointerdown', start);
  return () => clearTimeout(timer);
}

function match(team: Team, seed: number, redraws: number, stage?: Stage) {
  const ranked = !stage && profile.mode === 'ranked';
  return startMatch(app, {
    seed, team, vs: aiTeam(team), redraws, speed: dev.speed, settings: profile.settings, saveSettings: () => save(profile),
    bots: stage || ranked ? [dev.bot ? 'paced' : null, 'paced'] : [dev.bot ? 'rush' : null, 'rush'],
    normalized: ranked, progress: ranked ? [null, null] : [progressOf(profile, Date.now()), aiProgress(profile)],
    modeTh: stage ? `ศึกปราบ ${stage.id}` : ranked ? 'ศึกฝีมือ' : 'ศึกทั่วไป',
    stage: stage ? { rules: stage.rules, enemy: stage.enemy, nameTh: stage.nameTh, gimmickTh: stage.gimmickTh } : undefined,
    onQuit: () => go({ k: 'lobby' }),
  }, (r) => result(team, seed, r, stage, ranked));
}

// The last ranked match played back from its record; the result says whether it ended on the saved hash.
function replay() {
  const last = profile.lastRanked!, s0 = last.setups[0];
  const team: Team = { leader: s0.leader, sub: s0.sub, bench: [...s0.bench] };
  return startMatch(app, {
    seed: last.seed, team, vs: aiTeam(team), redraws: 0, speed: dev.speed, settings: profile.settings, saveSettings: () => save(profile),
    bots: [null, 'paced'], normalized: true, progress: [null, null], modeTh: 'ศึกฝีมือ', replay: last, onQuit: () => go({ k: 'lobby' }),
  }, (r) => {
    const box = el('div', 'modal result');
    const same = r.hash === last.hash;
    box.append(el('h2', '', 'จบรีเพลย์'), el('p', 'why', verdict(r).head), el('p', same ? 'dim' : 'why', same ? 'ผลตรงกับศึกที่บันทึกไว้ทุกอย่าง' : 'ผลไม่ตรงกับที่บันทึกไว้'));
    const row = el('div', 'row');
    row.append(btn('ดูอีกครั้ง', 'primary', () => go({ k: 'replay' })), btn('กลับล็อบบี้', '', () => go({ k: 'lobby' })));
    box.append(row);
    app.append(box);
  });
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

function result(team: Team, seed: number, r: MatchResult, stage: Stage | undefined, ranked: boolean) {
  const box = el('div', 'modal result');
  const head = r.winner === 0 ? ['won', 'ชนะ!'] : r.winner === 1 ? ['lost', 'พ่ายแพ้'] : ['draw', 'เสมอ'];
  const t = Math.floor(r.tick / TICK_HZ), v = verdict(r);
  box.append(el('h2', head[0], head[1]), el('p', `type ${head[0]}`, v.head), el('p', 'why', v.why),
    el('p', 'dim', `ปราสาทเรา ${Math.max(0, r.castles[0])} · ปราสาทศัตรู ${Math.max(0, r.castles[1])} · เวลา ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`));
  // The rewards, paid into the save once as the result shows.
  const won = r.winner === -1 ? null : r.winner === 0;
  const pay = payMatch(profile, r.hand, won, r.type, stage);
  if (stage) {
    const fresh = recordStage(profile, stage.id, r.stars, t);
    const row = el('div', 'star-row');
    STARS.namesTh.forEach((name, i) => {
      const s = el('div', `star${r.stars[i] ? ' got' : ''}${fresh[i] ? ' new' : ''}`);
      s.append(el('b', '', r.stars[i] ? '★' : '☆'), el('small', '', name));
      if (fresh[i]) s.append(el('em', '', 'ใหม่'));
      row.append(s);
    });
    box.append(row);
  }
  if (ranked) {
    const { before, after } = recordRanked(profile, won);
    profile.lastRanked = { ...r.record, hash: r.hash };
    const line = el('p', 'rank-change');
    line.append(rankBadge(before), el('span', '', ' → '), rankBadge(after));
    box.append(line);
  }
  save(profile);
  const ready = r.hand.filter((c, i) => r.hand.indexOf(c) === i && canLevel(profile, c)).map((c) => battleUnits.get(c)!.nameTh);
  const gains = el('div', 'rewards');
  gains.append(el('b', '', 'รางวัล'), el('span', '', `แต้มฝึก +${pay.xp} ให้ทุกใบในมือ`), el('span', 'coin', `เหรียญ +${pay.coins}`), el('span', 'gold', `ทองคำ +${pay.gold}`));
  const camp = unlockState(profile).open.has('levelUp');
  box.append(gains);
  if (camp && ready.length > 0) box.append(el('p', 'dim', `เลื่อนขั้นได้ที่ค่ายฝึก: ${ready.join(' · ')}`));
  // A loss names its likeliest cause and one card that answers it.
  const tip = won === false ? lossTip(r.foeDmg, [...COLLECTION.filter((c) => !team.bench.includes(c)), ...team.bench]) : null;
  if (tip) box.append(nowrapWords(el('p', 'loss-tip'), `คำแนะนำ: ${tip}`));
  // Exactly one primary: the next stage after a stage win, another match after a ranked or casual win or draw, else a retry.
  const next = stage ? stages[stages.indexOf(stage) + 1] : undefined;
  const again = () => go({ k: 'versus', team, seed: seed + 1, redraws: 0, stage: stage?.id });
  const last = stage && won && !next;
  const primary = stage && won ? (next ? btn('ด่านถัดไป', 'primary', () => go({ k: 'brief', stage: next.id })) : btn('กลับล็อบบี้', 'primary', () => go({ k: 'lobby' })))
    : !stage && won !== false ? btn('อีกแมตช์', 'primary', again) : btn('ลองใหม่', 'primary', again);
  primary.dataset.primary = '1';
  const row = el('div', 'row result-actions');
  row.append(primary);
  if (camp) row.append(btn('ค่ายฝึก', '', () => go({ k: 'camp' })));
  if (ranked) row.append(btn('ดูรีเพลย์', 'replay-btn', () => go({ k: 'replay' })));
  if (!last) row.append(btn('กลับล็อบบี้', '', () => go({ k: 'lobby' })));
  box.append(row);
  app.append(box);
}

void loadSprites().then(() => go(dev.battle ? { k: 'match', team: dev.team ?? profile.team, seed: dev.seed, redraws: 0, stage: dev.stage } : { k: 'title' }));
