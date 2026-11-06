// Battle screen: runs the sim at a fixed 20 Hz, draws it on a Canvas 2D board and puts the HUD in plain DOM.
// It owns `root` until dispose(); the front flow decides what happens after onEnd.
import {
  arts, cards, createDefend, defOf, discipleStats, enemies as enemyDefs, evaluateStars, isOver, recipeById, roleDefs, sellValue,
  skills, stepDefend, TICK_HZ, tileRange, units, upgradeCost, upgradeLevels, AUTO_START_TICKS, canBuild, moonPhase, openPath, type Command, type DefendState, type SimEvent,
} from '@five-sects/sim';
import { botCommands } from '../../sim/test/bot';
import { Board } from './board';
import type { Settings } from './profile';
import { applyVolume, play } from './sound';

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };

const ERRORS: Record<string, string> = {
  'not enough silver': 'ตำลึงไม่พอ', 'cannot build here': 'วางตรงนี้ไม่ได้', 'sect locked': 'ยังไม่ปลดศิษย์นี้', 'cannot upgrade': 'อัปเกรดไม่ได้แล้ว',
  'no more waves': 'ไม่มีระลอกเหลือ', 'art on cooldown': 'วิชายังไม่พร้อม', 'no enemies': 'ยังไม่มีศัตรู', 'cannot call a wave now': 'เรียกระลอกตอนนี้ไม่ได้',
};
export const STARS: Record<string, string> = {
  clear: 'ผ่านด่าน', no_life_lost: 'ไม่เสียชีวิต', under_3min: 'จบใน 3 นาที', hold_200_silver: 'เหลือตำลึง 200 ขึ้นไป',
  max_6_disciples: 'ใช้ศิษย์ไม่เกิน 6', max_2_sects: 'ไม่เกิน 2 สำนัก', use_combo: 'ใช้ท่าผสาน',
};
const TARGETS: [string, string][] = [['first', 'ตัวแรก'], ['strong', 'แรงสุด'], ['weak', 'อ่อนสุด'], ['close', 'ใกล้สุด']];
const name = (key: string) => units.get(key)?.nameTh ?? defOf(key).nameTh;

export interface BattleOpts { stageId: string; sect: string | null; seed: number; bot: boolean; speed: number; settings: Settings; saveSettings: () => void }
export interface BattleResult { won: boolean; stars: boolean[]; tick: number; livesLost: number }

export function startBattle(app: HTMLElement, o: BattleOpts, onEnd: (r: BattleResult) => void): () => void {
  const { stageId, seed } = o;
  let speed = o.speed;
  const useBot = o.bot;
  const s: DefendState = createDefend(stageId, seed, o.sect);

  // ---- layout: top bar across, board on the left, side panel on the right ----
  const root = el('div', 'battle');
  const top = el('div', 'top');
  const canvas = el('canvas', 'board');
  const floats = el('div', 'floats');
  const bottom = el('div', 'bottom');
  const toastBox = el('div', 'toasts');
  root.append(top, canvas, floats, bottom, toastBox);
  app.append(root);
  const board = new Board(canvas, s);
  const set = o.settings;
  board.shake = set.shake;

  const hud = { silver: el('b'), lives: el('b'), wave: el('b'), next: el('span', 'next') };
  const pauseBtn = el('button', 'icon', 'หยุด');
  const speedBtn = el('button', 'icon', `x${speed}`);
  // Sound and shake settings live in the top bar and are saved with the profile.
  const muteBtn = el('button', 'icon', '');
  const vol = el('input', 'vol');
  Object.assign(vol, { type: 'range', min: '0', max: '100', step: '10', title: 'ระดับเสียง' });
  vol.value = String(set.volume);
  const shakeBtn = el('button', 'icon', '');
  const showSettings = () => { muteBtn.textContent = set.muted ? 'เสียง: ปิด' : 'เสียง'; shakeBtn.textContent = set.shake ? 'จอสั่น' : 'จอนิ่ง'; };
  const changed = () => { board.shake = set.shake; applyVolume(); showSettings(); o.saveSettings(); };
  muteBtn.onclick = () => { set.muted = !set.muted; changed(); };
  vol.oninput = () => { set.volume = Number(vol.value); set.muted = false; changed(); };
  shakeBtn.onclick = () => { set.shake = !set.shake; changed(); };
  showSettings();
  top.append(el('span', '', 'ตำลึง '), hud.silver, el('span', '', ' ชีวิต '), hud.lives, el('span', '', ' ระลอก '), hud.wave, hud.next, muteBtn, vol, shakeBtn, speedBtn, pauseBtn);
  const onResize = () => { board.resize(); const r = hud.silver.getBoundingClientRect(); board.silverAt(r.left + r.width / 2, r.top + r.height / 2); };
  addEventListener('resize', onResize);
  onResize();

  const artsRow = el('div', 'arts');
  const panel = el('div', 'panel');
  const cardsRow = el('div', 'cards');
  const waveBtn = el('button', 'primary wave');
  bottom.append(cardsRow, panel, artsRow, waveBtn);

  let pending: Command[] = [];
  let selectedKey: string | null = s.unlocked[0] ?? null; // card to place
  let selectedId: number | null = null; // placed disciple
  let paused = false;
  let sellArmed = false;

  function toast(msg: string) {
    const t = el('div', 'toast', msg);
    toastBox.append(t);
    setTimeout(() => t.remove(), 1800);
  }

  function float(x: number, y: number, text: string, cls: string) {
    const p = board.toScreen(x, y);
    const f = el('div', `float ${cls}`, text);
    f.style.left = `${p.x + canvas.offsetLeft}px`; f.style.top = `${p.y + canvas.offsetTop}px`;
    floats.append(f);
    setTimeout(() => f.remove(), 900);
  }

  // ---- cards (place) ----
  const cardEls = new Map<string, HTMLButtonElement>();
  for (const key of s.unlocked) {
    const u = units.get(key);
    const b = el('button', 'card');
    b.style.borderColor = defOf(key).color;
    b.append(el('kbd', '', String(cardEls.size + 1)), el('b', '', name(key)), el('small', '', u ? roleDefs.get(u.roleId)!.nameTh : ''), el('span', 'cost', `${defOf(key).cost}`));
    b.onclick = () => { selectedKey = key; selectedId = null; refresh(); };
    cardsRow.append(b);
    cardEls.set(key, b);
  }

  // ---- arts ----
  const artEls = arts.map((a) => {
    const b = el('button', 'art');
    b.onclick = () => pending.push({ t: 'cast', art: a.id });
    artsRow.append(b);
    return b;
  });

  waveBtn.onclick = () => pending.push({ t: 'nextWave' });
  pauseBtn.onclick = () => { paused = !paused; pauseBtn.textContent = paused ? 'เล่น' : 'หยุด'; };
  speedBtn.onclick = () => { speed = speed === 1 ? 2 : 1; speedBtn.textContent = `x${speed}`; };

  // Keyboard: 1-9 pick a disciple card, Space calls the next wave, U upgrades, P pauses, Esc clears the selection.
  const onKey = (ev: KeyboardEvent) => {
    if (ev.repeat || isOver(s)) return;
    const card = [...cardEls.values()][Number(ev.key) - 1];
    if (card) card.click();
    else if (ev.code === 'Space') { ev.preventDefault(); waveBtn.click(); }
    else if (ev.key === 'u' && selectedId != null) pending.push({ t: 'upgrade', id: selectedId });
    else if (ev.key === 'p') pauseBtn.click();
    else if (ev.key === 'Escape') { selectedKey = null; selectedId = null; refresh(); }
  };
  addEventListener('keydown', onKey);

  canvas.addEventListener('pointerdown', (ev) => {
    if (isOver(s)) return;
    const t = board.tileAt(ev.clientX, ev.clientY);
    if (!t) return;
    const d = s.disciples.find((x) => x.tx === t.tx && x.ty === t.ty);
    if (d) { selectedId = d.id; selectedKey = null; sellArmed = false; refresh(); return; }
    if (selectedKey) pending.push({ t: 'place', sect: selectedKey, tx: t.tx, ty: t.ty });
    else { selectedId = null; refresh(); }
  });
  canvas.addEventListener('pointermove', (ev) => { hover = board.tileAt(ev.clientX, ev.clientY); });
  let hover: { tx: number; ty: number } | null = null;

  // ---- the selected disciple: stats, next technique, upgrade / sell / target ----
  function drawPanel() {
    panel.replaceChildren();
    const d = s.disciples.find((x) => x.id === selectedId);
    if (!d) {
      if (selectedKey) {
        const u = units.get(selectedKey);
        panel.append(el('b', '', name(selectedKey)), el('p', '', u?.descTh ?? 'คลิกช่องว่างบนกระดานเพื่อวาง'));
      }
      return;
    }
    const key = d.unit ?? d.els[0]!;
    const st = discipleStats(s, d);
    const tiers = skills.get(d.els[0]!) ?? [];
    const next = tiers.find((k) => k.lvl === d.level + 1);
    panel.append(
      el('b', '', `${name(key)} · ขั้น ${d.level}/${upgradeLevels}`),
      el('p', '', `ดาเมจ ${st.dmg} · ระยะ ${(st.range / 1000).toFixed(1)} · ${(TICK_HZ / st.cooldown).toFixed(1)} ครั้ง/วิ`),
      el('p', 'skill', next ? `ขั้นถัดไป: ${next.nameTh} — ${next.effectTh}` : 'เต็มขั้นแล้ว'),
    );
    const row = el('div', 'row');
    const upCost = upgradeCost(d);
    const upB = el('button', 'primary', d.level >= upgradeLevels ? 'เต็มขั้น' : `อัปเกรด ${upCost}`);
    upB.disabled = d.level >= upgradeLevels || s.silver < upCost;
    upB.onclick = () => pending.push({ t: 'upgrade', id: d.id });
    const sellB = el('button', '', sellArmed ? `ยืนยันขาย +${sellValue(d, s)}` : `ขาย +${sellValue(d, s)}`);
    sellB.onclick = () => { if (sellArmed) { pending.push({ t: 'sell', id: d.id }); selectedId = null; } sellArmed = !sellArmed; refresh(); };
    const tgt = el('button', '', `เป้า: ${TARGETS.find(([k]) => k === d.target)![1]}`);
    tgt.onclick = () => { const i = TARGETS.findIndex(([k]) => k === d.target); pending.push({ t: 'target', id: d.id, mode: TARGETS[(i + 1) % TARGETS.length]![0] }); };
    row.append(upB, sellB, tgt);
    panel.append(row);
  }

  // ---- offer (pick a manual every 5 waves) ----
  const offerBox = el('div', 'modal hidden');
  app.append(offerBox);
  let offerShown: string[] | null = null;
  function drawOffer() {
    if (s.offer === offerShown) return;
    offerShown = s.offer;
    offerBox.classList.toggle('hidden', !s.offer);
    if (!s.offer) return;
    offerBox.replaceChildren(el('h2', '', 'เลือกคัมภีร์'));
    for (const id of s.offer) {
      const c = cards.find((x) => x.id === id)!;
      const b = el('button', 'offer');
      b.append(el('b', '', c.nameTh), el('p', '', c.effectTh));
      b.onclick = () => pending.push({ t: 'pick', card: id });
      offerBox.append(b);
    }
    offerBox.append(el('p', 'timer'));
  }

  let lastSilver = -1, lastPhase = '';
  function refresh() {
    hud.silver.textContent = String(s.silver);
    hud.lives.textContent = String(s.lives);
    hud.wave.textContent = `${s.wave}/${s.totalWaves}`;
    const nextIn = s.phase === 'build' ? AUTO_START_TICKS - s.tick : s.phase === 'break' ? s.breakT : 0;
    const nextName = s.wave < s.totalWaves ? recipeById(s.nextRecipe).nameTh : '';
    hud.next.textContent = nextName ? ` · ถัดไป: ${nextName}${nextIn > 0 ? ` (${Math.ceil(nextIn / TICK_HZ)} วิ)` : ''}${biomeHint()}` : '';
    waveBtn.textContent = s.phase === 'build' ? 'เริ่มบุก' : 'เรียกระลอกถัดไป';
    waveBtn.disabled = s.wave >= s.totalWaves || s.phase === 'picking';
    for (const [key, b] of cardEls) { b.classList.toggle('sel', key === selectedKey); b.classList.toggle('poor', s.silver < defOf(key).cost); }
    arts.forEach((a, i) => {
      const cd = s.artCd[i]!, ch = s.artCharges[i]!;
      artEls[i]!.textContent = `${a.glyph} ${a.nameTh}${cd > 0 ? ` ${Math.ceil(cd / TICK_HZ)}` : ch > 0 ? ` ×${ch}` : ` ${a.rechargeSilver}`}`;
      artEls[i]!.disabled = cd > 0 || (ch === 0 && s.silver < a.rechargeSilver);
    });
    drawPanel();
    drawOffer();
    if (s.offer) offerBox.querySelector('.timer')!.textContent = `เลือกเองใน ${Math.ceil(s.offerT / TICK_HZ)} วิ`;
  }

  // Next-wave warnings for the biome rule: which city gate opens, and the blood moon's phase (SPEC-pc-v2 §7).
  function biomeHint(): string {
    const w = s.wave + 1;
    let o = '';
    const road = openPath(stageId, w);
    if (road != null) o += ` · ประตูเปิด: ทาง ${road + 1}${s.wave > 0 && road !== openPath(stageId, s.wave) ? ' (สลับ!)' : ''}`;
    if (s.rule.moonEveryWaves > 0) {
      const ph = moonPhase(s.rule, w);
      o += ` · จันทร์โลหิต เฟส ${ph}${s.wave > 0 && ph !== moonPhase(s.rule, s.wave) ? ' (ธาตุศัตรูเลื่อน!)' : ''}`;
    }
    return o;
  }

  function onEvents(ev: SimEvent[]) {
    for (const e of ev) {
      if (e.e === 'error') toast(ERRORS[e.msg!] ?? e.msg!);
      else if (e.e === 'hit') { play('shoot'); play('hit', 0.1); }
      else if (e.e === 'kill') {
        float(e.x!, e.y!, `+${e.amount}`, 'silver');
        play('death'); play('silver', 0.5);
        hud.silver.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 200, delay: 550 });
      } else if (e.e === 'wave') {
        play('wave');
        const road = openPath(stageId, s.wave);
        if (road != null && s.wave > 1 && road !== openPath(stageId, s.wave - 1)) toast(`ประตูเมืองสลับ: เปิดทาง ${road + 1}`);
        if (s.rule.moonEveryWaves > 0 && s.wave > 1 && moonPhase(s.rule, s.wave) !== moonPhase(s.rule, s.wave - 1)) toast('จันทร์โลหิตเปลี่ยนเฟส: ธาตุศัตรูเลื่อน');
      }
      else if (e.e === 'spawn' && enemyDefs.get(s.enemies.find((x) => x.id === e.id)?.type ?? '')?.boss != null) { play('boss'); toast('บอสมาถึง!'); }
      else if (e.e === 'interest' && e.amount! > 0) toast(`ดอกเบี้ย +${e.amount}`);
      else if (e.e === 'leak') toast('ศัตรูหลุดเข้าประตู!');
      else if (e.e === 'newEnemy') toast(`ศัตรูใหม่: ${enemyDefs.get(e.type!)!.nameTh}`);
      else if (e.e === 'picked') toast(`ได้คัมภีร์: ${cards.find((c) => c.id === e.name)!.nameTh}`);
      else if (e.e === 'seal') toast('บอสผนึกศิษย์!');
      else if (e.e === 'placed') { selectedId = null; }
    }
  }

  // ---- loop ----
  const mem = { placed: 0 };
  let acc = 0, last = performance.now(), frames = 0, fpsAt = last;
  // Hooks for scripts/shots.mjs (visual proof in a real browser).
  Object.assign(window, { __game: { s, fps: 0 }, __toScreen: (tx: number, ty: number) => board.toScreen(tx * 1000 + 500, ty * 1000 + 500, 0) });
  function frame(now: number) {
    const dt = Math.min(250, now - last); last = now;
    if (!paused && !isOver(s)) {
      acc += dt * speed;
      while (acc >= 1000 / TICK_HZ && !isOver(s)) {
        acc -= 1000 / TICK_HZ;
        const cmds = useBot ? botCommands(s, {}, mem) : pending;
        pending = [];
        const ev = stepDefend(s, cmds);
        onEvents(ev);
        board.events(s, ev, now);
        if (isOver(s)) onEnd({ won: s.phase === 'won', stars: s.stars ?? evaluateStars(s, s.phase === 'won'), tick: s.tick, livesLost: s.livesLost });
      }
    }
    if (s.silver !== lastSilver || s.phase !== lastPhase || s.tick % 10 === 0) { refresh(); lastSilver = s.silver; lastPhase = s.phase; }
    const d = s.disciples.find((x) => x.id === selectedId);
    if (d) board.showRange(d.x, d.y, discipleStats(s, d).range);
    else if (selectedKey && hover) {
      const r = tileRange(s, defOf(selectedKey).range, [units.get(selectedKey)?.sect ?? selectedKey], hover.tx, hover.ty); // roof reach, fog cap
      board.showRange(hover.tx * 1000 + 500, hover.ty * 1000 + 500, r, hover, canBuild(s, hover.tx, hover.ty));
    }
    else board.showRange(0, 0, null);
    board.sync(s, now);
    board.render();
    frames++;
    if (now - fpsAt >= 1000) { (window as unknown as { __game: { fps: number } }).__game.fps = frames; frames = 0; fpsAt = now; }
    raf = requestAnimationFrame(frame);
  }
  refresh();
  let raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); removeEventListener('resize', onResize); removeEventListener('keydown', onKey); board.dispose(); };
}
