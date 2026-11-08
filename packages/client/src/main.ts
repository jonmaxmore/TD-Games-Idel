// The player's path through the app (ui-flow.md §3): title (a click starts the sound) → lobby → team setup → versus →
// castle battle → result (rewards, one next step) → back. ศึกปราบ: lobby → stage map or the next stage's briefing → team
// setup or straight in → versus → stage match → result with stars. ศึกฝีมือ: the result moves the rank and keeps the match
// for a replay.
// Dev and shots shortcut: ?mode=battle jumps straight into a match, without the versus screen (&stage=1-4 a ศึกปราบ stage); &bot=1 lets bots play both sides, &speed=4 fast-forwards,
// &seed=N picks the match, &deck=fire|wood|metal|water|earth (a sect preset), all|mixed (every card) or a comma list of
// card ids to draw from (&leader=, &sub= the leaders).
import {
  battle, battleCardIds, battleUnits, chapter, createBattle, draw, gimmickNames, homeSects, rewardCard, sectCards, sects, stageOf, stages, starName, starterCards, starterTeam, stepBattle, TICK_HZ,
  type BattleSetup, type Side, type Stage,
} from '@five-sects/sim';
import { Lockstep, pvpSetup, type MatchEnd } from '@five-sects/protocol';
import { el, realmBadge, startMatch, type MatchResult } from './battle';
import { aiProgress, canLevel, chooseHome, claim, payMatch, progressOf, recordRanked, recordStage, stageOpen, type Claimed } from './camp';
import { campScreen } from './campScreen';
import { portrait } from './board';
import { aiSetup, benchRoom, fixTeam, isBasic, rankedSetup, resolveTeam, teamName, teamSetup, type Team } from './decks';
import { lobbyScreen, rankBadge, starCount, toggleFullscreen } from './lobby';
import { load, save, type Mode, type Profile } from './profile';
import { initSound, unlockAudio } from './sound';
import { cardArt, loadSprites } from './sprites';
import { lossTip, versusTip } from './tips';
import { unlockState } from './unlocks';
import { nowrapWords } from './words';
import { REJECT_TH, type RoomClient } from './net';
import { dropClient, pvpScreen, type Start } from './pvp';

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
claim(profile); // an older save's won stages pay their first clears once a home sect is set
initSound(profile.settings);

type Fight = { team: Team; seed: number; redraws: number; stage?: string };
type Screen =
  | { k: 'title' } | { k: 'pick' } | { k: 'lobby' } | { k: 'deck'; stage?: string } | { k: 'camp' } | { k: 'campaign' } | { k: 'brief'; stage: string } | { k: 'replay' }
  | ({ k: 'versus' } & Fight) | ({ k: 'match' } & Fight) | { k: 'pvp' } | { k: 'pvpVs' } | { k: 'pvpMatch' };
let dispose: (() => void) | void;

function go(next: Screen) {
  if (dispose) dispose();
  dispose = undefined;
  app.replaceChildren();
  Object.assign(window, { __flow: { screen: next.k } });
  if (next.k === 'title') dispose = title();
  else if (next.k === 'pick') pickHome();
  else if (next.k === 'lobby') dispose = lobbyScreen(app, profile, () => save(profile), {
    stage: (id) => go({ k: 'brief', stage: id }), map: () => go({ k: 'campaign' }), camp: () => go({ k: 'camp' }),
    mode: (m) => { profile.mode = m; save(profile); go({ k: 'deck' }); },
    pvp: () => go({ k: 'pvp' }),
  });
  else if (next.k === 'pvp') dispose = pvpScreen(app, profile, { lobby: () => go({ k: 'lobby' }), start: (m, c) => { pvpLive(m, c); go({ k: 'pvpVs' }); } });
  else if (next.k === 'pvpVs') dispose = pvpVersus();
  else if (next.k === 'pvpMatch') dispose = pvpMatch();
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
  const beasts = ['demon', 'divine', 'dragon'].flatMap((k) => battleCardIds.filter((c) => battleUnits.get(c)!.kind === k && battleUnits.get(c)!.size !== 'small').slice(0, k === 'divine' ? 2 : 1));
  const side = (cards: readonly string[], s: Side) => { const row = el('div', `line side${s}`); for (const c of cards) row.append(portrait(c, s, s === 1)); return row; };
  face.append(side(sectCards('fire').slice(0, 4), 0), el('span', 'vs', 'ปะทะ'), side(beasts, 1));
  r.append(el('div', 'grow'), el('h1', '', 'ศึกห้าสำนัก'), el('p', 'sub', 'ศึกชิงเมือง · อัญเชิญศิษย์และสัตว์เทพ ยึดป้อม ทลายปราสาทศัตรูให้ได้ใน 3 นาที'), face,
    el('p', 'start-hint', 'คลิกเพื่อเริ่ม'), el('div', 'grow'));
  app.append(r);
  const start = () => { unlockAudio(); go({ k: profile.home ? 'lobby' : 'pick' }); };
  const onKey = (e: KeyboardEvent) => { if (e.key !== 'f') start(); };
  r.addEventListener('pointerdown', start);
  addEventListener('keydown', onKey);
  return () => removeEventListener('keydown', onKey);
}

// ---- เลือกสำนักแรก (first run, ui-flow.md §2.1): one of five home sects; its blade, striker and control join the starter
// cards everyone owns (collection.json), the striker leads. Then straight to stage 1-1. ----
function pickHome() {
  const r = el('div', 'screen pick');
  r.append(el('h1', '', 'เลือกสำนักแรก'), el('p', 'dim center', 'สำนักแรกคือบ้านเกิดของเรา ได้ศิษย์ 3 คนของสำนักนั้น พร้อมธงยึดป้อมทั้ง 5 สำนักและนักธนูพเนจร การ์ดสำนักอื่นได้ทีหลังจากด่านและร้านไข่'));
  const row = el('div', 'pick-row');
  for (const home of homeSects) {
    const sc = sects.get(home)!, t = starterTeam(home), mine = starterCards(home).filter((c) => battleUnits.get(c)!.sect === home && !isBasic(c));
    const b = btn('', 'pick-card', () => { chooseHome(profile, home); save(profile); go({ k: 'brief', stage: stages[0]!.id }); });
    b.dataset.home = home;
    b.style.setProperty('--sect', sc.color);
    const faces = el('div', 'pick-faces');
    for (const c of mine) { const f = el('span', 'face'); f.append(cardArt(c) ?? portrait(c)); faces.append(f); }
    b.append(el('b', 'pick-name', sc.nameTh), faces, ...mine.map((c) => el('small', '', `${battleUnits.get(c)!.nameTh}${c === t.leader ? ' · แม่ทัพ' : c === t.sub ? ' · รอง' : ''}`)),
      el('p', 'pick-tag', battleUnits.get(t.leader)!.tagTh));
    row.append(b);
  }
  r.append(row, el('p', 'dim center small', 'ศึกฝีมือ (จัดอันดับ) ใช้การ์ดทุกใบที่ค่าเท่ากัน สำนักแรกจึงไม่ทำให้ได้เปรียบหรือเสียเปรียบ'));
  app.append(r);
}

// The two ways into a match besides ศึกปราบ: ศึกทั่วไป (levels, forge and town count) and ศึกฝีมือ (every card at base stats).
const MODES: [Mode, string][] = [['casual', 'ศึกทั่วไป'], ['ranked', 'ศึกฝีมือ (เลเวลเท่ากัน)']];
const modeName = (m: Mode) => MODES.find((x) => x[0] === m)![1];

// ---- team setup: the owned cards, filtered by kind, cost and role; leader, sub-leader and bench (never below the minimum
// draw pool); the dealt hand ----
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
  const body = el('div', 'team-body'), main = el('div', 'team-main'), bar = el('div', 'filters'), grid = el('div', 'team-cards many');
  main.append(bar, grid);
  body.append(main);
  const owned = profile.owned, foe: BattleSetup = stage ? stage.enemy : aiSetup(profile.team);
  const info = el('p', 'team-info'), handRow = el('div', 'hand-row'), redrawBtn = btn('', 'redraw', () => { redraws++; show(); });
  const seed = (Date.now() % 100000) + 1;
  const filter: Filter = { kind: '', cost: '', role: '' };
  let redraws = 0;
  const setTeam = (t: Team) => { profile.team = fixTeam(t, owned, profile.home); save(profile); redraws = 0; show(); };
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
    const t = profile.team, room = benchRoom(t, owned);
    FILTERS.forEach((f, i) => { for (const b of Array.from(chips[i]!.querySelectorAll('.chip'))) b.classList.toggle('on', (b as HTMLElement).dataset.f === `${f.key}:${filter[f.key] || 'all'}`); });
    const shown = owned.filter((c) => FILTERS.every((f) => !filter[f.key] || f.test(c, filter[f.key])));
    const pool = owned.filter((c) => !isBasic(c) && c !== t.leader && c !== t.sub && !t.bench.includes(c)).length;
    count.textContent = `แสดง ${shown.length} จาก ${owned.length} ใบที่มี · กองสุ่ม ${pool} ใบ${room > 0 ? ` · ใส่สำรองได้อีก ${room}` : ` · สำรองได้เมื่อกองสุ่มเกิน ${draw.minDrawPool} ใบ`}`;
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
        const benchBtn = acts.lastElementChild as HTMLButtonElement;
        benchBtn.disabled = role !== 'bench' && (room <= 0 || id === t.leader || id === t.sub);
        benchBtn.title = `กองสุ่มต้องเหลืออย่างน้อย ${draw.minDrawPool} ใบ`;
        tile.append(acts);
      }
      tile.addEventListener('pointerenter', () => describe(id));
      return tile;
    }));
    // The deal the match will start from: the same seed and redraws, played through the sim's own redraw command.
    const s = createBattle(seed, profile.mode === 'ranked' && !stage ? rankedSetup(t) : teamSetup(t, owned), stage ? foe : aiSetup(t));
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
  if (profile.mode === 'ranked' && !stage) bar.append(el('small', 'count', 'ศึกฝีมือ: มือสุ่มจากการ์ดทุกใบในเกม ค่าเท่ากัน ใช้แค่แม่ทัพและรองที่เลือก'));
  const row = el('div', 'row actions');
  row.append(btn('กลับ', '', () => go(stage ? { k: 'brief', stage: stage.id } : { k: 'lobby' })), redrawBtn, btn('เข้าสู่ศึก', 'primary', () => go({ k: 'versus', team: profile.team, seed, redraws, stage: stage?.id })));
  r.append(body, info, handRow, row);
  app.append(r);
  show();
}

// ---- ศึกปราบ: the stage map, then a stage's briefing ----
const stars = (got: readonly boolean[]) => got.map((x) => (x ? '★' : '☆')).join('');
// Where each stage sits on the map, in % of the map box, along a winding road from the bottom left.
const MAP_AT: [number, number][] = [[7, 80], [18, 50], [30, 78], [40, 44], [51, 74], [61, 40], [72, 70], [80, 36], [90, 66], [89, 16]];
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
    if (open && st.gimmicks.length > 0) b.append(el('small', '', gimmickNames(st)));
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
  gim.append(el('h2', '', `สอน: ${st.teachTh}`), ...st.gimmicks.map((g) => el('p', '', `${g.nameTh}: ${g.descTh}`)));
  const foe = el('div', 'panel enemy-box');
  const cards = el('div', 'enemy-cards');
  for (const c of st.enemy.collection) {
    const u = battleUnits.get(c)!, t = el('div', 'enemy-card');
    t.style.borderColor = colorOf(c);
    t.append(portrait(c, 1, true), nowrapWords(el('b'), u.nameTh), el('small', '', c === st.enemy.leader ? 'แม่ทัพ' : c === st.enemy.sub ? 'รอง' : kindOf(c)));
    cards.append(t);
  }
  const regen = st.rules.regenPct === 100 ? 'ไหลปกติ' : `ไหล ${st.rules.regenPct}% ของปกติ`;
  foe.append(el('h2', '', `ทัพศัตรู · ทุกตัว Lv${st.level}`), el('p', 'dim', `ปราณเริ่ม ${st.rules.manaStart[1]} · ${regen} · ป้อม ${st.rules.fortsAtPct.length} แห่ง`), cards);
  gim.append(el('p', 'dim', `ปราณเราเริ่ม ${st.rules.manaStart[0]}${st.rules.fortBonus > 0 ? ` · ยึดป้อมครั้งแรกได้ปราณ +${st.rules.fortBonus} ต่อป้อม` : ''}`));
  const goals = el('div', 'panel goals-box');
  goals.append(el('h2', '', 'เป้าหมายดาว'));
  st.stars.forEach((g, i) => goals.append(el('p', best?.stars[i] ? 'got' : '', `${best?.stars[i] ? '★' : '☆'} ${starName(g)}`)));
  const w = st.rewards.win;
  goals.append(el('p', 'dim', `ชนะได้ แต้มฝึก +${w.xp} · เหรียญ +${w.coins} · ทองคำ +${w.gold}`));
  const fc = st.rewards.firstClear, fcCard = profile.home ? rewardCard(fc, profile.home) : null;
  const paid = profile.claimed.includes(st.id);
  goals.append(el('p', paid ? 'dim' : 'first-clear', `${paid ? 'ได้รางวัลผ่านครั้งแรกแล้ว: ' : 'ผ่านครั้งแรกได้: '}${fcCard ? `การ์ด ${battleUnits.get(fcCard)!.nameTh}${profile.owned.includes(fcCard) && !paid ? ' (มีแล้ว: ได้แต้มไข่แทน)' : ''}` : `แต้มไข่ +${'eggPoints' in fc ? fc.eggPoints : 0}`}`));
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
  const stage = f.stage ? stageOf(f.stage) : undefined, foe = stage ? stage.enemy : aiSetup(f.team);
  const foeLeader = foe.leader || foe.collection.find((c) => !isBasic(c)) || foe.collection[0]!;
  const ai = !stage && profile.mode === 'casual' ? aiProgress(profile, foe, Date.now()).levels![foeLeader] : null;
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
  row.append(side(f.team.leader, 0, teamName(f.team), 'แม่ทัพเรา'), mid, side(foeLeader, 1, stage ? stage.nameTh : `${teamName(foe)}${ai ? ` · เงายุทธ์ (AI) Lv${ai}` : ''}`, stage && !foe.leader ? 'หัวหน้าโจร' : 'แม่ทัพศัตรู'));
  r.append(el('div', 'grow'), row, el('p', 'vs-tip', `เคล็ดลับ: ${versusTip(f.seed)}`), el('p', 'dim center small', 'คลิกเพื่อข้าม'), el('div', 'grow'));
  app.append(r);
  const start = () => go({ ...f, k: 'match' });
  const timer = setTimeout(start, 1500);
  r.addEventListener('pointerdown', start);
  return () => clearTimeout(timer);
}

// Our side: ranked draws from every card (normalized), else the owned cards (a dev ?deck= the cards it names). The casual AI
// plays at the card level whose power score is closest to ours (camp.ts aiProgress).
function match(team: Team, seed: number, redraws: number, stage?: Stage) {
  const ranked = !stage && profile.mode === 'ranked', vs = aiSetup(team);
  const mine = ranked ? rankedSetup(team) : teamSetup(team, dev.battle && dev.team ? dev.team.cards : profile.owned);
  return startMatch(app, {
    seed, team, mine, vs, redraws, speed: dev.speed, settings: profile.settings, saveSettings: () => save(profile),
    bots: stage || ranked ? [dev.bot ? 'paced' : null, 'paced'] : [dev.bot ? 'rush' : null, 'rush'],
    normalized: ranked, progress: ranked ? [null, null] : [progressOf(profile, Date.now()), stage ? null : aiProgress(profile, vs, Date.now())],
    modeTh: stage ? `ศึกปราบ ${stage.id}` : ranked ? 'ศึกฝีมือ' : 'ศึกทั่วไป',
    stage,
    onQuit: () => go({ k: 'lobby' }),
  }, (r) => result(team, seed, r, stage, ranked));
}

// The last ranked match played back from its record; the result says whether it ended on the saved hash.
function replay() {
  const last = profile.lastRanked!, s0 = last.setups[0];
  const team: Team = { leader: s0.leader, sub: s0.sub, bench: [...s0.bench] };
  return startMatch(app, {
    seed: last.seed, team, mine: s0, vs: last.setups[1], redraws: 0, speed: dev.speed, settings: profile.settings, saveSettings: () => save(profile),
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
  let gotten: Claimed[] = [];
  if (stage) {
    const fresh = recordStage(profile, stage.id, r.stars, t);
    gotten = claim(profile);
    const row = el('div', 'star-row');
    stage.stars.map(starName).forEach((name, i) => {
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
  // A first clear's new card (ได้การ์ดใหม่) and any egg points it or a chapter-star total paid.
  for (const g of gotten) {
    if (g.card) {
      const u = battleUnits.get(g.card)!, got = el('div', 'new-card'), f = el('span', 'face');
      got.dataset.card = g.card;
      got.style.setProperty('--sect', colorOf(g.card));
      f.append(cardArt(g.card) ?? portrait(g.card));
      got.append(f, el('em', '', 'ได้การ์ดใหม่!'), nowrapWords(el('b'), u.nameTh), el('small', '', u.tagTh));
      box.append(got);
    }
    if (g.eggPoints > 0) box.append(el('p', 'egg-line', `${g.stage ? `ผ่าน ${g.stage} ครั้งแรก` : `ดาวครบ ${g.stars!.split(':')[1]} ดวง`}: แต้มไข่ +${g.eggPoints}`));
  }
  if (camp && ready.length > 0) box.append(el('p', 'dim', `เลื่อนขั้นได้ที่ค่ายฝึก: ${ready.join(' · ')}`));
  // A loss names its likeliest cause and one card that answers it.
  const tip = won === false ? lossTip(r.foeDmg, [...profile.owned.filter((c) => !team.bench.includes(c)), ...team.bench, ...battleCardIds]) : null; // an owned answer first, else any (the card log says where to get it)
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

// ---- ศึกกับเพื่อน: the room screen (pvp.ts) hands over the server's start; the frames drive the match from then on ----
// live: the match in play, its socket and the server's end once sent; a second start message (a reconnect) rebuilds it.
let live: { ls: Lockstep; c: RoomClient; end: MatchEnd | null } | null = null;
// A short line over whatever screen is up (a dropped peer, our own reconnect, a desync, a refused command).
function notice(text: string, bad = true) {
  const n = el('div', `net-notice${bad ? ' bad' : ''}`, text);
  app.append(n);
  setTimeout(() => n.remove(), 4000);
}
function pvpLive(m: Start, c: RoomClient) {
  live = { ls: new Lockstep(m), c, end: null };
  c.match = true;
  c.onMsg = (x) => {
    const L = live;
    if (!L) return;
    if (x.t === 'frame') L.ls.frame(x.tick, x.cmds);
    else if (x.t === 'end') { L.end = x.end; c.match = false; }
    else if (x.t === 'start') { pvpLive(x, c); go({ k: 'pvpMatch' }); notice('ต่อกลับเข้าศึกแล้ว', false); }
    else if (x.t === 'peer' && x.seat !== L.ls.seat) notice(x.online ? 'คู่แข่งกลับมาแล้ว' : `คู่แข่งหลุดการเชื่อมต่อ · ถ้าไม่กลับใน ${x.graceSec} วินาทีถือว่ายอมแพ้`, !x.online);
    else if (x.t === 'desync') notice('ข้อมูลศึกในเครื่องไม่ตรงกับเซิร์ฟเวอร์ · ผลของเซิร์ฟเวอร์คือผลจริง');
    else if (x.t === 'reject') notice(`คำสั่งไม่ผ่าน: ${REJECT_TH[x.code]}`);
  };
  c.onLink = (st) => {
    if (st === 'lost') notice('การเชื่อมต่อหลุด กำลังต่อใหม่…');
    else if (st === 'gone' && live && !live.end) {
      live = null;
      const box = el('div', 'modal result');
      box.append(el('h2', 'lost', 'หลุดการเชื่อมต่อ'), el('p', 'why', 'ต่อเซิร์ฟเวอร์กลับไม่ได้ภายในเวลา ศึกนี้นับเป็นยอมแพ้'), btn('กลับล็อบบี้', 'primary', () => { dropClient(); go({ k: 'lobby' }); }));
      app.append(box);
    }
  };
}
const pvpTeam = (t: { leader: string; sub: string }): Team => ({ leader: t.leader, sub: t.sub, bench: [] });
function pvpVersus(): () => void {
  const L = live!, me = L.ls.seat, st = L.ls.start;
  if (st.inMs <= 0) { queueMicrotask(() => go({ k: 'pvpMatch' })); return () => {}; }
  const r = el('div', 'screen versus pvp-vs');
  const side = (s: Side) => {
    const t = st.teams[s], box = el('div', `vs-side side${s}`), face = el('div', 'vs-face');
    face.append(portrait(t.leader, s, s === 1));
    box.style.setProperty('--sect', colorOf(t.leader));
    box.append(face, nowrapWords(el('b'), battleUnits.get(t.leader)!.nameTh), el('small', '', `แม่ทัพ${s === me ? 'เรา' : 'ของเพื่อน'} · รอง ${battleUnits.get(t.sub)!.nameTh}`), nowrapWords(el('span', 'vs-team'), st.names[s]));
    return box;
  };
  const mid = el('div', 'vs-mid');
  mid.append(el('span', 'vs-word', 'ปะทะ'), el('span', 'vs-mode', 'ศึกกับเพื่อน · ค่าเท่ากัน'));
  const row = el('div', 'vs-row');
  row.append(side(0), mid, side(1));
  r.append(el('div', 'grow'), row, el('p', 'vs-tip', `เราอยู่ฝั่ง${me === 0 ? 'ซ้าย' : 'ขวา'} · ศึกออนไลน์หยุดไม่ได้ Esc เปิดเมนู`), el('p', 'dim center small', 'ศึกเริ่มพร้อมกันทั้งสองฝ่าย'), el('div', 'grow'));
  app.append(r);
  const timer = setTimeout(() => go({ k: 'pvpMatch' }), st.inMs);
  return () => clearTimeout(timer);
}
function pvpMatch(): () => void {
  const L = live!, me = L.ls.seat, st = L.ls.start, foe: Side = me === 0 ? 1 : 0;
  return startMatch(app, {
    seed: st.seed, team: pvpTeam(st.teams[me]), mine: pvpSetup(st.teams[me]), vs: pvpSetup(st.teams[foe]), redraws: 0, speed: 1, settings: profile.settings, saveSettings: () => save(profile),
    bots: [null, 'paced'], normalized: true, progress: [null, null], modeTh: 'ศึกกับเพื่อน',
    net: { ls: L.ls, send: (m) => L.c.send(m), names: st.names, end: () => L.end },
    onQuit: () => L.c.send({ t: 'leave' }),
  }, (r) => pvpResult(r));
}
// The server's result stands: the winner and type come from its end message, seen from our side.
function pvpResult(r: MatchResult) {
  const L = live, end = L?.end ?? null, me = L?.ls.seat ?? 0;
  const w = end ? (end.winner === -1 ? -1 : end.winner === me ? 0 : 1) : r.winner;
  const res: MatchResult = end ? { ...r, winner: w, type: end.type, step: end.step } : r;
  const box = el('div', 'modal result pvp-result');
  const head = w === 0 ? ['won', 'ชนะ!'] : w === 1 ? ['lost', 'พ่ายแพ้'] : ['draw', 'เสมอ'];
  const v = res.type === 'forfeit' ? { head: w === 0 ? 'ชนะเพราะคู่แข่งออกจากศึก' : 'แพ้เพราะออกจากศึก', why: w === 0 ? 'คู่แข่งยอมแพ้ หรือหลุดการเชื่อมต่อเกินเวลา' : 'เรายอมแพ้ หรือหลุดการเชื่อมต่อเกินเวลา' } : verdict(res);
  const names = L?.ls.start.names ?? ['', ''];
  box.append(el('h2', head[0]!, head[1]!), el('p', `type ${head[0]}`, v.head), el('p', 'why', v.why), el('p', 'dim', `${names[me]} (เรา) ปะทะ ${names[me === 0 ? 1 : 0]}`));
  if (end?.flagged) box.append(el('p', 'why', 'ศึกนี้ข้อมูลไม่ตรงกับเซิร์ฟเวอร์ จึงถูกบันทึกไว้ตรวจ'));
  else if (end && end.type !== 'forfeit') box.append(el('p', 'dim', end.hash === r.hash ? 'ผลในเครื่องตรงกับเซิร์ฟเวอร์ทุกอย่าง' : 'ผลในเครื่องไม่ตรงกับเซิร์ฟเวอร์ · ยึดผลของเซิร์ฟเวอร์'));
  box.append(el('p', 'dim small', 'ศึกกับเพื่อนไม่มีรางวัลและไม่เปลี่ยนอันดับ'));
  const row = el('div', 'row result-actions');
  const again = btn('ศึกกับเพื่อนอีกครั้ง', 'primary', () => { live = null; go({ k: 'pvp' }); });
  again.dataset.primary = '1';
  row.append(again, btn('กลับล็อบบี้', '', () => { live = null; dropClient(); go({ k: 'lobby' }); }));
  box.append(row);
  app.append(box);
}

void loadSprites().then(() => go(dev.battle ? { k: 'match', team: dev.team?.team ?? profile.team, seed: dev.seed, redraws: 0, stage: dev.stage } : { k: 'title' }));
