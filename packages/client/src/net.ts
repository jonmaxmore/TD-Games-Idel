// The browser's link to the friend-room server: where it is (VITE_GAME_SERVER, else this machine), whether it answers,
// and one socket that says hello with the saved guest token, parses every message through the protocol and, during a
// match, reconnects by itself inside the server's reconnect window.
import { PROTOCOL_VERSION, RECONNECT_SEC, parseServer, type ClientMsg, type ErrorCode, type RejectCode, type ServerMsg } from '@five-sects/protocol';

const TOKEN_KEY = 'five-sects.pvp.token', NAME_KEY = 'five-sects.pvp.name';
const LOOPBACK = /^wss?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/[\w/]*$/;
// The token lives in sessionStorage: it survives a reload of this tab (a reconnect) and each tab is its own guest, so two
// tabs on one machine can play each other. The name is remembered across tabs.
const store = (k: string) => (k === TOKEN_KEY ? sessionStorage : localStorage);
const get = (k: string) => { try { return store(k).getItem(k); } catch { return null; } };
const put = (k: string, v: string) => { try { store(k).setItem(k, v); } catch { /* storage blocked: the token lasts this page */ } };

// The server URL, or null with the reason it cannot be used from this page. ?server= may point at another port on this
// machine only (dev and the shots script); a page served over https cannot open a plain ws:// socket.
export function serverUrl(): { url: string | null; why: string | null } {
  const q = new URLSearchParams(location.search).get('server');
  const url = q && LOOPBACK.test(q) ? q : (import.meta.env.VITE_GAME_SERVER as string | undefined) ?? 'ws://localhost:8787/v1/ws';
  if (location.protocol === 'https:' && url.startsWith('ws:')) return { url: null, why: 'หน้านี้เปิดผ่าน https จึงต่อเซิร์ฟเวอร์ในเครื่องไม่ได้ · ศึกกับเพื่อนเล่นได้เมื่อเปิดเกมจากเครื่องที่รันเซิร์ฟเวอร์' };
  return { url, why: null };
}

let probed: { at: number; ok: boolean } | null = null;
// Whether the server answers, remembered for 10 s so the lobby does not knock on every visit.
export function probe(url: string, ms = 1500): Promise<boolean> {
  if (probed && performance.now() - probed.at < 10_000) return Promise.resolve(probed.ok);
  return new Promise((res) => {
    let ws: WebSocket;
    const done = (ok: boolean) => { clearTimeout(t); probed = { at: performance.now(), ok }; try { ws.close(); } catch { /* already closed */ } res(ok); };
    const t = setTimeout(() => done(false), ms);
    try { ws = new WebSocket(url); } catch { done(false); return; }
    ws.onopen = () => done(true);
    ws.onerror = () => done(false);
  });
}

export const ERROR_TH: Record<ErrorCode, string> = {
  bad_message: 'ข้อความถึงเซิร์ฟเวอร์ผิดรูปแบบ ลองโหลดหน้าใหม่', version: 'เกมเวอร์ชันนี้ไม่ตรงกับเซิร์ฟเวอร์ กรุณาโหลดหน้าใหม่',
  need_hello: 'ยังเชื่อมต่อไม่เสร็จ ลองอีกครั้ง', rate_limited: 'ทำรายการถี่เกินไป รอสักครู่แล้วลองใหม่',
  room_not_found: 'ไม่พบห้องนี้ รหัสอาจผิดหรือห้องหมดอายุแล้ว', room_full: 'ห้องนี้เต็มแล้ว หรือเริ่มศึกไปแล้ว',
  room_closed: 'ห้องถูกปิดแล้ว (เจ้าของห้องออกหรือหมดเวลา)', not_in_room: 'ยังไม่ได้อยู่ในห้อง',
  bad_team: 'ทัพนี้ใช้ไม่ได้ เลือกแม่ทัพและรองที่ต่างกัน', no_team: 'เลือกแม่ทัพและรองก่อนกดพร้อม', in_match: 'กำลังอยู่ในศึก',
  server_full: 'เซิร์ฟเวอร์เต็ม ลองใหม่ภายหลัง', replaced: 'บัญชีนี้เข้าเล่นจากอีกหน้าต่างหนึ่งแล้ว',
};
export const REJECT_TH: Record<RejectCode, string> = {
  wrong_side: 'คำสั่งไม่ใช่ของฝั่งเรา', late: 'คำสั่งถึงเซิร์ฟเวอร์ช้าเกินไป', too_early: 'คำสั่งเร็วเกินไป', not_in_hand: 'ไม่มีใบนี้ในมือ',
  too_many: 'สั่งถี่เกินไป', not_running: 'ศึกยังไม่เริ่ม', sim: 'ลงไม่ได้ตอนนี้',
};

export const savedName = () => get(NAME_KEY);
export const saveName = (n: string) => put(NAME_KEY, n);

export class RoomClient {
  private ws: WebSocket | null = null;
  private keep = false; // reconnect when the socket drops (a match is running)
  private name = '';
  onMsg: (m: ServerMsg) => void = () => {};
  onLink: (state: 'open' | 'lost' | 'gone') => void = () => {};
  constructor(readonly url: string) {}

  // Opens the socket and says hello; resolves with the server's welcome (or rejects when it cannot connect).
  open(name: string): Promise<Extract<ServerMsg, { t: 'welcome' }>> {
    this.name = name;
    return new Promise((res, rej) => {
      let welcomed = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        const token = get(TOKEN_KEY);
        this.raw({ t: 'hello', v: PROTOCOL_VERSION, name, ...(token ? { token } : {}) });
      };
      ws.onmessage = (e) => {
        let m: ServerMsg;
        try { m = parseServer(e.data); } catch { ws.close(4001, 'bad server message'); return; }
        if (m.t === 'welcome') { put(TOKEN_KEY, m.token); if (!welcomed) { welcomed = true; this.onLink('open'); res(m); } return; }
        this.onMsg(m);
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (!welcomed) { rej(new Error('no connection')); return; }
        if (this.keep) void this.retry(); else this.onLink('gone');
      };
    });
  }

  // During a match: try again every second while the server still holds our seat.
  private async retry(): Promise<void> {
    this.onLink('lost');
    const until = performance.now() + RECONNECT_SEC * 1000;
    while (this.keep && performance.now() < until) {
      await new Promise((r) => setTimeout(r, 1000));
      try { await this.open(this.name); return; } catch { /* still down */ }
    }
    if (this.keep) { this.keep = false; this.onLink('gone'); }
  }

  set match(on: boolean) { this.keep = on; }
  get connected() { return this.ws?.readyState === WebSocket.OPEN; }
  send(m: ClientMsg) { this.raw(m); }
  private raw(m: ClientMsg) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  close() { this.keep = false; const ws = this.ws; this.ws = null; ws?.close(); }
}
