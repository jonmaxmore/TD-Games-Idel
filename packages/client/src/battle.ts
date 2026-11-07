// The castle-battle screen: runs the sim at a fixed 20 Hz, draws it on the Canvas 2D field and puts the HUD in plain DOM.
// The player is side 0 (left); the AI plays side 1 through the same bot the balance tests use. Every input becomes a
// BattleCommand handed to stepBattle, exactly like a replay. It owns its root until dispose(); main.ts decides what follows.
import {
  battle, BATTLE_LEN, battleOver, battleUnits, createBattle, decision, sects, stepBattle, summonZone, TICK_HZ,
  type BattleCommand, type BattleEvent, type BattleState, type DecideStep, type Side,
} from '@five-sects/sim';
import { botCommands, botRng, type Policy } from '../../sim/test/battleBot';
import { bellIcon, Board, portrait } from './board';
import type { DeckChoice } from './decks';
import type { Settings } from './profile';
import { cardArt } from './sprites';
import { applyVolume, play } from './sound';
import { nowrapWords } from './words';

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };

export interface MatchOpts {
  seed: number; deck: DeckChoice; vs: DeckChoice; speed: number; settings: Settings; saveSettings: () => void;
  bots: [Policy | null, Policy]; // who plays each side: null = the player
}
export interface MatchResult { winner: Side | -1; step: DecideStep | null; broken: boolean; castles: [number, number]; tick: number }

const TOP_H = 64, BOTTOM_H = 150; // HUD bands over the canvas, in stage pixels
const OFF_PATH = 0.9; // tiles from the road centre a click still counts as on it
const sec = (t: number) => Math.ceil(t / TICK_HZ);
const clock = (t: number) => { const s = Math.max(0, sec(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const capOf = (card: string) => battle.sizes.get(battleUnits.get(card)!.size)!.perMatch;

export function startMatch(app: HTMLElement, o: MatchOpts, onEnd: (r: MatchResult) => void): () => void {
  let speed = o.speed;
  const s: BattleState = createBattle(o.seed, o.deck.cards, o.vs.cards);
  const rngs = [botRng(o.seed, 0), botRng(o.seed, 1)];
  const human = o.bots[0] == null;

  const root = el('div', 'match');
  const canvas = el('canvas', 'field');
  const top = el('div', 'hud-top');
  const bottom = el('div', 'hud-bottom');
  const cutin = el('div', 'cutin');
  const toastBox = el('div', 'toasts');
  root.append(canvas, top, cutin, toastBox, bottom);
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
  const bars = [castleBar(0, `ปราสาทเรา · ${o.deck.nameTh}`), castleBar(1, `ปราสาทศัตรู · ${o.vs.nameTh}`)];
  const clockBox = el('div', 'clock'), time = el('b', 'time'), fortRow = el('div', 'forts'), regenHint = el('small');
  const fortDots = s.forts.map(() => fortRow.appendChild(el('i')));
  clockBox.append(time, fortRow, regenHint);
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

  // ---- bottom: mana, the eight cards, the bell ----
  const manaBox = el('div', 'mana'), manaNum = el('b'), manaFill = el('i'), manaBar = el('div', 'bar');
  manaBar.append(manaFill);
  manaBox.append(el('span', '', 'ปราณ'), manaNum, manaBar);
  const cardRow = el('div', 'cards');
  const cards = s.decks[0].map((card, slot) => {
    const def = battleUnits.get(card)!;
    const b = el('button', 'card');
    b.style.setProperty('--sect', sects.get(def.sect)?.color ?? '#E3B04B');
    const face = el('span', 'face');
    face.append(cardArt(card) ?? portrait(card));
    const uses = el('span', 'uses');
    b.append(face, el('kbd', '', String(slot + 1)), el('span', 'cost', String(def.mana)), uses,
      nowrapWords(el('b', 'name'), def.nameTh), nowrapWords(el('small'), `${battle.moves.get(def.move)?.nameTh ?? def.move} · ${battle.sizes.get(def.size)?.nameTh ?? def.size}`));
    b.addEventListener('pointerdown', (ev) => { if (human) { ev.preventDefault(); pick(slot); drag = { x: ev.clientX, y: ev.clientY, moved: false }; } });
    cardRow.append(b);
    return { b, uses, card };
  });
  const bellBtn = el('button', 'bell');
  const bellState = el('small');
  bellBtn.append(bellIcon(3), nowrapWords(el('b'), battle.castle.artNameTh), bellState, el('kbd', '', 'Space'));
  bellBtn.onclick = () => { if (human && !s.castles[0].artUsed) pending.push({ t: 'art', side: 0 }); };
  bottom.append(manaBox, cardRow, bellBtn);

  const game = { s, fps: 0, fights: 0 };
  let pending: BattleCommand[] = [];
  let sel: number | null = null; // the deck slot picked
  let drag: { x: number; y: number; moved: boolean } | null = null;
  let paused = false;
  let lastPointer: { x: number; y: number } | null = null;

  function toast(msg: string, cls = '') {
    const t = el('div', `toast ${cls}`, msg);
    toastBox.append(t);
    while (toastBox.children.length > 3) toastBox.firstChild!.remove();
    setTimeout(() => t.remove(), 1800);
  }

  // Why the player's slot cannot be summoned right now (any spot), or null.
  function cardProblem(slot: number): string | null {
    const card = s.decks[0][slot]!, cap = capOf(card);
    if (cap != null && s.uses[0][slot]! >= cap) return 'ใบนี้ใช้ครบแล้ว';
    if (s.mana[0] < battleUnits.get(card)!.mana) return 'ปราณไม่พอ';
    return null;
  }
  function pick(slot: number | null) {
    sel = slot === sel ? null : slot;
    aimAt(lastPointer);
    refresh();
  }
  // The aim marker follows the pointer onto the road; it is gold where the summon would be accepted, red elsewhere.
  function aimAt(p: { x: number; y: number } | null): { d: number; ok: boolean; why: string | null } | null {
    board.armed = sel != null;
    const hit = p && sel != null ? board.pathAt(p.x, p.y) : null;
    if (!hit || sel == null) { board.aim = null; return null; }
    const d = Math.max(0, Math.min(BATTLE_LEN, hit.d));
    const why = cardProblem(sel) ?? (hit.off > OFF_PATH ? 'ลงได้บนเส้นทางเท่านั้น' : d > summonZone(s, 0) ? 'ลงได้เฉพาะในเขตอัญเชิญ' : null);
    board.aim = { d, ok: why == null, card: s.decks[0][sel]! };
    return { d, ok: why == null, why };
  }
  function summonAt(p: { x: number; y: number }) {
    if (sel == null || battleOver(s)) return;
    const a = aimAt(p);
    if (!a) return;
    if (!a.ok) { toast(a.why!, 'bad'); return; }
    pending.push({ t: 'summon', side: 0, card: s.decks[0][sel]!, d: a.d });
    sel = null;
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

  pauseBtn.onclick = () => { paused = !paused; pauseBtn.textContent = paused ? 'เล่น' : 'หยุด'; };
  speedBtn.onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; speedBtn.textContent = `x${speed}`; };
  // Keyboard: 1-8 pick a card, Space rings the bell, Esc drops the card, P pauses.
  const onKey = (ev: KeyboardEvent) => {
    if (ev.repeat || battleOver(s)) return;
    const n = Number(ev.key);
    if (human && n >= 1 && n <= cards.length) pick(n - 1);
    else if (ev.code === 'Space') { ev.preventDefault(); bellBtn.click(); }
    else if (ev.key === 'Escape') pick(null);
    else if (ev.key === 'p') pauseBtn.click();
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
      b.fill.style.width = `${(100 * hp) / battle.castle.hp}%`;
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
    put('bell', String(s.castles[0].artUsed), (v) => { bellState.textContent = v === 'true' ? 'ใช้แล้ว' : '×1'; bellBtn.disabled = v === 'true' || !human; });
  }
  // The mana bar fills toward the next point between ticks (the sim only adds whole points).
  function manaProgress(): number {
    if (s.mana[0] >= battle.manaMax) return 1;
    const r = battle.regen[regenPhase()];
    return r ? ((s.tick - r.from) % r.every) / r.every : 0;
  }

  // The bell's cut-in: a slanted band across the field with the bell and its name for 0.6 s; the game runs on.
  function cutIn(side: Side) {
    const band = el('div', `band side${side}`);
    band.append(bellIcon(6), nowrapWords(el('b'), `${battle.castle.artNameTh}${side === 0 ? '' : ' · ศัตรู'}`));
    cutin.replaceChildren(band);
  }

  let lastPhase = 0;
  function onEvents(ev: BattleEvent[]) {
    for (const e of ev) {
      if (e.e === 'hit') {
        play(e.from != null && e.from < 0 ? 'shoot' : 'hit', 0.08);
        if (e.type === 'castle') play('castle', 0.1);
        if ((e.from ?? 0) >= 1 && (e.to ?? 0) >= 1) game.fights++;
      }
      else if (e.e === 'spawn') play('summon');
      else if (e.e === 'kill') play('death');
      else if (e.e === 'art') { play('bell'); cutIn(e.side as Side); toast(e.side === 0 ? 'ระฆังสะกด! ศัตรูในครึ่งสนามเราหยุดนิ่ง' : 'ศัตรูตีระฆังสะกด!', e.side === 0 ? '' : 'bad'); }
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
        const cmds = [...(human ? pending : botCommands(s, 0, o.bots[0]!, rngs[0]!)), ...botCommands(s, 1, o.bots[1], rngs[1]!)];
        pending = [];
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
      const r: MatchResult = { winner: s.winner!, step: d.step, broken: s.castles[0].hp <= 0 || s.castles[1].hp <= 0, castles: [s.castles[0].hp, s.castles[1].hp], tick: s.tick };
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
