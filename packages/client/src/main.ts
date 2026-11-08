// The player's path through the app (ui-flow.md §3): title (a click starts the sound) → lobby → team setup → versus →
// castle battle → result (rewards, one next step) → back. ศึกปราบ: lobby → stage map or the next stage's briefing → team
// setup or straight in → versus → stage match → result with stars. ศึกฝีมือ: the result moves the rank and keeps the match
// for a replay.
// Dev and shots shortcut: ?mode=battle jumps straight into a match, without the versus screen (&stage=1-4 a ศึกปราบ stage); &bot=1 lets bots play both sides, &speed=4 fast-forwards,
// &seed=N picks the match, &deck=fire|wood|metal|water|earth (a sect preset), all|mixed (every card) or a comma list of
// card ids to draw from (&leader=, &sub= the leaders).
import {
  battle, battleCardIds, battleUnits, chapter, loanerRoom, gimmickNames, homeSects, rewardCard, sectCards, sects, stageOf, stages, starName, starterCards, starterTeam, TICK_HZ,
  type Side, type Stage,
} from '@five-sects/sim';
import { Lockstep, pvpSetup, type MatchEnd } from '@five-sects/protocol';
import { el, startMatch, type MatchResult } from './battle';
import { aiProgress, canLevel, chooseHome, claim, nextTeam, payMatch, settleRanked, startRanked, progressOf, recordRanked, recordStage, stageOpen, type Claimed } from './camp';
import { campScreen } from './campScreen';
import { portrait } from './board';
import { aiSetup, casualRules, DECK_NAME_MAX, deckName, deckProblem, isBasic, RANKED_RULES, resolveTeam, setupOf, teamName, type DeckRules, type Team } from './decks';
import { colorOf, deckPicker, kindOf } from './deckPicker';
import { lobbyScreen, rankBadge, starCount, toggleFullscreen } from './lobby';
import { load, save, setTeam, teamOf, type Mode, type Profile, type RankedSave } from './profile';
import { initSound, play, unlockAudio } from './sound';
import { cardArt, loadSprites } from './sprites';
import { lossTip, versusTip } from './tips';
import { unlockState } from './unlocks';
import { button, endScreen, screenSignal, setDisabled, typing } from './ui';
import { nowrapWords } from './words';
import { inMatch, markMatch, REJECT_TH, type RoomClient } from './net';
import { dropClient, pvpScreen, type Start } from './pvp';

const app = document.getElementById('app')!;
// The stage is a fixed 1280x720 (16:9), centred with black bars on any other window shape. From 1x up it scales in half
// steps (1, 1.5, 2...): a board pixel is 2 stage pixels, so it always lands on whole screen pixels (1080p is exactly 1.5).
// A window under 1280x720 shrinks it to fit as it is.
function stageScale(w: number, h: number): number {
  const k = Math.min(w / 1280, h / 720);
  return k >= 1 ? Math.floor(k * 2) / 2 : k;
}
const fit = () => {
  const k = stageScale(innerWidth, innerHeight);
  app.style.setProperty('--k', String(k));
  app.style.left = `${Math.floor((innerWidth - 1280 * k) / 2)}px`;
  app.style.top = `${Math.floor((innerHeight - 720 * k) / 2)}px`;
};
addEventListener('resize', fit);
fit();
// F toggles browser full screen (PC).
addEventListener('keydown', (e) => { if (e.key === 'f' && !typing(e)) toggleFullscreen(); });
const q = new URLSearchParams(location.search);
const dev = { battle: q.get('mode') === 'battle', bot: q.get('bot') === '1', speed: Number(q.get('speed') ?? 1), seed: Number(q.get('seed') ?? 1), team: resolveTeam(q), stage: stageOf(q.get('stage') ?? '')?.id };
const profile: Profile = load();
claim(profile); // an older save's won stages pay their first clears once a home sect is set
if (settleRanked(profile)) save(profile); // a ranked match left by reload or a closed tab counts as lost
initSound(profile.settings);

type Fight = { team: Team; seed: number; stage?: string };
type Screen =
  | { k: 'title' } | { k: 'pick' } | { k: 'lobby' } | { k: 'deck'; stage?: string } | { k: 'camp' } | { k: 'campaign' } | { k: 'brief'; stage: string } | { k: 'replay' }
  | ({ k: 'versus' } & Fight) | ({ k: 'match' } & Fight) | { k: 'pvp' } | { k: 'pvpVs' } | { k: 'pvpMatch' };
let dispose: (() => void) | void;
let current: Screen = { k: 'title' };
// Esc goes back on every full screen that has a way back (ui-flow.md; the settings page promises it). An open overlay
// takes Esc for itself first.
const BACK: Partial<Record<Screen['k'], (s: Screen) => Screen>> = {
  deck: (s) => (s.k === 'deck' && s.stage ? { k: 'brief', stage: s.stage } : { k: 'lobby' }),
  camp: () => ({ k: 'lobby' }), campaign: () => ({ k: 'lobby' }), brief: () => ({ k: 'campaign' }),
};
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.repeat || document.querySelector('.overlay')) return;
  const back = BACK[current.k];
  if (back) go(back(current));
});

// The second click of a double-click lands on the next screen's button in the same place (the lobby's primary, then the
// briefing's เข้าสู่ศึก): it is dropped, so a double-click never skips a screen.
let shownAt = 0;
app.addEventListener('click', (e) => { if (e.detail > 1 && performance.now() - shownAt < 600) { e.stopPropagation(); e.preventDefault(); } }, true);
// The browser's Back stays in the game: it acts as Esc (a screen's way back; in a match, the menu), never leaves the page.
const MATCHES: Screen['k'][] = ['match', 'pvpMatch', 'replay'];
history.pushState({ game: 1 }, '');
addEventListener('popstate', () => {
  history.pushState({ game: 1 }, '');
  if (MATCHES.includes(current.k) && document.querySelector('.modal.pause')) return; // the menu is already open
  dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
});

function go(next: Screen) {
  if (dispose) dispose();
  dispose = undefined;
  endScreen();
  shownAt = performance.now();
  current = next;
  app.replaceChildren();
  Object.assign(window, { __flow: { screen: next.k } });
  if (next.k === 'title') dispose = title();
  else if (next.k === 'pick') pickHome();
  else if (next.k === 'lobby') dispose = lobbyScreen(app, profile, () => save(profile), {
    stage: (id) => go({ k: 'brief', stage: id }), map: () => go({ k: 'campaign' }), camp: () => go({ k: 'camp' }),
    mode: (m) => { profile.mode = m; save(profile); go({ k: 'deck' }); },
    pvp: () => go({ k: 'pvp' }),
  });
  else if (next.k === 'pvp') dispose = pvpScreen(app, profile, { lobby: () => go({ k: 'lobby' }), start: (m, c) => { pvpLive(m, c); go({ k: m.tick > 0 ? 'pvpMatch' : 'pvpVs' }); } });
  else if (next.k === 'pvpVs') dispose = pvpVersus();
  else if (next.k === 'pvpMatch') dispose = pvpMatch();
  else if (next.k === 'deck') dispose = teamScreen(next.stage ? stageOf(next.stage) : undefined);
  else if (next.k === 'camp') dispose = campScreen(app, profile, () => save(profile), () => go({ k: 'lobby' }));
  else if (next.k === 'versus') dispose = versus(next);
  else if (next.k === 'campaign') campaignMap();
  else if (next.k === 'brief') briefing(stageOf(next.stage)!);
  else if (next.k === 'replay') dispose = replay();
  else dispose = match(next.team, next.seed, next.stage ? stageOf(next.stage) : undefined);
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
// cards everyone owns (collection.json), the striker leads. A click only selects; the pick is kept by the confirm button
// under the cards, which says it is for good. Then straight to stage 1-1. ----
function pickHome() {
  const r = el('div', 'screen pick');
  r.append(el('h1', '', 'เลือกสำนักแรก'), el('p', 'dim center', 'สำนักแรกคือบ้านเกิดของเรา ได้ศิษย์ 3 คนของสำนักนั้น พร้อมธงยึดป้อมทั้ง 5 สำนักและนักธนูพเนจร การ์ดสำนักอื่นได้ทีหลังจากด่านและร้านไข่'));
  const row = el('div', 'pick-row');
  let chosen: string | null = null;
  const ok = button('', () => { if (!chosen) return; chooseHome(profile, chosen); save(profile); go({ k: 'brief', stage: stages[0]!.id }); }, 'primary', 'lg', 'pick-ok');
  const select = (home: string) => {
    chosen = home;
    for (const c of Array.from(row.children) as HTMLElement[]) { c.classList.toggle('sel', c.dataset.home === home); c.setAttribute('aria-pressed', String(c.dataset.home === home)); }
    ok.textContent = `เริ่มที่${sects.get(home)!.nameTh}`;
    setDisabled(ok, null);
    ok.focus();
  };
  ok.textContent = 'เริ่มที่สำนักนี้';
  setDisabled(ok, 'เลือกสำนักก่อน');
  for (const home of homeSects) {
    const sc = sects.get(home)!, t = starterTeam(home), mine = starterCards(home).filter((c) => battleUnits.get(c)!.sect === home && !isBasic(c));
    const b = btn('', 'pick-card', () => select(home));
    b.dataset.home = home;
    b.setAttribute('aria-pressed', 'false');
    b.style.setProperty('--sect', sc.color);
    const faces = el('div', 'pick-faces');
    for (const c of mine) { const f = el('span', 'face'); f.append(cardArt(c) ?? portrait(c)); faces.append(f); }
    b.append(el('b', 'pick-name', sc.nameTh), faces, ...mine.map((c) => el('small', '', `${battleUnits.get(c)!.nameTh}${c === t.leader ? ' · แม่ทัพ' : c === t.sub ? ' · รอง' : ''}`)),
      el('p', 'pick-tag', battleUnits.get(t.leader)!.tagTh));
    row.append(b);
  }
  const bar = el('div', 'pick-confirm');
  bar.append(el('p', 'pick-warn', 'เลือกได้ครั้งเดียว เปลี่ยนภายหลังไม่ได้ · การ์ดสำนักอื่นยังได้จากด่านและร้านไข่'), ok);
  r.append(row, el('p', 'dim center small', 'ศึกฝีมือ (จัดอันดับ) ใช้การ์ดทุกใบที่ค่าเท่ากัน สำนักแรกจึงไม่ทำให้ได้เปรียบหรือเสียเปรียบ'), bar);
  app.append(r);
}

// The two ways into a match besides ศึกปราบ: ศึกทั่วไป (levels, forge and town count) and ศึกฝีมือ (every card at base stats).
const MODES: [Mode, string][] = [['casual', 'ศึกทั่วไป'], ['ranked', 'ศึกฝีมือ (เลเวลเท่ากัน)']];
const modeName = (m: Mode) => MODES.find((x) => x[0] === m)![1];

// ---- จัดทัพ: three named saved decks (kept as they are edited) over the deck picker, under the mode's rules: the owned
// cards and their levels (a stage's own budget in ศึกปราบ), or every card at base stats in ศึกฝีมือ. เข้าสู่ศึก stays off
// with the reason until the team is legal. ----
const teamRules = (stage?: Stage): DeckRules => (!stage && profile.mode === 'ranked' ? RANKED_RULES : casualRules(profile.owned, stage?.deckBudget));
function teamScreen(stage?: Stage): () => void {
  const r = el('div', 'screen team'), rules = teamRules(stage);
  const head = el('div', 'team-head'), tabs = el('div', 'deck-tabs'), nameIn = el('input', 'deck-name');
  nameIn.maxLength = DECK_NAME_MAX;
  nameIn.setAttribute('aria-label', 'ชื่อทัพ');
  nameIn.addEventListener('input', () => { profile.decks[profile.deck]!.name = nameIn.value.trim().slice(0, DECK_NAME_MAX) || deckName(profile.deck); save(profile); showTabs(); });
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'ทัพที่บันทึกไว้');
  const nameRow = el('label', 'deck-name-row');
  nameRow.append(el('span', 'dim small', 'ชื่อทัพ'), nameIn, el('small', 'dim saved-note', 'บันทึกอัตโนมัติ'));
  head.append(el('h1', '', `จัดทัพ · ${stage ? `ศึกปราบ ${stage.id} ${stage.nameTh}` : modeName(profile.mode)}`), tabs, nameRow);
  const lent = loanerRoom(rules.owned);
  const note = rules.ranked
    ? `ศึกฝีมือ: เลือกจากการ์ดทุกใบในเกม งบแต้มทัพ ${rules.budget} เท่ากันทุกคน และทุกใบใช้ค่าพื้นฐานเท่ากัน เลเวลไม่มีผล`
    : `${stage ? `ด่านนี้งบแต้มทัพ ${rules.budget}${rules.budget !== battle.deck.budget ? ` (ปกติ ${battle.deck.budget})` : ''}` : `ศึกทั่วไป: งบแต้มทัพ ${rules.budget}`} · ใช้การ์ดที่มี เลเวลการ์ดมีผล${lent > 0 ? ` · การ์ดยังน้อย ยืมศิษย์กระบี่ได้ ${lent} ใบ (ป้าย "ยืม")` : ''}`;
  const picker = deckPicker({
    rules, team: teamOf(profile), progress: () => (rules.ranked ? null : progressOf(profile, Date.now())),
    onChange: (t) => { setTeam(profile, t); save(profile); refresh(); },
  });
  const seed = (Date.now() % 100000) + 1;
  const enter = button('เข้าสู่ศึก', () => go({ k: 'versus', team: teamOf(profile), seed, stage: stage?.id }), 'primary', 'lg', 'enter-btn');
  const why = el('p', 'enter-why');
  function showTabs() {
    tabs.replaceChildren(...profile.decks.map((d, i) => {
      const ok = deckProblem(d.team, rules) == null, on = i === profile.deck;
      const b = button('', () => { profile.deck = i; save(profile); picker.set(teamOf(profile)); refresh(); }, on ? 'secondary' : 'ghost', 'sm', `deck-tab${on ? ' on' : ''}`);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(on));
      b.append(nowrapWords(el('span'), d.name), el('i', ok ? 'tab-ok' : 'tab-bad', ok ? '✓' : '!'));
      b.title = ok ? 'ทัพนี้พร้อมเข้าศึก' : `ยังเข้าศึกไม่ได้: ${deckProblem(d.team, rules)}`;
      return b;
    }));
  }
  function refresh() {
    const problem = picker.problem();
    setDisabled(enter, problem);
    why.textContent = problem ? `ยังเข้าศึกไม่ได้: ${problem}` : '';
    if (document.activeElement !== nameIn) nameIn.value = profile.decks[profile.deck]!.name;
    showTabs();
  }
  const row = el('div', 'row actions');
  row.append(button('กลับ (Esc)', () => go(stage ? { k: 'brief', stage: stage.id } : { k: 'lobby' }), 'ghost', 'md', 'back'), why, enter);
  r.append(head, el('p', 'team-note', note), picker.root, row);
  app.append(r);
  refresh();
  return () => picker.dispose();
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
  // "You are here": the first open stage not yet won pulses with a ถัดไป flag, and the map's primary plays it.
  const ahead = stages.find((st, i) => stageOpen(profile, ids, i) && !profile.campaign[st.id]?.stars[0]);
  stages.forEach((st, i) => {
    const open = stageOpen(profile, ids, i), got = profile.campaign[st.id]?.stars ?? [false, false, false];
    const b = btn('', `stage-node${open ? '' : ' locked'}${got[0] ? ' won' : ''}${st === ahead ? ' next' : ''}`, () => { if (open) go({ k: 'brief', stage: st.id }); });
    if (st === ahead) b.append(el('em', 'next-flag', 'ถัดไป'));
    b.dataset.stage = st.id;
    b.disabled = !open;
    b.style.left = `${MAP_AT[i]![0]}%`;
    b.style.top = `${MAP_AT[i]![1]}%`;
    b.append(el('span', 'id', st.id), nowrapWords(el('b'), st.nameTh), el('span', 'stars', open ? stars(got) : 'ยังไม่เปิด'));
    if (open && st.gimmicks.length > 0) b.append(el('small', '', gimmickNames(st)));
    map.append(b);
  });
  const row = el('div', 'row actions');
  row.append(button('กลับล็อบบี้', () => go({ k: 'lobby' }), 'ghost', 'md', 'back'));
  if (ahead) row.append(button(`เล่นด่าน ${ahead.id}`, () => go({ k: 'brief', stage: ahead.id }), 'primary', 'lg', 'play-next'));
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
  for (const c of [st.enemy.leader, st.enemy.sub, ...st.enemy.picks].filter((x) => x !== '')) {
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
  const enter = button('เข้าสู่ศึก', () => go({ k: 'versus', team: teamOf(profile), seed: (Date.now() % 100000) + 1, stage: st.id }), 'primary', 'lg', 'enter-btn');
  const problem = deckProblem(teamOf(profile), teamRules(st));
  setDisabled(enter, problem ? `ทัพยังเข้าศึกไม่ได้: ${problem} · กด จัดทัพ` : null);
  const row = el('div', 'row actions');
  row.append(button('แผนที่', () => go({ k: 'campaign' }), 'ghost', 'md', 'back'), button('จัดทัพ', () => go({ k: 'deck', stage: st.id })),
    enter);
  r.append(body, row);
  app.append(r);
}

// ---- versus → match → result ----
// About 1.5 s before every match: our leader against theirs, both team names, the mode or stage, and one tip. A click or any
// key (but F, full screen) skips it.
function versus(f: Fight): () => void {
  const stage = f.stage ? stageOf(f.stage) : undefined, foe = stage ? stage.enemy : aiSetup(f.team, f.seed);
  const foeLeader = foe.leader || foe.picks.find((c) => !isBasic(c)) || foe.picks[0]!;
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
  r.append(el('div', 'grow'), row, el('p', 'vs-tip', `เคล็ดลับ: ${versusTip(f.seed)}`), el('p', 'dim center small', 'คลิกหรือกดปุ่มใดก็ได้เพื่อข้าม'), el('div', 'grow'));
  app.append(r);
  const start = () => go({ ...f, k: 'match' });
  const timer = setTimeout(start, 1500);
  const onKey = (e: KeyboardEvent) => { if (e.key !== 'f' && !e.repeat) start(); };
  r.addEventListener('click', start); // a click, so the second click of a double-click that opened this screen is dropped
  addEventListener('keydown', onKey);
  return () => { clearTimeout(timer); removeEventListener('keydown', onKey); };
}

// Our side: ranked draws from every card (normalized), else the owned cards (a dev ?deck= the cards it names). The casual AI
// plays at the card level whose power score is closest to ours (camp.ts aiProgress).
function match(team: Team, seed: number, stage?: Stage) {
  const ranked = !stage && profile.mode === 'ranked', vs = aiSetup(team, seed), mine = setupOf(team);
  if (ranked) { startRanked(profile); save(profile); }
  return startMatch(app, {
    seed, team, mine, vs, speed: dev.speed, settings: profile.settings, saveSettings: () => save(profile),
    bots: stage || ranked ? [dev.bot ? 'paced' : null, 'paced'] : [dev.bot ? 'rush' : null, 'rush'],
    normalized: ranked, progress: ranked ? [null, null] : [progressOf(profile, Date.now()), stage ? null : aiProgress(profile, vs, Date.now())],
    modeTh: stage ? `ศึกปราบ ${stage.id}` : ranked ? 'ศึกฝีมือ' : 'ศึกทั่วไป',
    stage, quit: ranked ? 'ranked' : 'casual',
    onQuit: () => go({ k: 'lobby' }),
  }, (r) => result(team, seed, r, stage, ranked));
}

// The last match played back from its record (ui-flow.md §2.3: every result offers ภาพย้อนหลัง). Ranked keeps its record in
// the save; any other mode keeps the last one for this session. The end says whether it ended on the recorded hash.
interface Played { record: RankedSave; modeTh: string; normalized: boolean }
let lastPlay: Played | null = null;
const replayable = (): Played | null => lastPlay ?? (profile.lastRanked ? { record: profile.lastRanked, modeTh: 'ศึกฝีมือ', normalized: true } : null);
function replay() {
  const play = replayable()!, last = play.record, s0 = last.setups[0];
  const team: Team = { leader: s0.leader, sub: s0.sub, picks: [...s0.picks] };
  return startMatch(app, {
    seed: last.seed, team, mine: s0, vs: last.setups[1], speed: dev.speed, settings: profile.settings, saveSettings: () => save(profile),
    bots: [null, 'paced'], normalized: play.normalized, progress: [null, null], modeTh: play.modeTh, replay: last, quit: 'replay', onQuit: () => go({ k: 'lobby' }),
  }, (r) => {
    const same = r.hash === last.hash;
    const { box, panel, reveal } = resultPanel('จบภาพย้อนหลัง', 'draw', verdict(r).head, same ? 'ผลตรงกับศึกที่บันทึกไว้ทุกอย่าง' : 'ผลไม่ตรงกับที่บันทึกไว้');
    const row = el('div', 'row result-actions');
    row.append(button('กลับล็อบบี้', () => go({ k: 'lobby' }), 'ghost', 'md', 'back'), button('ดูอีกครั้ง', () => go({ k: 'replay' }), 'primary', 'lg'));
    panel.append(row);
    reveal();
    app.append(box);
  });
}

const STEP_TH: Record<string, string> = { forts: 'จำนวนป้อมที่ถือ', mana: 'ปราณที่เหลือ', units: 'ศิษย์ที่ยังรอด', kills: 'จำนวนที่ฆ่าได้' };
// The result type in Thai (battle.json > results) as the headline, and why in one line.
function verdict(r: MatchResult): { head: string; why: string } {
  if (r.surrendered) return { head: 'ยอมแพ้', why: 'เรายอมแพ้ ศึกนี้นับเป็นแพ้' };
  const we = r.winner === 0, name = battle.results.get(r.type)!;
  if (r.type === 'draw') return { head: name, why: r.castles[0] <= 0 ? 'ปราสาทแตกพร้อมกันทั้งสองฝ่าย' : 'หมดเวลา และเท่ากันทุกข้อ' };
  const head = we ? name : `ศัตรู${name}`;
  if (r.type === 'total') return { head, why: we ? 'ทลายปราสาทศัตรู และยึดป้อมได้ครบ' : 'ปราสาทเราแตก และศัตรูยึดป้อมได้ครบ' };
  if (r.type === 'castle') return { head, why: we ? 'ทลายปราสาทศัตรูได้' : 'ปราสาทเราแตก' };
  if (r.type === 'hp') return { head, why: `หมดเวลา: HP ปราสาท${we ? 'เรา' : 'ศัตรู'}เหลือมากกว่า` };
  return { head, why: `หมดเวลา HP ปราสาทเท่ากัน: ตัดสินที่${STEP_TH[r.step!]}` };
}

// The one result layout of every mode (ux-audit.md R-1..R-4): a panel over the dimmed field with one headline, the result
// type as a small chip, why in one dim line; then the mode's own rows; then the fixed button row. Rows appear one after
// another (--i staggers them, a star waits its own turn); a click or any key shows everything at once.
function resultPanel(headline: string, tone: string, type: string, why: string) {
  const box = el('div', 'modal result'), panel = el('div', 'result-panel panel');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', headline);
  const head = el('div', 'result-head');
  head.append(el('h2', tone, headline), el('span', `result-type ${tone}`, type));
  panel.append(head, el('p', 'why', why));
  box.append(panel);
  const skip = () => box.classList.add('shown');
  box.addEventListener('pointerdown', skip);
  // Any key shows everything; Esc leaves for the lobby (the ล็อบบี้ button), unless an overlay over the result has it.
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.repeat && !document.querySelector('.overlay')) box.querySelector<HTMLButtonElement>('.result-actions .back')?.click();
    else skip();
  }, { signal: screenSignal() });
  const reveal = () => {
    let i = 0;
    for (const row of Array.from(panel.children) as HTMLElement[]) {
      row.style.setProperty('--i', String(i++));
      for (const star of Array.from(row.querySelectorAll<HTMLElement>('.star'))) star.style.setProperty('--i', String(i++));
    }
  };
  return { box, panel, reveal };
}

function result(team: Team, seed: number, r: MatchResult, stage: Stage | undefined, ranked: boolean) {
  const tone = r.winner === 0 ? 'won' : r.winner === 1 ? 'lost' : 'draw';
  const t = Math.floor(r.tick / TICK_HZ), v = verdict(r);
  const { box, panel, reveal } = resultPanel(tone === 'won' ? 'ชนะ!' : tone === 'lost' ? 'พ่ายแพ้' : 'เสมอ', tone, v.head,
    `${v.why} · ปราสาทเรา ${Math.max(0, r.castles[0])} · ปราสาทศัตรู ${Math.max(0, r.castles[1])} · เวลา ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
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
    panel.append(row);
  }
  const record: RankedSave = { ...r.record, hash: r.hash };
  lastPlay = { record, modeTh: stage ? `ศึกปราบ ${stage.id}` : ranked ? 'ศึกฝีมือ' : 'ศึกทั่วไป', normalized: ranked };
  if (ranked) {
    const { before, after } = recordRanked(profile, won);
    profile.lastRanked = record;
    const line = el('p', 'rank-change');
    line.append(rankBadge(before), el('span', '', ' → '), rankBadge(after));
    panel.append(line);
  }
  save(profile);
  const ready = r.hand.filter((c, i) => r.hand.indexOf(c) === i && canLevel(profile, c)).map((c) => battleUnits.get(c)!.nameTh);
  const gains = el('div', 'rewards');
  gains.append(el('b', '', 'รางวัล'), el('span', '', `แต้มฝึก +${pay.xp} ให้ทุกใบในมือ`), el('span', 'coin', `เหรียญ +${pay.coins}`), el('span', 'gold', `ทองคำ +${pay.gold}`));
  const camp = unlockState(profile).open.has('levelUp');
  panel.append(gains);
  // A first clear's new card (ได้การ์ดใหม่) and any egg points it or a chapter-star total paid.
  for (const g of gotten) {
    if (g.card) {
      const u = battleUnits.get(g.card)!, got = el('div', 'new-card'), f = el('span', 'face');
      got.dataset.card = g.card;
      got.style.setProperty('--sect', colorOf(g.card));
      f.append(cardArt(g.card) ?? portrait(g.card));
      got.append(f, el('em', '', 'ได้การ์ดใหม่!'), nowrapWords(el('b'), u.nameTh), el('small', '', u.tagTh));
      panel.append(got);
    }
    if (g.eggPoints > 0) panel.append(el('p', 'egg-line', `${g.stage ? `ผ่าน ${g.stage} ครั้งแรก` : `ดาวครบ ${g.stars!.split(':')[1]} ดวง`}: แต้มไข่ +${g.eggPoints}`));
  }
  if (camp && ready.length > 0) {
    const line = el('div', 'result-note');
    line.append(el('span', '', `เลื่อนขั้นได้: ${ready.join(' · ')}`), button('ไปค่ายฝึก', () => go({ k: 'camp' }), 'secondary', 'sm', 'to-camp'));
    panel.append(line);
  }
  const toDeck = () => go({ k: 'deck', stage: stage?.id });
  // A loss names its likeliest cause and one card that answers it, with the way to act on it.
  const tip = won === false ? lossTip(r.foeDmg, [...profile.owned, ...battleCardIds]) : null; // an owned answer first, else any (the card log says where to get it)
  if (tip) {
    const line = el('div', 'loss-tip');
    line.append(nowrapWords(el('p'), `คำแนะนำ: ${tip}`), button('จัดทัพ', toDeck, 'secondary', 'sm', 'tip-deck'));
    panel.append(line);
  }
  // The same four places every time: lobby (ghost, left), จัดทัพ, ภาพย้อนหลัง, and exactly one primary on the right (the next
  // stage after a stage win, another match after a ranked or casual win or draw, else a retry). One that does not apply is
  // hidden in its place, so nothing moves.
  const next = stage ? stages[stages.indexOf(stage) + 1] : undefined;
  const again = () => { const t = nextTeam(profile, teamRules(stage)); go(t ? { k: 'versus', team: t, seed: seed + 1, stage: stage?.id } : { k: 'deck', stage: stage?.id }); };
  const last = stage && won && !next;
  const main = (text: string, f: () => void) => button(text, f, 'primary', 'lg');
  const primary = stage && won ? (next ? main('ด่านถัดไป', () => go({ k: 'brief', stage: next.id })) : main('กลับล็อบบี้', () => go({ k: 'lobby' })))
    : !stage && won !== false ? main('อีกแมตช์', again) : main('ลองใหม่', again);
  primary.dataset.primary = '1';
  const lobby = button('ล็อบบี้', () => go({ k: 'lobby' }), 'ghost', 'md', 'back');
  if (last) lobby.style.visibility = 'hidden';
  const row = el('div', 'row result-actions');
  row.append(lobby, button('จัดทัพ', toDeck, 'secondary', 'md', 'deck-btn'), button('ภาพย้อนหลัง', () => go({ k: 'replay' }), 'secondary', 'md', 'replay-btn'), primary);
  panel.append(row);
  reveal();
  app.append(box);
  if (won && stage) for (const s of Array.from(panel.querySelectorAll<HTMLElement>('.star.got'))) play('capture', 0.22 * Number(s.style.getPropertyValue('--i')));
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
  markMatch(true);
  c.onMsg = (x) => {
    const L = live;
    if (!L) return;
    if (x.t === 'frame') L.ls.frame(x.tick, x.cmds);
    else if (x.t === 'end') { L.end = x.end; c.match = false; markMatch(false); }
    else if (x.t === 'start') { pvpLive(x, c); go({ k: 'pvpMatch' }); notice('ต่อกลับเข้าศึกแล้ว', false); }
    else if (x.t === 'peer' && x.seat !== L.ls.seat) notice(x.online ? 'คู่แข่งกลับมาแล้ว' : `คู่แข่งหลุดการเชื่อมต่อ · ถ้าไม่กลับใน ${x.graceSec} วินาทีถือว่ายอมแพ้`, !x.online);
    else if (x.t === 'desync') notice('ข้อมูลศึกในเครื่องไม่ตรงกับเซิร์ฟเวอร์ · ผลของเซิร์ฟเวอร์คือผลจริง');
    else if (x.t === 'reject') notice(`คำสั่งไม่ผ่าน: ${REJECT_TH[x.code]}`);
  };
  c.onLink = (st) => {
    if (st === 'lost') notice('การเชื่อมต่อหลุด กำลังต่อใหม่…');
    else if (st === 'gone' && live && !live.end) {
      live = null;
      markMatch(false);
      const { box, panel, reveal } = resultPanel('หลุดการเชื่อมต่อ', 'lost', 'ยอมแพ้', 'ต่อเซิร์ฟเวอร์กลับไม่ได้ภายในเวลา ศึกนี้นับเป็นยอมแพ้');
      const row = el('div', 'row result-actions'), back = button('กลับล็อบบี้', () => { dropClient(); go({ k: 'lobby' }); }, 'primary', 'lg');
      back.dataset.primary = '1';
      row.append(back);
      panel.append(row);
      reveal();
      app.append(box);
    }
  };
}
const pvpTeam = (t: Team): Team => ({ leader: t.leader, sub: t.sub, picks: [...t.picks] });
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
    seed: st.seed, team: pvpTeam(st.teams[me]), mine: pvpSetup(st.teams[me]), vs: pvpSetup(st.teams[foe]), speed: 1, settings: profile.settings, saveSettings: () => save(profile),
    bots: [null, 'paced'], normalized: true, progress: [null, null], modeTh: 'ศึกกับเพื่อน',
    net: { ls: L.ls, send: (m) => L.c.send(m), names: st.names, end: () => L.end },
    quit: 'online', onQuit: () => L.c.send({ t: 'leave' }),
  }, (r) => pvpResult(r));
}
// The server's result stands: the winner and type come from its end message, seen from our side.
function pvpResult(r: MatchResult) {
  const L = live, end = L?.end ?? null, me = L?.ls.seat ?? 0;
  const w = end ? (end.winner === -1 ? -1 : end.winner === me ? 0 : 1) : r.winner;
  const res: MatchResult = end ? { ...r, winner: w, type: end.type, step: end.step } : r;
  const tone = w === 0 ? 'won' : w === 1 ? 'lost' : 'draw';
  const v = res.type === 'forfeit' ? { head: w === 0 ? 'คู่แข่งออกจากศึก' : 'ออกจากศึก', why: w === 0 ? 'คู่แข่งยอมแพ้ หรือหลุดการเชื่อมต่อเกินเวลา' : 'เรายอมแพ้ หรือหลุดการเชื่อมต่อเกินเวลา' } : verdict(res);
  const names = L?.ls.start.names ?? ['', ''];
  const { box, panel, reveal } = resultPanel(tone === 'won' ? 'ชนะ!' : tone === 'lost' ? 'พ่ายแพ้' : 'เสมอ', tone, v.head, v.why);
  box.classList.add('pvp-result');
  panel.append(el('p', 'dim', `${names[me]} (เรา) ปะทะ ${names[me === 0 ? 1 : 0]}`));
  if (end?.flagged) panel.append(el('p', 'why', 'ศึกนี้ข้อมูลไม่ตรงกับเซิร์ฟเวอร์ จึงถูกบันทึกไว้ตรวจ'));
  else if (end && end.type !== 'forfeit') panel.append(el('p', 'dim', end.hash === r.hash ? 'ผลในเครื่องตรงกับเซิร์ฟเวอร์ทุกอย่าง' : 'ผลในเครื่องไม่ตรงกับเซิร์ฟเวอร์ · ยึดผลของเซิร์ฟเวอร์'));
  panel.append(el('p', 'dim small', 'ศึกกับเพื่อนไม่มีรางวัลและไม่เปลี่ยนอันดับ'));
  const row = el('div', 'row result-actions');
  const again = button('ศึกกับเพื่อนอีกครั้ง', () => { live = null; go({ k: 'pvp' }); }, 'primary', 'lg');
  again.dataset.primary = '1';
  row.append(button('ล็อบบี้', () => { live = null; dropClient(); go({ k: 'lobby' }); }, 'ghost', 'md', 'back'), again);
  panel.append(row);
  reveal();
  app.append(box);
}

// A reload during a friend match goes back into it (the server holds the seat for its reconnect window), not to the title.
void loadSprites().then(() => go(dev.battle ? { k: 'match', team: dev.team?.team ?? teamOf(profile), seed: dev.seed, stage: dev.stage } : inMatch() ? { k: 'pvp' } : { k: 'title' }));
