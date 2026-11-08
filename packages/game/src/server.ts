// The game server: Fastify with one WebSocket route (/v1/ws) for friend rooms and a health check. Upgrades from a browser
// origin not on the allow list are refused; the server holds at most maxSockets sockets, each address a few, opened at a
// limited rate; frames over MAX_CLIENT_BYTES close the socket; a socket that stops answering pings is cut.
// TLS ends at the reverse proxy in front of this process (wss:// outside, plain ws:// on the private hop to it).
import { mkdirSync, readdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { isIP, isIPv6 } from 'node:net';
import { join } from 'node:path';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { MAX_CLIENT_BYTES } from '@five-sects/protocol';
import { defaultOpts, Limiter, Lobby, type LobbyOpts, type MatchRecord, type MatchStore } from './lobby';

export interface ServerOpts extends Partial<Omit<LobbyOpts, 'store'>> {
  store?: MatchStore;
  origins?: (origin: string) => boolean; // which browser origins may connect (no Origin header: a non-browser client)
  maxConnsPerIp?: number; // per address: an IPv4 address, or an IPv6 /64
  maxSockets?: number; // the whole server
  upgrades?: { burst: number; perSec: number }; // new sockets per address
  pingMs?: number; // a WebSocket ping this often; two unanswered and the socket is cut
  maxBuffered?: number; // bytes queued to a client that is not reading before the socket is cut
  trustProxy?: string[] | false; // the reverse proxy's address or CIDR, whose X-Forwarded-For names the client
  logger?: boolean;
}

// Dev default: any page served from this machine (vite picks its own port).
export const localOrigins = (o: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(o);
export const originList = (list: string) => { const ok = new Set(list.split(',').map((x) => x.trim()).filter(Boolean)); return (o: string) => ok.has(o); };

// The key every per-address limit uses: an IPv4 address as it is, an IPv6 address by its /64 (one customer's whole
// allocation, which an attacker can rotate through freely); an IPv4-mapped IPv6 address is the IPv4 one.
export function ipKey(ip: string): string {
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1]!;
  const a = ip.split('%')[0]!;
  if (!isIPv6(a)) return ip;
  const [head = '', tail] = a.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

// TRUST_PROXY: a comma list of exact proxy addresses or CIDRs. Unset trusts no one, so a spoofed X-Forwarded-For
// cannot pick the address the limits count.
export function parseTrustProxy(v: string | undefined): string[] | false {
  if (!v) return false;
  const list = v.split(',').map((x) => x.trim()).filter(Boolean);
  for (const x of list) {
    const [addr = '', bits, ...rest] = x.split('/'), fam = isIP(addr);
    const okBits = bits === undefined || (/^\d{1,3}$/.test(bits) && Number(bits) > 0 && Number(bits) <= (fam === 4 ? 32 : 128));
    if (!fam || rest.length > 0 || !okBits) throw new Error(`TRUST_PROXY: "${x}" is not an IP address or CIDR`);
  }
  return list;
}

// Listen address and options from the environment (see main.ts). Refuses to listen beyond this machine with the
// localhost origin default, which would let any page a visitor opens on their own machine drive the server.
export function configFromEnv(env: Record<string, string | undefined>): { host: string; port: number; opts: ServerOpts } {
  const host = env.HOST ?? '127.0.0.1', port = Number(env.PORT ?? 8787);
  if (!/^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/.test(host) && !env.ORIGINS) throw new Error(`HOST=${host} listens beyond this machine: set ORIGINS to the allowed browser origins`);
  return {
    host, port,
    opts: {
      origins: env.ORIGINS ? originList(env.ORIGINS) : localOrigins,
      trustProxy: parseTrustProxy(env.TRUST_PROXY),
      store: env.REPLAY_DIR ? new DirStore(env.REPLAY_DIR, Number(env.REPLAY_MAX ?? 10_000)) : undefined,
    },
  };
}

export class MemoryStore implements MatchStore {
  readonly records: MatchRecord[] = [];
  save(r: MatchRecord) { this.records.push(r); if (this.records.length > 1000) this.records.shift(); }
}
// One JSON file per match under dir, written off the tick loop, the oldest removed past maxFiles (a stand-in until M1
// puts replays in object storage and the index in PostgreSQL).
export class DirStore extends MemoryStore {
  private files: string[];
  private q: Promise<void> = Promise.resolve();
  constructor(private dir: string, private maxFiles = 10_000, private onError: (e: unknown) => void = (e) => console.error('replay write failed', e)) {
    super();
    mkdirSync(dir, { recursive: true });
    this.files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  }
  override save(r: MatchRecord) {
    super.save(r);
    const name = `${r.playedAt.replace(/[:.]/g, '-')}-${r.id}.json`, text = JSON.stringify(r);
    this.q = this.q.then(async () => {
      await writeFile(join(this.dir, name), text);
      this.files.push(name);
      while (this.files.length > this.maxFiles) await rm(join(this.dir, this.files.shift()!), { force: true });
    }).catch(this.onError);
  }
  flush(): Promise<void> { return this.q; }
}

export async function buildServer(o: ServerOpts = {}): Promise<{ app: FastifyInstance; lobby: Lobby }> {
  const store: MatchStore = o.store ?? new MemoryStore();
  const lobby = new Lobby({ ...defaultOpts(store), ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)), store } as LobbyOpts);
  const app = Fastify({ logger: o.logger ?? false, bodyLimit: 1024, trustProxy: o.trustProxy ?? false });
  const allowed = o.origins ?? localOrigins, perIp = o.maxConnsPerIp ?? 8, maxSockets = o.maxSockets ?? 2000;
  const pingMs = o.pingMs ?? 15_000, maxBuffered = o.maxBuffered ?? 1024 * 1024;
  const upgrades = new Limiter(o.upgrades?.burst ?? 5, o.upgrades?.perSec ?? 2), conns = new Map<string, number>();
  let open = 0;
  await app.register(websocket, { options: { maxPayload: MAX_CLIENT_BYTES, perMessageDeflate: false } });
  app.addHook('onClose', async () => { lobby.close(); await store.flush?.(); });
  app.get('/health', async () => ({ ok: true }));
  app.get('/v1/ws', {
    websocket: true,
    preValidation: async (req, reply) => {
      const origin = req.headers.origin, ip = ipKey(req.ip);
      if (origin != null && !allowed(origin)) return reply.code(403).send({ error: 'origin' });
      if (open >= maxSockets) return reply.code(503).send({ error: 'server full' });
      if ((conns.get(ip) ?? 0) >= perIp) return reply.code(429).send({ error: 'too many connections' });
      if (!upgrades.take(ip)) return reply.code(429).send({ error: 'too many new connections' });
      // Counted before the upgrade so parallel upgrades cannot all pass the checks; the TCP socket closing (a failed
      // upgrade or the WebSocket ending) gives the slot back.
      open++;
      conns.set(ip, (conns.get(ip) ?? 0) + 1);
      req.raw.socket.once('close', () => {
        open--;
        const n = (conns.get(ip) ?? 1) - 1;
        if (n <= 0) conns.delete(ip); else conns.set(ip, n);
      });
    },
  }, (socket, req) => {
    const send = (t: string) => {
      if (socket.readyState !== socket.OPEN) return;
      // A client this far behind is cut rather than queued without bound (skipping a frame would desync it); it
      // reconnects and gets the whole history in one start message.
      if (socket.bufferedAmount > maxBuffered) { socket.terminate(); return; }
      socket.send(t);
    };
    const h = lobby.connect({ ip: ipKey(req.ip), send, close: (c, r) => socket.close(c, r) });
    let missed = 0;
    socket.on('pong', () => { missed = 0; });
    const beat = setInterval(() => { if (missed >= 2) socket.terminate(); else { missed++; socket.ping(); } }, pingMs);
    socket.on('message', (data, isBinary) => {
      if (isBinary) { socket.close(1003, 'text only'); return; }
      try { h.message(data.toString('utf8')); } catch (e) { app.log.error(e); socket.close(1011, 'error'); }
    });
    socket.on('close', () => { clearInterval(beat); h.close(); });
    socket.on('error', () => socket.terminate());
  });
  return { app, lobby };
}
