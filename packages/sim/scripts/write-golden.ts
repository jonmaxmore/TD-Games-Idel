// npm run sim:golden — writes prototypes/unity/Assets/Editor/Tests/golden-*.json
import { writeFileSync } from 'node:fs';
import { GOLDENS } from './golden';

const OUT = new URL('../../../prototypes/unity/Assets/Editor/Tests/', import.meta.url);

for (const [name, make] of Object.entries(GOLDENS)) {
  const g = make();
  writeFileSync(new URL(`golden-${name}.json`, OUT), JSON.stringify(g, null, 1) + '\n');
  console.log(name, g.final.phase, 'ticks', g.final.tick, 'trace', g.trace.length, 'hash', g.final.hash);
}
