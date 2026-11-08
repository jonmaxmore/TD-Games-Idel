// The castle-battle screen: runs the sim at a fixed 20 Hz, draws it on the Canvas 2D field and puts the HUD in plain DOM.
// The player is side 0 (left); the AI plays side 1 through the same bot the balance tests use. Every input becomes a
// BattleCommand handed to stepBattle, exactly like a replay. It owns its root until dispose(); main.ts decides what follows.
import type { ClientMsg, Lockstep, MatchEnd } from '@five-sects/protocol';
import {
  battle, BATTLE_LEN, battleHash, battleOver, battleUnits, classesOf, createBattle, decision, fwd, gimmickNames, levelOf, realmOf, sects, starsOf, stepBattle, summonZone, TICK_HZ,
  type BattleCommand, type BattleOpts, type BattleRecord, type BattleSetup, type Progress, type Stage, type BattleEvent, type BattleState, type ResultType, type Side, type TiebreakStep,
} from '@five-sects/sim';
import { botCommands, botRng, type Policy } from '../../sim/test/battleBot';
import ui from '../../../docs/data/ui.json';
import { Board, cannonIcon, portrait } from './board';
import { teamName, type Team } from './decks';
import type { Settings } from './profile';
import { quitRule, type QuitKind } from './quit';
import { cardArt } from './sprites';
import { cardInfo } from './cardInfo';
import { applyVolume, play } from './sound';
import { button, confirmBox, focusTip, setDisabled } from './ui';
import { nowrapWords } from './words';

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
// A card's level and realm (progression.json realms) as a small badge in the realm's colour; the tooltip says what it is.
// short: the level alone (the hand, where the badge must stay off the face).
export function realmBadge(level: number, short = false): HTMLElement {
  const r = realmOf(level), b = el('i', `realm realm-${r.id}`, short ? `Lv${level}` : `Lv${level} ${r.nameTh}`);
  b.style.setProperty('--realm', r.color);
  b.title = `ขั้น${r.nameTh}: ${r.descTh}`;
  return b;
}

export interface MatchOpts {
  // mine, vs: both sides' cards and leaders (each side's progress is added); team: ours, for the leader marks and the name.
  seed: number; team: Team; mine: BattleSetup; vs: BattleSetup; speed: number; settings: Settings; saveSettings: () => void;
  bots: [Policy | null, Policy]; // who plays each side: null = the player
  progress: [Progress | null, Progress | null]; normalized: boolean; // each side's account; normalized: ranked ศึกฝีมือ
  modeTh: string; // the mode named on our castle bar
  stage?: Stage; // a ศึกปราบ stage: its rules, enemy and star goals
  replay?: BattleRecord & { endTick?: number }; // plays this record back instead: no input, no bots; endTick: it ended on a surrender
  quit: QuitKind; // what the pause menu's way out does (quit.ts)
  onQuit: () => void; // leave the match with no result (online: tell the server we forfeit; its end message brings the result)
  net?: NetPlay; // a friend-room match: the server's frames drive the sim, our inputs go to it, nothing pauses
}
// A friend-room match: the lockstep (our seat, the sim), the way to the server, both names, and the server's end once it
// has sent one (a forfeit ends the match before the sim does).
export interface NetPlay { ls: Lockstep; send: (m: ClientMsg) => void; names: [string, string]; end: () => MatchEnd | null }
// record: the match as played, for the ranked replay; hash: its final state; stars: the ศึกปราบ goals reached;
// foeDmg: the damage each enemy card dealt our side, for the loss tip; surrendered: we gave up (ศึกฝีมือ ยอมแพ้), a loss.
export interface MatchResult {
  winner: Side | -1; type: ResultType | 'forfeit'; step: TiebreakStep | null; castles: [number, number]; tick: number; hand: string[];
  record: BattleRecord & { endTick?: number }; hash: string; stars: [boolean, boolean, boolean]; foeDmg: Record<string, number>; surrendered: boolean;
}

const TOP_H = 64, BOTTOM_H = 150; // HUD bands over the canvas, in stage pixels
const OFF_PATH = 0.9; // tiles from the road centre a click still counts as on it
const sec = (t: number) => Math.ceil(t / TICK_HZ);
const clock = (t: number) => { const s = Math.max(0, sec(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const capOf = (card: string) => battleUnits.get(card)!.perMatch;
const CLASS_TH: Record<string, string> = { ...(ui.lossTip.classTh as Record<string, string>), structure: 'ป้อมและปราสาท' };
const TIP_MS = 250; // a hand card's tooltip shows after the pointer rests this long

// A card's tooltip (the hand in a match, the team screen, ค่ายฝึก, บันทึกการ์ด, ร้านไข่): its numbers on the team it would play
// in (cardInfo: what the sim summons), what it beats (▲, orange on the field) and what beats it (▼), its ability at that
// level, the full description, the uses line, then any lines the caller adds.
export function cardTip(card: string, setup: BattleSetup, p: Progress | null, uses: string, extra: HTMLElement[] = []): HTMLElement[] {
  const u = battleUnits.get(card)!, info = cardInfo(card, setup, p);
  const beats = u.counters.map((c) => CLASS_TH[c] ?? c), weak = classesOf(u).map((c) => battle.counterTags.get(c)).filter(Boolean);
  const line = (cls: string, mark: string, text: string) => { const q = el('p', cls); q.append(el('b', '', mark), document.createTextNode(` ${text}`)); return q; };
  return [
    nowrapWords(el('b', 'tip-name'), u.nameTh),
    el('p', 'tip-stats', info.stats),
    el('p', 'tip-reach', info.reach),
    ...(beats.length > 0 ? [line('tip-strong', '▲', `ชนะทาง: ${beats.join(' · ')}`)] : []),
    ...(weak.length > 0 ? [line('tip-weak', '▼', `แพ้ทาง: ตัวที่${weak.join(' · ')}`)] : []),
    ...(info.ability ? [nowrapWords(el('p', 'tip-ab'), info.ability)] : []),
    nowrapWords(el('p', 'tip-tag'), info.desc),
    ...(uses ? [el('p', 'tip-uses', uses)] : []),
    ...extra,
  ];
}

export function startMatch(app: HTMLElement, o: MatchOpts, onEnd: (r: MatchResult) => void): () => void {
  let speed = o.speed;
  const setup = (t: BattleSetup, p: Progress | null): BattleSetup => (p ? { ...t, progress: p } : t);
  const setups: [BattleSetup, BattleSetup] = o.replay?.setups ?? [setup(o.mine, o.progress[0]), o.stage?.enemy ?? setup(o.vs, o.progress[1])];
  const opts: BattleOpts = o.replay?.opts ?? (o.stage ? { normalized: o.normalized, stage: o.stage.rules } : { normalized: o.normalized });
  const seed = o.replay?.seed ?? o.seed;
  const net = o.net;
  const s: BattleState = net ? net.ls.s : createBattle(seed, setups[0], setups[1], opts);
  // our side (left unless we are a friend room's guest) and theirs; d values in commands are our own depth
  const me: Side = net?.ls.seat ?? 0, foe: Side = me === 0 ? 1 : 0;
  // a replay's tick-0 commands
  const firstTick: BattleCommand[] = net ? [] : o.replay ? o.replay.commands[0] ?? [] : [];
  const log: Record<number, BattleCommand[]> = firstTick.length > 0 ? { 0: firstTick } : {};
  const rngs = [botRng(seed, 0), botRng(seed, 1)];
  const human = net != null || (o.bots[0] == null && !o.replay);

  const root = el('div', 'match');
  const canvas = el('canvas', 'field');
  const top = el('div', 'hud-top');
  const bottom = el('div', 'hud-bottom');
  const toastBox = el('div', 'toasts'), cursorToast = el('div', 'toast bad cursor-toast'), tip = el('div', 'card-tip'), legend = el('div', 'counter-legend');
  legend.append(el('span', 'tip-strong', '▲ ศัตรูที่ใบนี้ชนะทาง'), el('span', 'tip-weak', '▼ ศัตรูที่ใบนี้แพ้ทาง'));
  root.append(canvas, top, toastBox, bottom, cursorToast, tip, legend);
  app.append(root);
  const board = new Board(canvas, s, { top: TOP_H, bottom: BOTTOM_H });
  board.me = me;
  const set = o.settings;
  board.shake = set.shake;
  const onResize = () => board.resize();
  addEventListener('resize', onResize);

  // ---- top: our castle, the clock and forts, theirs, then the small controls ----
  const castleBar = (side: Side, name: string) => {
    const box = el('div', `castle-hp side${side}`), fill = el('i'), num = el('b');
    const bar = el('div', 'bar');
    bar.append(fill);
    box.append(nowrapWords(el('span', 'who'), name), bar, num);
    return { box, fill, num, last: -1 };
  };
  const ours = `ปราสาทเรา · ${net ? `${net.names[me]} · ` : ''}${teamName(o.team)} · ${o.modeTh}`, theirs = `ปราสาทศัตรู · ${net ? `${net.names[foe]} · ` : ''}${o.stage?.nameTh ?? teamName(o.vs)}`;
  const bars = [castleBar(0, me === 0 ? ours : theirs), castleBar(1, me === 0 ? theirs : ours)];
  const clockBox = el('div', 'clock'), time = el('b', 'time'), fortRow = el('div', 'forts'), regenHint = el('small');
  const fortDots = s.forts.map(() => fortRow.appendChild(el('i')));
  clockBox.append(time, fortRow, regenHint);
  if (o.stage && o.stage.gimmicks.length > 0) clockBox.append(el('em', 'gimmick', gimmickNames(o.stage)));
  if (o.replay) clockBox.append(el('em', 'gimmick', 'ภาพย้อนหลัง'));
  const ctl = el('div', 'ctl');
  const pauseBtn = button('หยุด', () => {}, 'icon', 'sm');
  const speedBtn = button(`x${speed}`, () => {}, 'icon', 'sm');
  if (net) { speed = 1; speedBtn.hidden = true; pauseBtn.textContent = 'เมนู'; }
  const muteBtn = button('', () => {}, 'icon', 'sm');
  const shakeBtn = button('', () => {}, 'icon', 'sm');
  const showSettings = () => { muteBtn.textContent = set.muted ? 'เสียงปิด' : 'เสียง'; shakeBtn.textContent = set.shake ? 'จอสั่น' : 'จอนิ่ง'; };
  const changed = () => { board.shake = set.shake; applyVolume(); showSettings(); o.saveSettings(); };
  muteBtn.onclick = () => { set.muted = !set.muted; changed(); };
  shakeBtn.onclick = () => { set.shake = !set.shake; changed(); };
  showSettings();
  ctl.append(muteBtn, shakeBtn, speedBtn, pauseBtn);
  top.append(bars[0]!.box, clockBox, bars[1]!.box, ctl);

  // ---- bottom: mana, the hand, the cannon ----
  const manaBox = el('div', 'mana'), manaNum = el('b'), manaFill = el('i'), manaBar = el('div', 'bar');
  manaBar.append(manaFill);
  manaBox.append(el('span', '', 'ปราณ'), manaNum, manaBar);
  const cardRow = el('div', 'cards');
  if (!net) stepBattle(s, firstTick); // tick 0 before the hand is shown
  const cards = s.hands[me].map((card, slot) => {
    const def = battleUnits.get(card)!;
    const b = el('button', `card${def.move === 'guard' ? ' guard' : ''}`);
    b.style.setProperty('--sect', sects.get(def.sect)?.color ?? '#E3B04B');
    const face = el('span', 'face');
    face.append(cardArt(card) ?? portrait(card));
    const uses = el('span', 'uses'), m = battle.moves.get(def.move)!;
    const rank = card === o.team.leader ? 'แม่ทัพ' : card === o.team.sub ? 'รอง' : null;
    b.append(face, el('kbd', '', String(slot + 1)), el('span', 'cost', String(def.mana)), uses);
    if (rank) b.append(el('em', 'rank', rank));
    if (s.progress[me]) b.append(realmBadge(levelOf(s.progress[me], card), true));
    b.append(nowrapWords(el('b', 'name'), def.nameTh), el('small', 'role', m.roleTh));
    b.addEventListener('pointerdown', (ev) => { hideTip(); if (human) { ev.preventDefault(); pick(slot); drag = { x: ev.clientX, y: ev.clientY, moved: false }; } });
    b.addEventListener('pointerenter', () => { hover = slot; showTip(slot); });
    b.addEventListener('pointerleave', () => { if (hover === slot) hover = null; hideTip(); });
    focusTip(b, tip, () => showTip(slot), hideTip);
    cardRow.append(b);
    return { b, uses, card };
  });
  const cannonBtn = el('button', 'cannon'), cannonState = el('small'), reload = el('i', 'reload');
  cannonBtn.append(reload, cannonIcon(3), el('span', 'cost', String(battle.cannon.mana)), nowrapWords(el('b'), battle.cannon.nameTh), cannonState, el('kbd', '', 'Space'));
  cannonBtn.addEventListener('pointerdown', (ev) => { if (human) { ev.preventDefault(); pick('cannon'); } });
  bottom.append(manaBox, cardRow, cannonBtn);

  const game = { s, fps: 0, fights: 0 };
  let pending: BattleCommand[] = [];
  let sel: number | 'cannon' | null = null; // the hand slot picked, or the cannon
  let hover: number | null = null; // the hand slot under the pointer
  let drag: { x: number; y: number; moved: boolean } | null = null;
  let lastPointer: { x: number; y: number } | null = null;

  // Stage pixels from a client point: the stage is #app scaled by main.ts fit().
  const toStage = (x: number, y: number) => { const r = root.getBoundingClientRect(), k = r.width / root.offsetWidth; return { x: (x - r.left) / k, y: (y - r.top) / k }; };
  let tipTimer = 0;
  function showTip(slot: number) {
    hideTip();
    tipTimer = window.setTimeout(() => {
      const c = cards[slot]!, cap = capOf(c.card);
      if (!c.b.isConnected) return;
      tip.replaceChildren(...cardTip(c.card, s.setups[me], s.progress[me], cap == null ? 'ลงได้ไม่จำกัด' : `ลงได้อีก ${cap - s.uses[me][slot]!} ครั้ง`));
      const r = c.b.getBoundingClientRect(), p = toStage(r.left + r.width / 2, r.top);
      tip.style.left = `${Math.max(150, Math.min(root.offsetWidth - 150, p.x))}px`;
      tip.style.top = `${p.y - 10}px`;
      tip.classList.add('on');
    }, TIP_MS);
  }
  function hideTip() { clearTimeout(tipTimer); tip.classList.remove('on'); }
  // A refused summon says why right at the pointer, apart from the match events at the top.
  let cursorTimer = 0;
  function cursorSay(msg: string, at: { x: number; y: number }) {
    const p = toStage(at.x, at.y);
    cursorToast.textContent = msg;
    cursorToast.style.left = `${p.x}px`;
    cursorToast.style.top = `${p.y - 34}px`;
    cursorToast.classList.remove('on');
    void cursorToast.offsetWidth; // restart the pop
    cursorToast.classList.add('on');
    clearTimeout(cursorTimer);
    cursorTimer = window.setTimeout(() => cursorToast.classList.remove('on'), 1400);
  }

  function toast(msg: string, cls = '') {
    const t = el('div', `toast ${cls}`, msg);
    toastBox.append(t);
    while (toastBox.children.length > 3) toastBox.firstChild!.remove();
    setTimeout(() => t.remove(), 1800);
  }

  // Why the player's slot cannot be summoned right now (any spot), or null.
  function cardProblem(slot: number): string | null {
    const card = s.hands[me][slot]!, cap = capOf(card);
    if (cap != null && s.uses[me][slot]! >= cap) return 'ใบนี้ใช้ครบแล้ว';
    if (s.mana[me] < battleUnits.get(card)!.mana) return 'ปราณไม่พอ';
    return null;
  }
  function cannonProblem(): string | null {
    if (s.castles[me].cannonCd > 0) return 'ปืนใหญ่กำลังบรรจุ';
    if (s.mana[me] < battle.cannon.mana) return 'ปราณไม่พอ';
    return null;
  }
  function pick(slot: number | 'cannon' | null) {
    sel = slot === sel ? null : slot;
    board.reach = sel === 'cannon' ? battle.cannon.reach : null;
    aimAt(lastPointer);
    refresh();
  }
  // The aim marker follows the pointer onto the road; it is gold where the summon would be accepted, red elsewhere.
  function aimAt(p: { x: number; y: number } | null): { d: number; ok: boolean; why: string | null } | null {
    board.armed = sel != null;
    const hit = p && sel != null ? board.pathAt(p.x, p.y) : null;
    if (!hit || sel == null) { board.aim = null; return null; }
    const d = Math.max(0, Math.min(BATTLE_LEN, hit.d)), own = fwd(me, d);
    const off = hit.off > OFF_PATH ? (sel === 'cannon' ? 'ยิงได้บนเส้นทางเท่านั้น' : 'ลงได้บนเส้นทางเท่านั้น') : null;
    const why = sel === 'cannon'
      ? cannonProblem() ?? off ?? (own > battle.cannon.reach ? 'เกินระยะปืนใหญ่' : null)
      : cardProblem(sel) ?? off ?? (own > summonZone(s, me) ? 'ลงได้เฉพาะในเขตอัญเชิญ' : null);
    board.aim = { d, ok: why == null, card: sel === 'cannon' ? null : s.hands[me][sel]! };
    return { d, ok: why == null, why };
  }
  function summonAt(p: { x: number; y: number }) {
    if (sel == null || battleOver(s) || ended) return;
    const a = aimAt(p);
    if (!a) return;
    if (!a.ok) { cursorSay(a.why!, p); return; }
    const own = fwd(me, a.d);
    pending.push(sel === 'cannon' ? { t: 'cannon', side: me, d: own } : { t: 'summon', side: me, card: s.hands[me][sel]!, d: own });
    sel = null;
    board.reach = null;
    aimAt(p);
    refresh();
  }

  const onMove = (ev: PointerEvent) => {
    lastPointer = { x: ev.clientX, y: ev.clientY };
    if (drag && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 8) drag.moved = true;
    const over = document.elementFromPoint(ev.clientX, ev.clientY) === canvas;
    aimAt(over ? lastPointer : null);
  };
  const onUp = (ev: PointerEvent) => {
    if (drag?.moved && document.elementFromPoint(ev.clientX, ev.clientY) === canvas) summonAt({ x: ev.clientX, y: ev.clientY });
    drag = null;
  };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerdown', (ev) => { if (human && !drag) summonAt({ x: ev.clientX, y: ev.clientY }); });
  canvas.addEventListener('pointerleave', () => { board.aim = null; });

  // The pause menu (Esc, P or หยุด): the sim does not step while it is open.
  const pauseBox = el('div', 'modal pause'), pauseMute = button('', () => {}, 'secondary', 'lg', 'pause-mute');
  const showPauseMute = () => { pauseMute.textContent = set.muted ? 'เปิดเสียง' : 'ปิดเสียง'; };
  pauseMute.onclick = () => { set.muted = !set.muted; changed(); showPauseMute(); };
  const resume = button(net ? 'กลับสู่ศึก' : 'เล่นต่อ', () => {}, 'primary', 'lg'), quit = button('', () => {}, 'ghost', 'lg', 'pause-quit'), quitWhy = el('p', 'pause-why');
  quit.onclick = () => {
    const rule = quitRule(o.quit, s.tick);
    if (rule.why) return;
    const leave = () => { if (rule.surrender) finish(true); else o.onQuit(); };
    if (rule.confirm) confirmBox(root, rule.confirm, leave); else leave();
  };
  const showQuit = () => {
    const rule = quitRule(o.quit, s.tick);
    quit.textContent = rule.label;
    setDisabled(quit, rule.why);
    quitWhy.textContent = rule.why ?? '';
  };
  const pauseRow = el('div', 'pause-menu');
  pauseRow.append(resume, pauseMute, quit, quitWhy);
  pauseBox.append(el('h2', '', net ? 'เมนู · ศึกยังเดินต่อ' : 'หยุดเกม'), pauseRow, el('p', 'dim', net ? 'ศึกออนไลน์หยุดไม่ได้ · Esc กลับสู่ศึก' : 'Esc เล่นต่อ'));
  let paused = false;
  const setPaused = (on: boolean) => {
    paused = on;
    pauseBtn.textContent = net ? 'เมนู' : on ? 'เล่น' : 'หยุด';
    if (on) { showPauseMute(); showQuit(); root.append(pauseBox); resume.focus(); } else pauseBox.remove();
  };
  resume.onclick = () => setPaused(false);
  pauseBtn.onclick = () => setPaused(!paused);
  speedBtn.onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; speedBtn.textContent = `x${speed}`; };
  // Keyboard: 1-7 pick a card, Space picks the cannon, Esc drops the pick (or pauses with none picked), P pauses.
  const onKey = (ev: KeyboardEvent) => {
    if (ev.repeat || battleOver(s) || ended) return;
    const n = Number(ev.key);
    if (ev.key === 'Escape') { if (sel != null && !paused) pick(null); else setPaused(!paused); }
    else if (ev.key === 'p') setPaused(!paused);
    else if (paused) return;
    else if (human && n >= 1 && n <= cards.length) pick(n - 1);
    else if (ev.code === 'Space') { ev.preventDefault(); if (human) pick('cannon'); }
  };
  addEventListener('keydown', onKey);

  // ---- HUD refresh: only what changed is written ----
  const view: Record<string, string> = {};
  const put = (k: string, v: string, f: (v: string) => void) => { if (view[k] !== v) { view[k] = v; f(v); } };
  const regenPhase = () => battle.regen.findIndex((r) => s.tick >= r.from && s.tick < r.to);
  function refresh() {
    const left = battle.matchTicks - s.tick;
    put('time', clock(left), (v) => { time.textContent = v; });
    put('late', String(left <= 30 * TICK_HZ), (v) => time.classList.toggle('late', v === 'true'));
    const r = battle.regen[regenPhase()];
    put('regen', r ? `ปราณ +1 ทุก ${r.every / TICK_HZ} วิ` : '', (v) => { regenHint.textContent = v; });
    s.forts.forEach((f, i) => put(`fort${i}`, String(f.owner), (v) => { fortDots[i]!.className = v === 'null' ? '' : `side${v}`; }));
    ([0, 1] as Side[]).forEach((side) => {
      const b = bars[side]!, hp = Math.max(0, s.castles[side].hp);
      if (hp === b.last) return;
      if (b.last >= 0 && hp < b.last) b.box.animate([{ filter: 'brightness(2)' }, { filter: 'none' }], { duration: 200 });
      b.last = hp;
      b.fill.style.width = `${(100 * hp) / s.castles[side].maxHp}%`;
      b.num.textContent = String(hp);
    });
    put('mana', `${s.mana[me]}`, (v) => { manaNum.textContent = `${v}/${battle.manaMax}`; });
    cards.forEach(({ b, uses, card }, slot) => {
      const cap = capOf(card), left = cap == null ? '∞' : String(cap - s.uses[me][slot]!);
      put(`uses${slot}`, left, (v) => { uses.textContent = v; });
      const problem = human ? cardProblem(slot) : null;
      put(`card${slot}`, `${problem ?? ''}|${sel === slot}`, () => {
        b.classList.toggle('sel', sel === slot);
        b.classList.toggle('poor', problem === 'ปราณไม่พอ');
        b.classList.toggle('spent', problem === 'ใบนี้ใช้ครบแล้ว');
      });
    });
    const cd = s.castles[me].cannonCd, problem = human ? cannonProblem() : null;
    put('cannon', `${sec(cd)}|${problem ?? ''}|${sel === 'cannon'}`, () => {
      cannonState.textContent = cd > 0 ? `บรรจุ ${sec(cd)} วิ` : 'พร้อมยิง';
      cannonBtn.classList.toggle('sel', sel === 'cannon');
      cannonBtn.classList.toggle('poor', problem != null);
      cannonBtn.disabled = !human;
    });
    reload.style.height = `${(100 * cd) / battle.cannon.cooldown}%`;
    const shown = hover ?? (typeof sel === 'number' ? sel : null);
    board.counter = shown == null ? null : s.hands[me][shown]!;
    put('legend', String(shown != null), (v) => legend.classList.toggle('on', v === 'true'));
  }
  // The mana bar fills toward the next point between ticks (the sim only adds whole points).
  function manaProgress(): number {
    if (s.mana[me] >= battle.manaMax) return 1;
    const r = battle.regen[regenPhase()];
    return r ? ((s.tick - r.from) % r.every) / r.every : 0;
  }

  let lastPhase = 0;
  const foeCard = new Map<number, string>(), foeDmg: Record<string, number> = {}; // enemy unit id -> card; card -> damage dealt us
  function onEvents(ev: BattleEvent[]) {
    for (const e of ev) {
      if (e.e === 'spawn' && e.side === foe) foeCard.set(e.id!, e.type!);
      if (e.e === 'hit') {
        const foe = foeCard.get(e.from ?? 0);
        if (foe) foeDmg[foe] = (foeDmg[foe] ?? 0) + (e.dmg ?? 0);
        play(e.from != null && e.from < 0 ? 'shoot' : 'hit', 0.08);
        if (e.type === 'castle') play('castle', 0.1);
        if ((e.from ?? 0) >= 1 && (e.to ?? 0) >= 1) game.fights++;
      }
      else if (e.e === 'spawn') play('summon');
      else if (e.e === 'kill') play('death');
      else if (e.e === 'cannon') play('cannon');
      else if (e.e === 'capture') { play('capture'); toast(e.side === me ? 'ยึดป้อมได้! เขตอัญเชิญขยาย' : 'ศัตรูยึดป้อม', e.side === me ? '' : 'bad'); }
      else if (e.e === 'neutral') toast('ป้อมแตก กลับเป็นป้อมกลาง');
      else if (e.e === 'warn') { play('castle', 0.5); toast(`ระวัง! ${battleUnits.get(e.type!)!.nameTh} จะบุกมาใน ${Math.ceil(e.amount! / TICK_HZ)} วินาที`, 'bad warn'); }
      else if (e.e === 'bonus') toast(`ยึดป้อมครั้งแรก ได้ปราณ +${e.amount}`);
    }
    const ph = regenPhase();
    if (ph > lastPhase) toast('ปราณไหลเร็วขึ้น!');
    lastPhase = Math.max(lastPhase, ph);
  }

  // ---- loop ----
  let acc = 0, last = performance.now(), frames = 0, fpsAt = last, ended = false;
  // A replay of a surrendered match stops on the tick the surrender came.
  const over = () => battleOver(s) || (o.replay?.endTick != null && s.tick >= o.replay.endTick);
  // The match is over: the sim decided it, the server sent its end (a friend-room forfeit ends it before the sim does), or we
  // surrendered (a loss on the spot, the field as it stands). The result is seen from our side: winner 0 = us.
  function finish(surrendered: boolean) {
    ended = true;
    paused = false;
    pauseBox.remove();
    const d = surrendered ? { winner: foe, type: 'castle' as ResultType, step: null } : net?.end() ?? decision(s);
    const w = d.winner === -1 ? -1 : d.winner === me ? 0 : 1;
    const record: MatchResult['record'] = net ? { seed: net.ls.start.seed, setups: [s.setups[0], s.setups[1]], opts: { normalized: true }, commands: net.ls.log }
      : { seed, setups, opts, commands: log, ...(surrendered ? { endTick: s.tick } : {}) };
    const r: MatchResult = { winner: w, type: d.type, step: d.step, castles: [s.castles[me].hp, s.castles[foe].hp], tick: s.tick, hand: [...s.hands[me]],
      record, hash: battleHash(s), stars: o.stage ? starsOf(s, o.stage) : [false, false, false], foeDmg, surrendered };
    setTimeout(() => onEnd(r), surrendered ? 0 : 1200); // the last blow lands before the result covers the field
  }
  // Hooks for scripts/shots.mjs: the state, fps, unit-on-unit hits so far, and where a path distance is on screen.
  Object.assign(window, { __game: game, __pathClient: (d: number) => { const r = canvas.getBoundingClientRect(), p = board.toClient(d); return { x: r.left + p.x, y: r.top + p.y }; } });
  function frame(now: number) {
    const dt = Math.min(250, now - last); last = now;
    if (net) {
      for (const c of pending) net.send(net.ls.cmd(c as Extract<BattleCommand, { t: 'summon' | 'cannon' }>));
      pending = [];
      // every frame the server has sent, a burst at most per animation frame so a catch-up stays smooth
      for (const h of net.ls.run((ev) => { board.sync(s, now); board.events(ev, now, 1); onEvents(ev); }, 20)) net.send(h);
      refresh();
      if (board.aim) aimAt(lastPointer);
    } else if (!paused && !over() && !ended) {
      acc += dt * speed;
      while (acc >= 1000 / TICK_HZ && !over()) {
        acc -= 1000 / TICK_HZ;
        const cmds = o.replay ? o.replay.commands[s.tick] ?? [] : [...(human ? pending : botCommands(s, 0, o.bots[0]!, rngs[0]!)), ...botCommands(s, 1, o.bots[1], rngs[1]!)];
        pending = [];
        if (cmds.length > 0) log[s.tick] = cmds;
        const ev = stepBattle(s, cmds);
        board.sync(s, now);
        board.events(ev, now, speed);
        onEvents(ev);
      }
      refresh();
      if (board.aim) aimAt(lastPointer);
    }
    if ((over() || net?.end()) && !ended) finish(o.replay?.endTick != null && !battleOver(s));
    manaFill.style.width = `${(100 * Math.min(battle.manaMax, s.mana[me] + manaProgress())) / battle.manaMax}%`;
    board.sync(s, now);
    board.render([summonZone(s, 0), summonZone(s, 1)]);
    frames++;
    if (now - fpsAt >= 1000) { game.fps = frames; frames = 0; fpsAt = now; }
    raf = requestAnimationFrame(frame);
  }
  refresh();
  let raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(tipTimer); clearTimeout(cursorTimer);
    removeEventListener('resize', onResize); removeEventListener('keydown', onKey);
    removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp);
    board.dispose(); root.remove();
  };
}
