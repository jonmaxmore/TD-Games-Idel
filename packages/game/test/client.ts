// A headless room client for the tests: a ws socket, every server message parsed through the protocol, and waits. Also
// a server on a free port and a room with both seats ready.
import type { AddressInfo } from 'node:net';
import { expect } from 'vitest';
import WebSocket, { type ClientOptions } from 'ws';
import { leaderPool, Lockstep, parseServer, type ClientMsg, type ServerMsg } from '@five-sects/protocol';
import { buildServer, MemoryStore, type ServerOpts } from '../src/server';

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
  static async open(url: string, headers: Record<string, string> = {}, opts: ClientOptions = {}): Promise<TestClient> {
    const ws = new WebSocket(url, { ...opts, headers });
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
  async hello(name: string, token?: string) { this.send({ t: 'hello', v: 1, name, ...(token ? { token } : {}) }); return this.next('welcome'); }
  waitClose(ms = 3000): Promise<{ code: number; reason: string }> {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('not closed')), ms); this.ws.once('close', (code, r) => { clearTimeout(t); res({ code, reason: r.toString() }); }); });
  }
  close() { this.ws.close(); }
}

export async function startServer(o: ServerOpts = {}) {
  const store = new MemoryStore();
  const { app, lobby } = await buildServer({ tickMs: 2, startDelayMs: 20, graceMs: 2000, store, ...o });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  return { app, url: `ws://127.0.0.1:${port}/v1/ws`, http: `http://127.0.0.1:${port}`, store, lobby };
}

const [L0, S0, L1, S1] = leaderPool();
// Host creates, guest joins by code, both pick a team and ready up; resolves on both start messages.
export async function room(url: string, guest: ClientOptions = {}) {
  const a = await TestClient.open(url), b = await TestClient.open(url, {}, guest);
  const wa = await a.hello('เจ้าบ้าน'), wb = await b.hello('แขก');
  a.send({ t: 'create' });
  const { code } = await a.next('room');
  b.send({ t: 'join', code: code.toLowerCase() });
  const r = await b.next('room');
  expect(r.seat).toBe(1);
  expect(r.seats[0]?.name).toBe('เจ้าบ้าน');
  a.send({ t: 'team', team: { leader: L0!, sub: S0! } });
  b.send({ t: 'team', team: { leader: L1!, sub: S1! } });
  a.send({ t: 'ready', on: true });
  b.send({ t: 'ready', on: true });
  const [sa, sb] = await Promise.all([a.next('start'), b.next('start')]);
  return { a, b, code, sa, sb, tokens: [wa.token, wb.token] as const };
}
