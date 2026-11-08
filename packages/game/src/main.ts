// npm run dev:server: the friend-room game server on this machine. Env: PORT (8787), HOST (127.0.0.1; 0.0.0.0 inside a
// container, which then needs ORIGINS), ORIGINS (comma list of allowed browser origins; default: any localhost port),
// TRUST_PROXY (the reverse proxy's exact address or CIDR; default: none), REPLAY_DIR (save each match as JSON),
// REPLAY_MAX (files kept there, 10000). Deployed, TLS ends at that proxy: players connect with wss:// only.
import { buildServer, configFromEnv } from './server';

const { host, port, opts } = configFromEnv(process.env);
const { app } = await buildServer({
  ...opts,
  logger: true,
  log: (msg, data) => app.log.info(data ?? {}, msg), // room events; never a token or a message body
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => void app.close().then(() => process.exit(0)));
await app.listen({ port, host });
