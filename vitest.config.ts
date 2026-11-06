import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/*/test/**/*.test.ts', 'tools/**/*.test.ts'], testTimeout: 60_000 }, // balance tests play whole stages
});
