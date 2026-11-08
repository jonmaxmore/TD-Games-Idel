import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  // The guest token travels in hello: a release build must not point at a plain ws:// server (net.ts refuses it too).
  const game = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_').VITE_GAME_SERVER;
  if (command === 'build' && mode === 'production' && game?.startsWith('ws:')) throw new Error(`VITE_GAME_SERVER=${game}: a release build needs wss://`);
  return {
    server: { port: 5173, host: true },
    build: { chunkSizeWarningLimit: 2000 },
  };
});
