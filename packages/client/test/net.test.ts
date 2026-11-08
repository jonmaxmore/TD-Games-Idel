// The browser's room link against a stub server (node's own WebSocket on the client side): why a connection failed, and
// a dropped socket forgetting the lobby's cached probe.
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION } from '@five-sects/protocol';
import { ERROR_TH, LinkError, probe, RoomClient } from '../src/net';

let wss: WebSocketServer | null = null;
afterEach(() => { wss?.close(); wss = null; });
async function stub(onHello: (ws: import('ws').WebSocket) => void): Promise<string> {
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => wss!.once('listening', () => r()));
  wss.on('connection', (ws) => ws.on('message', (d) => { if (JSON.parse(d.toString()).t === 'hello') onHello(ws); }));
  return `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
}
const welcome = { t: 'welcome', v: PROTOCOL_VERSION, token: 'a'.repeat(43), name: 'x', delay: 3, tickMs: 50 };

describe('RoomClient', () => {
  it('a server that refuses the version says so, in Thai, instead of "no connection"', async () => {
    const url = await stub((ws) => { ws.send(JSON.stringify({ t: 'error', code: 'version' })); ws.close(1008, 'version'); });
    const err = await new RoomClient(url).open('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LinkError);
    expect(ERROR_TH[(err as LinkError).code!]).toBe('เวอร์ชันเกมไม่ตรงกับเซิร์ฟเวอร์ รีเฟรชหน้า');
  });

  it('a dropped socket makes the lobby ask the server again', async () => {
    const url = await stub((ws) => ws.send(JSON.stringify(welcome)));
    expect(await probe(url)).toBe(true);
    const c = new RoomClient(url), gone = new Promise<void>((r) => { c.onLink = (s) => { if (s === 'gone') r(); }; });
    await c.open('x');
    for (const s of wss!.clients) s.terminate();
    await gone;
    wss!.close();
    expect(await probe(url, 300)).toBe(false);
  });
});
