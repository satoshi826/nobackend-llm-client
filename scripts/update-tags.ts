// Rebuilds the Danbooru tag list for prompt autocomplete (src/features/media/image/tags/danbooru.txt) from a Danbooru list
// of DraconicDragon/dbr-e621-lists-archive (Unlicense), trimmed the same way: tags with at least 50 posts, artists
// with at least 500. Run by hand, never by the build:
//
//   npm run tags:update                  the newest list in the archive's tag-lists/danbooru (it commits one every
//                                        three months), downloaded from GitHub
//   npm run tags:update -- <file.csv>    a list downloaded by hand (the archive's monthly run leaves one as an artifact)
//
// Then check the counts it prints and commit the file.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUT = join(resolve(import.meta.dirname, '..'), 'src/features/media/image/tags/danbooru.txt');
const ARCHIVE = 'DraconicDragon/dbr-e621-lists-archive';
const FOLDER = 'tag-lists/danbooru';
/** The archive's file names: date, post threshold (pt), active (ia) and deleted (dd) aliases included */
const LIST_NAME = /^danbooru_(\d{4}-\d{2}-\d{2})_pt\d+-ia-dd\.csv$/;
const CATEGORIES: Record<string, string> = { 0: 'general', 1: 'artist', 3: 'copyright', 4: 'character', 5: 'meta' };
const ARTIST = '1';
const MIN_POSTS = 50;
const MIN_ARTIST_POSTS = 500;

/** The newest list's text, and its path in the archive */
async function newestList(): Promise<{ source: string; text: string }> {
  const res = await fetch(`https://api.github.com/repos/${ARCHIVE}/contents/${FOLDER}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`Listing ${ARCHIVE}/${FOLDER}: HTTP ${res.status}`);
  const files = ((await res.json()) as { name: string; download_url: string }[]).filter((f) => LIST_NAME.test(f.name));
  const newest = files.sort((a, b) => a.name.match(LIST_NAME)![1].localeCompare(b.name.match(LIST_NAME)![1])).at(-1);
  if (!newest) throw new Error(`No list named like ${LIST_NAME} in ${ARCHIVE}/${FOLDER}`);
  console.error(`Downloading ${newest.name}…`);
  const csv = await fetch(newest.download_url);
  if (!csv.ok) throw new Error(`Downloading ${newest.download_url}: HTTP ${csv.status}`);
  return { source: `${FOLDER}/${newest.name}`, text: await csv.text() };
}

/** The rows of a CSV file: fields split at commas, a field in double quotes may hold commas and doubled quotes */
function* csvRows(text: string): Generator<string[]> {
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') field += text[++i];
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      yield row;
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) yield [...row, field];
}

/** The list's lines (name, category, post count, aliases; tab-separated), in the source's order (most posts first) */
function trim(csv: string): string[] {
  const lines: string[] = [];
  for (const [i, row] of [...csvRows(csv)].entries()) {
    const [name, category, posts, aliases] = row;
    // A change in the source's format stops the update instead of writing a broken list
    if (row.length !== 4 || !name || !Object.hasOwn(CATEGORIES, category) || !/^\d+$/.test(posts) || row.some((f) => /[\t\n]/.test(f)))
      throw new Error(`Row ${i + 1} is not name,category,post count,aliases: ${JSON.stringify(row)}`);
    if (Number(posts) >= (category === ARTIST ? MIN_ARTIST_POSTS : MIN_POSTS)) lines.push([name, category, posts, aliases].join('\t'));
  }
  return lines;
}

const header = (source: string) => [
  '# Danbooru tags for prompt autocomplete: name<TAB>category<TAB>post count<TAB>aliases (comma-separated)',
  `# Categories: ${Object.entries(CATEGORIES).map(([n, c]) => `${n} ${c}`).join(', ')}`,
  `# Source: https://github.com/${ARCHIVE}, ${source}`,
  `# (downloaded ${new Date().toISOString().slice(0, 10)}), trimmed by scripts/update-tags.ts to tags with at least ${MIN_POSTS} posts (artists: ${MIN_ARTIST_POSTS}).`,
  '# The source is released under the Unlicense (public domain dedication): https://unlicense.org/'
];

/** The tags of the list's lines (header lines have no tab; a tag may start with #) */
const names = (lines: string[]) => new Set(lines.filter((l) => l.includes('\t')).map((l) => l.slice(0, l.indexOf('\t'))));

async function main() {
  const file = process.argv[2];
  const { source, text } = file ? { source: basename(file), text: readFileSync(file, 'utf8') } : await newestList();
  const lines = trim(text);
  const before = names(readFileSync(OUT, 'utf8').split('\n'));
  const after = names(lines);
  const out = [...header(source), ...lines, ''].join('\n');
  writeFileSync(OUT, out);
  const byCategory = Object.entries(CATEGORIES).map(([n, c]) => `${lines.filter((l) => l.split('\t')[1] === n).length} ${c}`);
  console.error(`${lines.length} tags (${byCategory.join(', ')}), ${[...after].filter((t) => !before.has(t)).length} new, ${[...before].filter((t) => !after.has(t)).length} gone`);
  console.error(`${(Buffer.byteLength(out) / 1e6).toFixed(1)} MB, ${Math.round(gzipSync(out).length / 1e3)} kB gzipped: ${OUT}`);
}

await main();
