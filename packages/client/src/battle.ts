// The castle-battle screen: runs the sim at a fixed 20 Hz, draws it on the Canvas 2D field and puts the HUD in plain DOM.
// The player is side 0 (left); the AI plays side 1 through the same bot the balance tests use. Every input becomes a
// BattleCommand handed to stepBattle, exactly like a replay. It owns its root until dispose(); main.ts decides what follows.
import {
  battle, BATTLE_LEN, battleHash, battleOver, battleUnits, createBattle, decision, levelOf, realmOf, sects, starsOf, stepBattle, summonZone, TICK_HZ,
  type BattleCommand, type BattleOpts, type BattleRecord, type BattleSetup, type Progress, type StageRules, type BattleEvent, type BattleState, type ResultType, type Side, type TiebreakStep,
} from '@five-sects/sim';
import { botCommands, botRng, type Policy } from '../../sim/test/battleBot';
import { Board, cannonIcon, portrait } from './board';
import { teamName, teamSetup, type Team } from './decks';
import type { Settings } from './profile';
import { cardArt } from './sprites';
import { applyVolume, play } from './sound';
import { nowrapWords } from './words';

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
// A card's level and realm (progression.json realms) as a small badge in the realm's colour; the tooltip says what it is.
export function realmBadge(level: number): HTMLElement {
  const r = realmOf(level), b = el('i', `realm realm-${r.id}`, `Lv${level} ${r.nameTh}`);
  b.style.setProperty('--realm', r.color);
  b.title = `ขั้น${r.nameTh}: ${r.descTh}`;
  return b;
}

export interface MatchOpts {
  seed: number; team: Team; vs: Team; redraws: number; speed: number; settings: Settings; saveSettings: () => void;
  bots: [Policy | null, Policy]; // who plays each side: null = the player
  progress: [Progress | null, Progress | null]; normalized: boolean; // each side's account; normalized: ranked ศึกฝีมือ
  modeTh: string; // the mode named on our castle bar
  stage?: { rules: StageRules; enemy: BattleSetup; nameTh: string; gimmickTh: string }; // a ศึกปราบ stage: its rules and enemy
  replay?: BattleRecord; // plays this record back instead: no input, no bots
  onQuit: () => void; // the pause menu's way out: leave the match with no result
}
// record: the match as played, for the ranked replay; hash: its final state; stars: the ศึกปราบ goals reached;
// foeDmg: the damage each enemy card dealt our side, for the loss tip.
export interface MatchResult {
  winner: Side | -1; type: ResultType; step: TiebreakStep | null; castles: [number, number]; tick: number; hand: string[];
  record: BattleRecord; hash: string; stars: [boolean, boolean, boolean]; foeDmg: Record<string, number>;
}

const TOP_H = 64, BOTTOM_H = 150; // HUD bands over the canvas, in stage pixels
const OFF_PATH = 0.9; // tiles from the road centre a click still counts as on it
const sec = (t: number) => Math.ceil(t / TICK_HZ);
const clock = (t: number) => { const s = Math.max(0, sec(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const capOf = (card: string) => battleUnits.get(card)!.perMatch;

export function startMatch(app: HTMLElement, o: MatchOpts, onEnd: (r: MatchResult) => void): () => void {
  let speed = o.speed;
  const setup = (t: Team, p: Progress | null) => (p ? { ...teamSetup(t), progress: p } : teamSetup(t));
  const setups: [BattleSetup, BattleSetup] = o.replay?.setups ?? [setup(o.team, o.progress[0]), o.stage?.enemy ?? setup(o.vs, o.progress[1])];
  const opts: BattleOpts = o.replay?.opts ?? (o.stage ? { normalized: o.normalized, stage: o.stage.rules } : { normalized: o.normalized });
  const seed = o.replay?.seed ?? o.seed;
  const s: BattleState = createBattle(seed, setups[0], setups[1], opts);
  // the team screen's redraws, as the replay has them
  const firstTick: BattleCommand[] = o.replay ? o.replay.commands[0] ?? [] : Array.from({ length: o.redraws }, () => ({ t: 'redraw', side: 0 }));
  const log: Record<number, BattleCommand[]> = firstTick.length > 0 ? { 0: firstTick } : {};
  const rngs = [botRng(seed, 0), botRng(seed, 1)];
  const human = o.bots[0] == null && !o.replay;

  const root = el('div', 'match');
  const canvas = el('canvas', 'field');
  const top = el('div', 'hud-top');
  const bottom = el('div', 'hud-bottom');
  const toastBox = el('div', 'toasts');
  root.append(canvas, top, toastBox, bottom);
  app.append(root);
  const board = new Board(canvas, s, { top: TOP_H, bottom: BOTTOM_H });
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
  const bars = [castleBar(0, `ปราสาทเรา · ${teamName(o.team)} · ${o.modeTh}`), castleBar(1, `ปราสาทศัตรู · ${o.stage?.nameTh ?? teamName(o.vs)}`)];
  const clockBox = el('div', 'clock'), time = el('b', 'time'), fortRow = el('div', 'forts'), regenHint = el('small');
  const fortDots = s.forts.map(() => fortRow.appendChild(el('i')));
  clockBox.append(time, fortRow, regenHint);
  if (o.stage) clockBox.append(el('em', 'gimmick', o.stage.gimmickTh));
  if (o.replay) clockBox.append(el('em', 'gimmick', 'รีเพลย์'));
  const ctl = el('div', 'ctl');
  const pauseBtn = el('button', 'icon', 'หยุด');
  const speedBtn = el('button', 'icon', `x${speed}`);
  const muteBtn = el('button', 'icon');
  const shakeBtn = el('button', 'icon');
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
  stepBattle(s, firstTick); // tick 0 before the hand is shown, so the cards are the redrawn ones
  const cards = s.hands[0].map((card, slot) => {
    const def = battleUnits.get(card)!;
    const b = el('button', `card${def.move === 'guard' ? ' guard' : ''}`);
    b.style.setProperty('--sect', sects.get(def.sect)?.color ?? '#E3B04B');
    const face = el('span', 'face');
    face.append(cardArt(card) ?? portrait(card));
    const uses = el('span', 'uses'), m = battle.moves.get(def.move)!;
    const rank = card === o.team.leader ? 'แม่ทัพ' : card === o.team.sub ? 'รอง' : null;
    b.append(face, el('kbd', '', String(slot + 1)), el('span', 'cost', String(def.mana)), uses);
    if (rank) b.append(el('em', 'rank', rank));
    if (!o.normalized) b.append(realmBadge(levelOf(o.progress[0], card)));
    b.append(nowrapWords(el('b', 'name'), def.nameTh), nowrapWords(el('small', 'role'), `${m.roleTh} · ${m.nameTh} · ${battle.sizes.get(def.size)?.nameTh ?? def.size}`));
    b.title = def.tagTh;
    b.addEventListener('pointerdown', (ev) => { if (human) { ev.preventDefault(); pick(slot); drag = { x: ev.clientX, y: ev.clientY, moved: false }; } });
    b.addEventListener('pointerenter', () => { hover = slot; });
    b.addEventListener('pointerleave', () => { if (hover === slot) hover = null; });
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

  function toast(msg: string, cls = '') {
    const t = el('div', `toast ${cls}`, msg);
    toastBox.append(t);
    while (toastBox.children.length > 3) toastBox.firstChild!.remove();
    setTimeout(() => t.remove(), 1800);
  }

  // Why the player's slot cannot be summoned right now (any spot), or null.
  function cardProblem(slot: number): string | null {
    const card = s.hands[0][slot]!, cap = capOf(card);
    if (cap != null && s.uses[0][slot]! >= cap) return 'ใบนี้ใช้ครบแล้ว';
    if (s.mana[0] < battleUnits.get(card)!.mana) return 'ปราณไม่พอ';
    return null;
  }
  function cannonProblem(): string | null {
    if (s.castles[0].cannonCd > 0) return 'ปืนใหญ่กำลังบรรจุ';
    if (s.mana[0] < battle.cannon.mana) return 'ปราณไม่พอ';
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
    const d = Math.max(0, Math.min(BATTLE_LEN, hit.d));
    const off = hit.off > OFF_PATH ? (sel === 'cannon' ? 'ยิงได้บนเส้นทางเท่านั้น' : 'ลงได้บนเส้นทางเท่านั้น') : null;
    const why = sel === 'cannon'
      ? cannonProblem() ?? off ?? (d > battle.cannon.reach ? 'เกินระยะปืนใหญ่' : null)
      : cardProblem(sel) ?? off ?? (d > summonZone(s, 0) ? 'ลงได้เฉพาะในเขตอัญเชิญ' : null);
    board.aim = { d, ok: why == null, card: sel === 'cannon' ? null : s.hands[0][sel]! };
    return { d, ok: why == null, why };
  }
  function summonAt(p: { x: number; y: number }) {
    if (sel == null || battleOver(s)) return;
    const a = aimAt(p);
    if (!a) return;
    if (!a.ok) { toast(a.why!, 'bad'); return; }
    pending.push(sel === 'cannon' ? { t: 'cannon', side: 0, d: a.d } : { t: 'summon', side: 0, card: s.hands[0][sel]!, d: a.d });
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
  const pauseBox = el('div', 'modal pause'), pauseMute = el('button', 'pause-mute');
  const showPauseMute = () => { pauseMute.textContent = set.muted ? 'เปิดเสียง' : 'ปิดเสียง'; };
  pauseMute.onclick = () => { set.muted = !set.muted; changed(); showPauseMute(); };
  const resume = el('button', 'primary', 'เล่นต่อ'), quit = el('button', '', 'กลับล็อบบี้');
  quit.onclick = () => o.onQuit();
  const pauseRow = el('div', 'pause-menu');
  pauseRow.append(resume, pauseMute, quit);
  pauseBox.append(el('h2', '', 'หยุดเกม'), pauseRow, el('p', 'dim', 'Esc เล่นต่อ'));
  let paused = false;
  const setPaused = (on: boolean) => {
    paused = on;
    pauseBtn.textContent = on ? 'เล่น' : 'หยุด';
    if (on) { showPauseMute(); root.append(pauseBox); resume.focus(); } else pauseBox.remove();
  };
  resume.onclick = () => setPaused(false);
  pauseBtn.onclick = () => setPaused(!paused);
  speedBtn.onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; speedBtn.textContent = `x${speed}`; };
  // Keyboard: 1-7 pick a card, Space picks the cannon, Esc drops the pick (or pauses with none picked), P pauses.
  const onKey = (ev: KeyboardEvent) => {
    if (ev.repeat || battleOver(s)) return;
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
    put('mana', `${s.mana[0]}`, (v) => { manaNum.textContent = `${v}/${battle.manaMax}`; });
    cards.forEach(({ b, uses, card }, slot) => {
      const cap = capOf(card), left = cap == null ? '∞' : String(cap - s.uses[0][slot]!);
      put(`uses${slot}`, left, (v) => { uses.textContent = v; });
      const problem = human ? cardProblem(slot) : null;
      put(`card${slot}`, `${problem ?? ''}|${sel === slot}`, () => {
        b.classList.toggle('sel', sel === slot);
        b.classList.toggle('poor', problem === 'ปราณไม่พอ');
        b.classList.toggle('spent', problem === 'ใบนี้ใช้ครบแล้ว');
      });
    });
    const cd = s.castles[0].cannonCd, problem = human ? cannonProblem() : null;
    put('cannon', `${sec(cd)}|${problem ?? ''}|${sel === 'cannon'}`, () => {
      cannonState.textContent = cd > 0 ? `บรรจุ ${sec(cd)} วิ` : 'พร้อมยิง';
      cannonBtn.classList.toggle('sel', sel === 'cannon');
      cannonBtn.classList.toggle('poor', problem != null);
      cannonBtn.disabled = !human;
    });
    reload.style.height = `${(100 * cd) / battle.cannon.cooldown}%`;
    const shown = hover ?? (typeof sel === 'number' ? sel : null);
    board.counter = shown == null ? null : s.hands[0][shown]!;
  }
  // The mana bar fills toward the next point between ticks (the sim only adds whole points).
  function manaProgress(): number {
    if (s.mana[0] >= battle.manaMax) return 1;
    const r = battle.regen[regenPhase()];
    return r ? ((s.tick - r.from) % r.every) / r.every : 0;
  }

  let lastPhase = 0;
  const foeCard = new Map<number, string>(), foeDmg: Record<string, number> = {}; // enemy unit id -> card; card -> damage dealt us
  function onEvents(ev: BattleEvent[]) {
    for (const e of ev) {
      if (e.e === 'spawn' && e.side === 1) foeCard.set(e.id!, e.type!);
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
      else if (e.e === 'capture') { play('capture'); toast(e.side === 0 ? 'ยึดป้อมได้! เขตอัญเชิญขยาย' : 'ศัตรูยึดป้อม', e.side === 0 ? '' : 'bad'); }
      else if (e.e === 'neutral') toast('ป้อมแตก กลับเป็นป้อมกลาง');
    }
    const ph = regenPhase();
    if (ph > lastPhase) toast('ปราณไหลเร็วขึ้น!');
    lastPhase = Math.max(lastPhase, ph);
  }

  // ---- loop ----
  let acc = 0, last = performance.now(), frames = 0, fpsAt = last, ended = false;
  // Hooks for scripts/shots.mjs: the state, fps, unit-on-unit hits so far, and where a path distance is on screen.
  Object.assign(window, { __game: game, __pathClient: (d: number) => { const r = canvas.getBoundingClientRect(), p = board.toClient(d); return { x: r.left + p.x, y: r.top + p.y }; } });
  function frame(now: number) {
    const dt = Math.min(250, now - last); last = now;
    if (!paused && !battleOver(s)) {
      acc += dt * speed;
      while (acc >= 1000 / TICK_HZ && !battleOver(s)) {
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
    if (battleOver(s) && !ended) {
      ended = true;
      const d = decision(s);
      const r: MatchResult = { winner: d.winner, type: d.type, step: d.step, castles: [s.castles[0].hp, s.castles[1].hp], tick: s.tick, hand: [...s.hands[0]],
        record: { seed, setups, opts, commands: log }, hash: battleHash(s), stars: starsOf(s), foeDmg };
      setTimeout(() => onEnd(r), 1200); // the last blow lands before the result covers the field
    }
    manaFill.style.width = `${(100 * Math.min(battle.manaMax, s.mana[0] + manaProgress())) / battle.manaMax}%`;
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
    removeEventListener('resize', onResize); removeEventListener('keydown', onKey);
    removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp);
    board.dispose(); root.remove();
  };
}
