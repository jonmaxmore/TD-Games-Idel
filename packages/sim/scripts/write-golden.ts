// npm run sim:golden — writes prototypes/unity/Assets/Editor/Tests/golden-*.json
import { writeFileSync } from 'node:fs';
import { golden } from './golden';

const OUT = new URL('../../../prototypes/unity/Assets/Editor/Tests/', import.meta.url);

for (const [stage, seed] of [['1-1', 42], ['T-1', 7]] as const) {
  const g = golden(stage, seed);
  writeFileSync(new URL(`golden-${stage}.json`, OUT), JSON.stringify(g, null, 1) + '\n');
  console.log(stage, g.final.phase, 'ticks', g.final.tick, 'trace', g.trace.length, 'hash', g.final.hash);
}
