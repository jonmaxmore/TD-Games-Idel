// The game server: Fastify with one WebSocket route (/v1/ws) for friend rooms and a health check. Upgrades from a browser
// origin not on the allow list are refused; each IP may hold a few sockets; frames over MAX_CLIENT_BYTES close the socket.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { MAX_CLIENT_BYTES } from '@five-sects/protocol';
import { defaultOpts, Lobby, type LobbyOpts, type MatchRecord, type MatchStore } from './lobby';

export interface ServerOpts extends Partial<Omit<LobbyOpts, 'store'>> {
  store?: MatchStore;
  origins?: (origin: string) => boolean; // which browser origins may connect (no Origin header: a non-browser client)
  maxConnsPerIp?: number;
  logger?: boolean;
}

// Dev default: any page served from this machine (vite picks its own port).
export const localOrigins = (o: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(o);
export const originList = (list: string) => { const ok = new Set(list.split(',').map((x) => x.trim()).filter(Boolean)); return (o: string) => ok.has(o); };

export class MemoryStore implements MatchStore {
  readonly records: MatchRecord[] = [];
  save(r: MatchRecord) { this.records.push(r); if (this.records.length > 1000) this.records.shift(); }
}
// One JSON file per match under dir (a stand-in until M1 puts replays in object storage and the index in PostgreSQL).
export class DirStore extends MemoryStore {
  constructor(private dir: string) { super(); mkdirSync(dir, { recursive: true }); }
  override save(r: MatchRecord) { super.save(r); writeFileSync(join(this.dir, `${r.playedAt.slice(0, 10)}-${r.id}.json`), JSON.stringify(r)); }
}

export async function buildServer(o: ServerOpts = {}): Promise<{ app: FastifyInstance; lobby: Lobby }> {
  const store = o.store ?? new MemoryStore();
  const lobby = new Lobby({ ...defaultOpts(store), ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)), store } as LobbyOpts);
  const app = Fastify({ logger: o.logger ?? false, bodyLimit: 1024, trustProxy: false });
  const allowed = o.origins ?? localOrigins, perIp = o.maxConnsPerIp ?? 8, conns = new Map<string, number>();
  await app.register(websocket, { options: { maxPayload: MAX_CLIENT_BYTES, perMessageDeflate: false } });
  app.addHook('onClose', async () => lobby.close());
  app.get('/health', async () => ({ ok: true, rooms: lobby.rooms.size }));
  app.get('/v1/ws', {
    websocket: true,
    preValidation: async (req, reply) => {
      const origin = req.headers.origin;
      if (origin != null && !allowed(origin)) return reply.code(403).send({ error: 'origin' });
      if ((conns.get(req.ip) ?? 0) >= perIp) return reply.code(429).send({ error: 'too many connections' });
    },
  }, (socket, req) => {
    const ip = req.ip;
    conns.set(ip, (conns.get(ip) ?? 0) + 1);
    const h = lobby.connect({ ip, send: (t) => { if (socket.readyState === socket.OPEN) socket.send(t); }, close: (c, r) => socket.close(c, r) });
    socket.on('message', (data, isBinary) => {
      if (isBinary) { socket.close(1003, 'text only'); return; }
      try { h.message(data.toString('utf8')); } catch (e) { app.log.error(e); socket.close(1011, 'error'); }
    });
    socket.on('close', () => {
      const n = (conns.get(ip) ?? 1) - 1;
      if (n <= 0) conns.delete(ip); else conns.set(ip, n);
      h.close();
    });
    socket.on('error', () => socket.terminate());
  });
  return { app, lobby };
}
