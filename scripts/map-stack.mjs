// scripts/map-stack.mjs — turn a minified browser stack trace into src/ lines.
//
// Crash reports from the live app carry stacks like
//   at Xe (https://lmt.bobcatofindy.com/assets/index-B1x9.js:41:2318)
// Vite builds are deterministic, so rebuilding the same code with source maps
// recreates the same file and positions:
//
//   npx vite build --sourcemap hidden --outDir /tmp/lmt-map
//   node scripts/map-stack.mjs /tmp/lmt-map stack.txt
//
// stack.txt holds the stack copied from the GitHub issue. Prints each frame
// mapped to its source file, line and original name. The issue's "Build" is
// the commit that was live; if main has moved on since (`git log <build>..HEAD
// -- src`), the mapped lines can be off — read the code around them.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { SourceMap } from 'node:module';

const [outDir, stackFile] = process.argv.slice(2);
if (!outDir || !stackFile) {
  console.error('usage: node scripts/map-stack.mjs <build outDir> <stack.txt>');
  process.exit(1);
}
const assets = join(outDir, 'assets');
const maps = new Map();
for (const f of existsSync(assets) ? readdirSync(assets) : []) {
  if (f.endsWith('.js.map')) maps.set(f.replace(/\.map$/, ''), new SourceMap(JSON.parse(readFileSync(join(assets, f), 'utf8'))));
}
if (!maps.size) { console.error(`No source maps in ${assets} — build with --sourcemap hidden first.`); process.exit(1); }

const frame = /([\w.-]+\.js):(\d+):(\d+)/;
for (const line of readFileSync(stackFile, 'utf8').split('\n')) {
  const m = line.match(frame);
  const map = m && maps.get(basename(m[1]));
  if (!map) { console.log(line); continue; }
  const e = map.findEntry(Number(m[2]) - 1, Number(m[3]) - 1);
  if (!e || !e.originalSource) { console.log(line + '   (no mapping)'); continue; }
  const src = e.originalSource.replace(/^.*?\/src\//, 'src/');
  console.log(`${line.trim()}\n    → ${src}:${e.originalLine + 1}:${e.originalColumn + 1}${e.name ? ` (${e.name})` : ''}`);
}
