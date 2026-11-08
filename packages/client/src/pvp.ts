// ศึกกับเพื่อน (SPEC-pvp-rooms): create a room or join one by code, show the code with a copy button, pick a leader and a
// sub-leader from every card (ศึกฝีมือ rules), ready up; the server's start message hands over to main.ts (versus, then
// the match). Esc leaves the room, or the screen when not in one. Every server error shows in Thai on the screen.
import { battleUnits, sects } from '@five-sects/sim';
import { CODE_LEN, leaderPool, normalizeCode, teamError, type Seat, type ServerMsg, type TeamPick } from '@five-sects/protocol';
import { el } from './battle';
import { PLAYER_NAME } from './lobby';
import { ERROR_TH, RoomClient, saveName, savedName, serverUrl } from './net';
import type { Profile } from './profile';
import { nowrapWords } from './words';

export type Start = Extract<ServerMsg, { t: 'start' }>;
export interface PvpNav { lobby: () => void; start: (m: Start, c: RoomClient) => void }

let client: RoomClient | null = null; // one socket for the whole visit: the room, then its match
export const roomClient = () => client;
export function dropClient() { client?.close(); client = null; }

const btn = (text: string, cls: string, onclick: () => void) => { const b = el('button', cls, text); b.onclick = onclick; return b; };
const cardName = (c: string) => { const u = battleUnits.get(c)!; return `${u.nameTh} · ${sects.get(u.sect)?.nameTh ?? ''} · ปราณ ${u.mana}`; };

// The team a player starts from: the saved team when both cards are allowed, else the first two of the pool.
function firstTeam(p: Profile): TeamPick {
  const t = { leader: p.team.leader, sub: p.team.sub };
  if (!teamError(t)) return t;
  const pool = leaderPool();
  return { leader: pool[0]!, sub: pool[1]! };
}

export function pvpScreen(app: HTMLElement, p: Profile, nav: PvpNav): () => void {
  const r = el('div', 'screen pvp');
  const status = el('p', 'pvp-status dim center'), error = el('p', 'pvp-error');
  error.setAttribute('role', 'alert');
  const body = el('div', 'pvp-body');
  r.append(el('h1', '', 'ศึกกับเพื่อน'), el('p', 'dim center', 'เล่นกับเพื่อนด้วยรหัสห้อง · กติกาศึกฝีมือ: การ์ดทุกใบค่าเท่ากัน เลือกแค่แม่ทัพกับรอง'), status, body, error);
  app.append(r);
  let room: Extract<ServerMsg, { t: 'room' }> | null = null;
  let team = firstTeam(p), busy = false, gone = false;
  const say = (msg: string) => { error.textContent = msg; };

  const nameIn = el('input', 'pvp-name');
  nameIn.maxLength = 16;
  nameIn.value = savedName() ?? PLAYER_NAME;
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
    } catch {
      client = null;
      status.textContent = '';
      say('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ · ต้องเปิดเซิร์ฟเวอร์ในเครื่องก่อน (npm run dev:server) แล้วลองใหม่');
      return null;
    }
    c.onMsg = onMsg;
    c.onLink = (s) => { if (s === 'gone' && !gone) { room = null; status.textContent = ''; say('การเชื่อมต่อหลุด กดสร้างหรือเข้าห้องอีกครั้ง'); show(); } };
    return c;
  }

  function onMsg(m: ServerMsg) {
    if (m.t === 'room') { room = m; say(''); show(); }
    else if (m.t === 'error') { if (m.code === 'room_closed' || m.code === 'replaced') room = null; say(ERROR_TH[m.code]); show(); }
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

  function seatBox(s: Seat | null, i: number, mine: boolean): HTMLElement {
    const box = el('div', `panel pvp-seat side${i}${s?.ready ? ' ready' : ''}`);
    box.append(el('small', 'dim', i === 0 ? 'เจ้าของห้อง · ฝั่งซ้าย' : 'ผู้มาเยือน · ฝั่งขวา'));
    if (!s) { box.append(el('b', 'pvp-wait', 'รอเพื่อนเข้าห้อง…'), el('p', 'dim small', 'ส่งรหัสห้องให้เพื่อน แล้วให้เพื่อนกด "เข้าห้อง"')); return box; }
    box.append(nowrapWords(el('b', 'pvp-who'), `${s.name}${mine ? ' (เรา)' : ''}`));
    if (!s.online) box.append(el('p', 'bad', 'หลุดการเชื่อมต่อ'));
    box.append(el('p', '', s.team ? `แม่ทัพ ${battleUnits.get(s.team.leader)!.nameTh} · รอง ${battleUnits.get(s.team.sub)!.nameTh}` : 'กำลังเลือกทัพ…'));
    box.append(el('em', s.ready ? 'pvp-ready on' : 'pvp-ready', s.ready ? 'พร้อมแล้ว' : 'ยังไม่พร้อม'));
    return box;
  }

  function picker(): HTMLElement {
    const box = el('div', 'panel pvp-team');
    const pool = leaderPool();
    const sel = (label: string, key: keyof TeamPick) => {
      const s = el('select');
      s.setAttribute('aria-label', label);
      for (const c of pool) { const o = el('option', '', cardName(c)); o.value = c; s.append(o); }
      s.value = team[key];
      s.onchange = () => {
        const next = { ...team, [key]: s.value };
        if (next.leader === next.sub) next[key === 'leader' ? 'sub' : 'leader'] = team[key]; // picking the other's card swaps them
        team = next;
        client?.send({ t: 'team', team });
      };
      const row = el('label', 'pvp-pick');
      row.append(el('span', '', label), s);
      return row;
    };
    box.append(el('h2', '', 'ทัพของเรา'), sel('แม่ทัพ', 'leader'), sel('รองแม่ทัพ', 'sub'),
      el('p', 'dim small', 'มือในศึก: ธงยึดป้อมของสำนักแม่ทัพ แม่ทัพ รอง และสุ่มจากการ์ดทุกใบ ค่าเท่ากันทุกใบ'));
    return box;
  }

  function show() {
    if (!room) {
      const menu = el('div', 'pvp-menu');
      const nameRow = el('label', 'pvp-pick');
      nameRow.append(el('span', '', 'ชื่อในศึก'), nameIn);
      const joinRow = el('div', 'row pvp-join');
      joinRow.append(codeIn, btn('เข้าห้อง', 'join-btn', join));
      const make = btn('สร้างห้อง', 'primary big create-btn', () => void create());
      menu.append(nameRow, make, el('p', 'dim center', 'หรือใส่รหัสห้องที่เพื่อนส่งมา'), joinRow);
      const row = el('div', 'row actions');
      row.append(btn('กลับล็อบบี้', '', () => { dropClient(); nav.lobby(); }));
      body.replaceChildren(menu, row);
      return;
    }
    const mine = room.seats[room.seat];
    const codeBox = el('div', 'panel pvp-codebox');
    const code = el('b', 'room-code', room.code);
    const copy = btn('คัดลอก', 'copy-btn', () => {
      const done = () => { copy.textContent = 'คัดลอกแล้ว'; setTimeout(() => { copy.textContent = 'คัดลอก'; }, 1500); };
      void navigator.clipboard?.writeText(room!.code).then(done, () => { getSelection()?.selectAllChildren(code); copy.textContent = 'กด Ctrl+C'; });
    });
    codeBox.append(el('small', 'dim', 'รหัสห้อง'), code, copy, el('small', 'dim', `ส่งรหัสนี้ให้เพื่อน · ห้องปิดเองใน ${Math.ceil(room.expiresSec / 60)} นาทีถ้ายังไม่เริ่ม`));
    const seats = el('div', 'pvp-seats');
    seats.append(seatBox(room.seats[0], 0, room.seat === 0), el('span', 'vs-word small', 'ปะทะ'), seatBox(room.seats[1], 1, room.seat === 1));
    const ready = mine?.ready ?? false, full = room.seats[0] != null && room.seats[1] != null;
    const row = el('div', 'row actions');
    const go = btn(ready ? 'ยกเลิกพร้อม' : 'พร้อม', `primary ready-btn${ready ? ' on' : ''}`, () => {
      if (!mine?.team) client?.send({ t: 'team', team });
      client?.send({ t: 'ready', on: !ready });
    });
    row.append(btn('ออกจากห้อง (Esc)', 'leave-btn', leave), go);
    const hint = el('p', 'dim center small', !full ? 'เริ่มได้เมื่อเพื่อนเข้าห้องและทั้งสองฝ่ายกดพร้อม' : ready ? 'รอเพื่อนกดพร้อม…' : 'กดพร้อมเมื่อเลือกทัพเสร็จ');
    const mid = el('div', 'pvp-room');
    mid.append(codeBox, seats, picker());
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
  return () => { removeEventListener('keydown', onKey); if (!gone && client) client.onMsg = () => {}; r.remove(); };
}
