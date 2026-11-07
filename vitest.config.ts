import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['packages/*/test/**/*.test.ts', 'tools/**/*.test.ts'], testTimeout: 180_000 }, // balance tests play whole stages on the long 24x12 maps
});
