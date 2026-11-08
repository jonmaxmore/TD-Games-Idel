// npm run dev:server: the friend-room game server on this machine. Env: PORT (8787), HOST (127.0.0.1; 0.0.0.0 inside a
// container), ORIGINS (comma list of allowed browser origins; default: any localhost port), REPLAY_DIR (save each match as JSON).
import { buildServer, DirStore, localOrigins, originList } from './server';

const port = Number(process.env.PORT ?? 8787), host = process.env.HOST ?? '127.0.0.1';
const { app } = await buildServer({
  logger: true,
  origins: process.env.ORIGINS ? originList(process.env.ORIGINS) : localOrigins,
  store: process.env.REPLAY_DIR ? new DirStore(process.env.REPLAY_DIR) : undefined,
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => void app.close().then(() => process.exit(0)));
await app.listen({ port, host });
