// Prints the SHA-256 of every file in the given build folders, one line per file in path order, in the format of
// `shasum -a 256` (so `shasum -a 256 -c` reads it). The build is reproducible: the same commit built with the same
// VITE_* variables gives the same lines, so two of these lists can be compared with diff.
//   node scripts/hashes.mjs dist [dist-vault dist-fetch]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('usage: node scripts/hashes.mjs <build folder>...');
  process.exit(2);
}
for (const dir of dirs) {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
  for (const f of files) console.log(`${createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')}  ${join(dir, f).split(sep).join('/')}`);
}
