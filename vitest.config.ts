import { configDefaults, defineConfig } from 'vitest/config';

// The real-time test (game/test/timing.test.ts) measures wall-clock tick lateness, so it gets the machine to itself: its
// project runs first, alone, and the rest (the balance tests keep every core busy for minutes) runs after it.
const realtime = ['packages/game/test/timing.test.ts'];

export default defineConfig({
  test: {
    testTimeout: 180_000, // balance tests play whole stages on the long 24x12 maps
    projects: [
      { extends: true, test: { name: 'realtime', include: realtime, sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: 'rules', include: ['packages/*/test/**/*.test.ts', 'tools/**/*.test.ts'], exclude: [...configDefaults.exclude, ...realtime], sequence: { groupOrder: 1 } } },
    ],
  },
});
