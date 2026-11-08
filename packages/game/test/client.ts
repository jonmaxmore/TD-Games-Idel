// A headless room client for the tests: a ws socket, every server message parsed through the protocol, and waits.
import WebSocket from 'ws';
import { Lockstep, PROTOCOL_VERSION, parseServer, type ClientMsg, type ServerMsg } from '@five-sects/protocol';

type Of<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;
export class TestClient {
  readonly got: ServerMsg[] = [];
  closed: { code: number; reason: string } | null = null;
  ls: Lockstep | null = null;
  onMsg: ((m: ServerMsg) => void) | null = null;
  private waits: { pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      const m = parseServer(d.toString());
      this.got.push(m);
      if (m.t === 'start') this.ls = new Lockstep(m);
      if (m.t === 'frame' && this.ls) this.ls.frame(m.tick, m.cmds);
      this.onMsg?.(m);
      this.waits = this.waits.filter((w) => (w.pred(m) ? (w.res(m), false) : true));
    });
    ws.on('close', (code, reason) => { this.closed = { code, reason: reason.toString() }; });
  }
  static async open(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
    const ws = new WebSocket(url, { headers });
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); ws.once('unexpected-response', (_q, r) => rej(new Error(`HTTP ${r.statusCode}`))); });
    return new TestClient(ws);
  }
  send(m: ClientMsg | string) { this.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
  next<T extends ServerMsg['t']>(t: T, pred: (m: Of<T>) => boolean = () => true, ms = 5000): Promise<Of<T>> {
    const seen = this.got.find((m) => m.t === t && pred(m as Of<T>));
    if (seen) { this.got.splice(this.got.indexOf(seen), 1); return Promise.resolve(seen as Of<T>); }
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`timeout waiting for ${t}`)), ms);
      this.waits.push({ pred: (m) => m.t === t && pred(m as Of<T>), res: (m) => { clearTimeout(timer); this.got.splice(this.got.indexOf(m), 1); res(m as Of<T>); } });
    });
  }
  async hello(name: string, token?: string) { this.send({ t: 'hello', v: PROTOCOL_VERSION, name, ...(token ? { token } : {}) }); return this.next('welcome'); }
  waitClose(ms = 3000): Promise<{ code: number; reason: string }> {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('not closed')), ms); this.ws.once('close', (code, r) => { clearTimeout(t); res({ code, reason: r.toString() }); }); });
  }
  close() { this.ws.close(); }
}
