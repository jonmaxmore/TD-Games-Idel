// ศึกกับเพื่อน (SPEC-pvp-rooms): create a room or join one by code, show the code with a copy button, choose the hand in the
// deck picker over every card (ศึกฝีมือ rules: the same budget, every card at base stats), ready up; the server's start message hands over to main.ts (versus, then
// the match). The host can send the guest out (kick: they cannot come back to that room). Esc leaves the room, or the
// screen when not in one. Every server error shows in Thai on the screen.
import { battle, battleUnits } from '@five-sects/sim';
import { CODE_LEN, normalizeCode, type Seat, type ServerMsg, type TeamPick } from '@five-sects/protocol';
import { el } from './battle';
import { colorOf, deckPicker } from './deckPicker';
import { deckPoints, largeOf, rankedTeam, RANKED_RULES, spendOf } from './decks';
import { PLAYER_NAME } from './lobby';
import { ERROR_TH, inMatch, LinkError, markMatch, RoomClient, saveName, savedName, serverUrl } from './net';
import { teamOf, type Profile } from './profile';
import { button, confirmBox, setDisabled } from './ui';
import { nowrapWords } from './words';

export type Start = Extract<ServerMsg, { t: 'start' }>;
export interface PvpNav { lobby: () => void; start: (m: Start, c: RoomClient) => void }

let client: RoomClient | null = null; // one socket for the whole visit: the room, then its match
export const roomClient = () => client;
export function dropClient() { client?.close(); client = null; }

export function pvpScreen(app: HTMLElement, p: Profile, nav: PvpNav): () => void {
  const r = el('div', 'screen pvp');
  const status = el('p', 'pvp-status dim center'), error = el('p', 'pvp-error');
  error.setAttribute('role', 'alert');
  const body = el('div', 'pvp-body');
  r.append(el('h1', '', 'ศึกกับเพื่อน'), el('p', 'dim center', 'เล่นกับเพื่อนด้วยรหัสห้อง · กติกาศึกฝีมือ: เลือกมือเองจากการ์ดทุกใบ งบแต้มทัพเท่ากัน ค่าเท่ากันทุกใบ'), status, body, error);
  app.append(r);
  let room: Extract<ServerMsg, { t: 'room' }> | null = null;
  let team = rankedTeam(teamOf(p)), busy = false, gone = false;
  const say = (msg: string) => { error.textContent = msg; };

  const nameIn = el('input', 'pvp-name');
  nameIn.maxLength = 16;
  nameIn.value = savedName() ?? `${PLAYER_NAME}${Math.floor(Math.random() * 900) + 100}`; // two new players are told apart
  nameIn.setAttribute('aria-label', 'ชื่อในศึก');
  const codeIn = el('input', 'pvp-code');
  codeIn.maxLength = CODE_LEN + 1;
  codeIn.placeholder = 'รหัส 6 ตัว';
  codeIn.setAttribute('aria-label', 'รหัสห้อง');
  codeIn.autocomplete = 'off';
  codeIn.spellcheck = false;
  codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase(); });

  async function connected(): Promise<RoomClient | null> {
    if (client?.connected) return client;
    const { url, why } = serverUrl();
    if (!url) { say(why!); return null; }
    client?.close();
    const c = new RoomClient(url);
    client = c;
    status.textContent = 'กำลังเชื่อมต่อเซิร์ฟเวอร์…';
    try {
      const w = await c.open(nameIn.value);
      status.textContent = `เชื่อมต่อแล้ว · ชื่อในศึก: ${w.name}`;
      nameIn.value = w.name;
      saveName(w.name);
    } catch (e) {
      client = null;
      status.textContent = '';
      const code = e instanceof LinkError ? e.code : null;
      say(code ? ERROR_TH[code] : `เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่ภายหลัง${import.meta.env.DEV ? ' (dev: npm run dev:server)' : ''}`);
      return null;
    }
    c.onMsg = onMsg;
    c.onLink = (s) => { if (s === 'gone' && !gone) { room = null; status.textContent = ''; say('การเชื่อมต่อหลุด กดสร้างหรือเข้าห้องอีกครั้ง'); show(); } };
    return c;
  }

  function onMsg(m: ServerMsg) {
    if (m.t === 'room') { room = m; say(''); show(); }
    else if (m.t === 'error') { if (m.code === 'room_closed' || m.code === 'replaced' || m.code === 'kicked') room = null; say(ERROR_TH[m.code]); show(); }
    else if (m.t === 'start') { gone = true; nav.start(m, client!); }
  }

  async function act(f: (c: RoomClient) => void) {
    if (busy) return;
    busy = true;
    say('');
    const c = await connected();
    busy = false;
    if (c) f(c);
  }
  const create = () => act((c) => c.send({ t: 'create' }));
  const join = () => {
    const code = normalizeCode(codeIn.value);
    if (!code) { say(`รหัสห้องมี ${CODE_LEN} ตัว (ตัวอักษรอังกฤษและตัวเลข)`); codeIn.focus(); return; }
    void act((c) => c.send({ t: 'join', code }));
  };
  const leave = () => { client?.send({ t: 'leave' }); room = null; say(''); show(); };
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

  const kick = (name: string) => confirmBox(r, { title: `ให้ ${name} ออกจากห้อง?`, body: 'เพื่อนคนนี้จะกลับเข้าห้องนี้อีกไม่ได้ ต้องสร้างห้องใหม่ถ้าจะเล่นด้วยกัน', yes: 'ให้ออกจากห้อง', no: 'ยกเลิก', danger: true }, () => client?.send({ t: 'kick' }));
  function seatBox(s: Seat | null, i: number, mine: boolean, host: boolean): HTMLElement {
    const box = el('div', `panel pvp-seat side${i}${s?.ready ? ' ready' : ''}`);
    box.append(el('small', 'dim', i === 0 ? 'เจ้าของห้อง · ฝั่งซ้าย' : 'ผู้มาเยือน · ฝั่งขวา'));
    if (!s) { box.append(el('b', 'pvp-wait', 'รอเพื่อนเข้าห้อง…'), el('p', 'dim small', 'ส่งรหัสห้องให้เพื่อน แล้วให้เพื่อนกด "เข้าห้อง"')); return box; }
    const who = nowrapWords(el('b', 'pvp-who'), s.name);
    if (mine) who.append(el('em', 'pvp-me', 'เรา'));
    box.append(who);
    if (!s.online) box.append(el('p', 'bad', 'หลุดการเชื่อมต่อ'));
    const t = s.team, lead = t ? `แม่ทัพ ${battleUnits.get(t.leader)!.nameTh} · รอง ${battleUnits.get(t.sub)!.nameTh}` : 'กำลังเลือกทัพ…';
    box.append(el('p', '', t?.picks ? `${lead} · แต้มทัพ ${spendOf({ ...t, picks: t.picks })}` : lead));
    if (t && !t.picks) box.append(el('p', 'dim small pvp-hidden', 'ทัพของเพื่อนจะเปิดตอนเริ่มศึก'));
    box.append(el('em', s.ready ? 'pvp-ready on' : 'pvp-ready', s.ready ? 'พร้อมแล้ว' : 'ยังไม่พร้อม'));
    if (host && i === 1) box.append(button('ให้ออกจากห้อง', () => kick(s.name), 'ghost', 'sm', 'kick-btn'));
    return box;
  }

  // Our hand in short (leader, sub, the picks, the meters) with จัดทัพ, which opens the deck picker over the room.
  function picker(ready: boolean): HTMLElement {
    const box = el('div', 'panel pvp-team'), cards = el('div', 'pvp-hand');
    for (const c of [team.leader, team.sub, ...team.picks]) {
      const chip = el('span', 'pvp-chip', `${battleUnits.get(c)!.nameTh} ${deckPoints(c)}`);
      chip.style.borderColor = colorOf(c);
      chip.dataset.id = c;
      cards.append(chip);
    }
    const edit = button('จัดทัพ', openSheet, 'secondary', 'md', 'pvp-edit');
    setDisabled(edit, ready ? 'กดยกเลิกพร้อมก่อนแก้ทัพ' : null);
    box.append(el('h2', '', 'ทัพของเรา'), el('small', 'dim', 'แม่ทัพ · รอง · 4 ใบที่เลือก (ตัวเลขคือแต้มทัพ)'), cards,
      el('p', 'pvp-meter', `แต้มทัพ ${spendOf(team)}/${battle.deck.budget} · ตัวใหญ่ ${largeOf(team)}/${battle.hand.maxLarge}`), edit,
      el('p', 'dim small', 'กติกาศึกฝีมือ: เลือกจากการ์ดทุกใบ งบแต้มทัพเท่ากัน ทุกใบค่าพื้นฐานเท่ากัน'));
    return box;
  }
  // The deck picker in a sheet over the room: ใช้ทัพนี้ sends the team (only a legal one); ยกเลิก or Esc keeps the old one.
  let closeSheet: (() => void) | null = null;
  function openSheet() {
    let draft = { ...team, picks: [...team.picks] };
    const back = el('div', 'overlay deck-sheet'), sheet = el('div', 'sheet panel'), row = el('div', 'row actions'), why = el('p', 'enter-why');
    back.setAttribute('role', 'dialog');
    back.setAttribute('aria-modal', 'true');
    back.setAttribute('aria-label', 'จัดทัพ');
    const use = button('ใช้ทัพนี้', () => { team = draft; close(); client?.send({ t: 'team', team }); show(); }, 'primary', 'lg', 'use-btn');
    const pk = deckPicker({ rules: RANKED_RULES, team: draft, progress: () => null, onChange: (t) => { draft = { ...t, picks: [...t.picks] }; check(); } });
    const check = () => { const p = pk.problem(); setDisabled(use, p); why.textContent = p ? `ยังใช้ไม่ได้: ${p}` : ''; };
    const close = () => { pk.dispose(); removeEventListener('keydown', onEsc, true); back.remove(); closeSheet = null; };
    closeSheet = close;
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    addEventListener('keydown', onEsc, true);
    row.append(button('ยกเลิก (Esc)', close, 'ghost', 'md', 'back'), why, use);
    sheet.append(el('h2', '', 'จัดทัพ · ศึกกับเพื่อน'), pk.root, row);
    back.append(sheet);
    (r.parentElement ?? r).append(back); // over the whole 1280x720 stage, wider than the room screen
    check();
  }

  function show() {
    if (!room) {
      closeSheet?.();
      const menu = el('div', 'pvp-menu');
      const nameRow = el('label', 'pvp-pick');
      nameRow.append(el('span', '', 'ชื่อในศึก'), nameIn);
      const joinRow = el('div', 'row pvp-join');
      joinRow.append(codeIn, button('เข้าห้อง', join, 'secondary', 'lg', 'join-btn'));
      const make = button('สร้างห้อง', () => void create(), 'primary', 'lg', 'create-btn');
      menu.append(nameRow, make, el('p', 'dim center', 'หรือใส่รหัสห้องที่เพื่อนส่งมา'), joinRow);
      const row = el('div', 'row actions');
      row.append(button('กลับล็อบบี้ (Esc)', () => { dropClient(); nav.lobby(); }, 'ghost', 'md', 'back'));
      body.replaceChildren(menu, row);
      return;
    }
    const mine = room.seats[room.seat];
    const codeBox = el('div', 'panel pvp-codebox');
    const code = el('b', 'room-code', room.code);
    const copy = button('คัดลอก', () => {
      const done = () => { copy.textContent = 'คัดลอกแล้ว'; setTimeout(() => { copy.textContent = 'คัดลอก'; }, 1500); };
      void navigator.clipboard?.writeText(room!.code).then(done, () => { getSelection()?.selectAllChildren(code); copy.textContent = 'กด Ctrl+C'; });
    }, 'secondary', 'sm', 'copy-btn');
    codeBox.append(el('small', 'dim', 'รหัสห้อง'), code, copy, el('small', 'dim', `ส่งรหัสนี้ให้เพื่อน · ห้องปิดเองใน ${Math.ceil(room.expiresSec / 60)} นาทีถ้ายังไม่เริ่ม`));
    const seats = el('div', 'pvp-seats');
    const host = room.seat === 0;
    seats.append(seatBox(room.seats[0], 0, host, host), el('span', 'vs-word small', 'ปะทะ'), seatBox(room.seats[1], 1, !host, host));
    const ready = mine?.ready ?? false, full = room.seats[0] != null && room.seats[1] != null;
    const row = el('div', 'row actions');
    const go = button(ready ? 'ยกเลิกพร้อม' : 'พร้อม', () => {
      if (!mine?.team) client?.send({ t: 'team', team });
      client?.send({ t: 'ready', on: !ready });
    }, ready ? 'secondary' : 'primary', 'lg', `ready-btn${ready ? ' on' : ''}`);
    row.append(button('ออกจากห้อง (Esc)', leave, 'ghost', 'md', 'back leave-btn'), go);
    const hint = el('p', 'dim center small', !full ? 'เริ่มได้เมื่อเพื่อนเข้าห้องและทั้งสองฝ่ายกดพร้อม' : ready ? 'รอเพื่อนกดพร้อม…' : 'กดพร้อมเมื่อเลือกทัพเสร็จ');
    const mid = el('div', 'pvp-room');
    mid.append(codeBox, seats, picker(ready));
    body.replaceChildren(mid, hint, row);
    if (!mine?.team) client?.send({ t: 'team', team }); // the default pick goes up at once so the friend sees it
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (room) leave(); else { dropClient(); nav.lobby(); }
  };
  addEventListener('keydown', onKey);
  if (client?.connected) { client.onMsg = onMsg; status.textContent = 'เชื่อมต่อแล้ว'; }
  show();
  // Back from a reload mid-match: the saved token's hello brings the match's start; none soon means it is over.
  if (inMatch() && !client) {
    void act(() => {
      status.textContent = 'กำลังกลับเข้าศึก…';
      setTimeout(() => { if (!gone) { markMatch(false); status.textContent = 'เชื่อมต่อแล้ว'; say('ศึกก่อนหน้าจบไปแล้ว'); } }, 3000);
    });
  }
  return () => { closeSheet?.(); removeEventListener('keydown', onKey); if (!gone && client) client.onMsg = () => {}; r.remove(); };
}
