// Reading a text with line numbers, a page at a time, as the read tools give it to the model (read_file,
// read_skill_file): the numbered lines, and a note on where to go on

/** Lines returned by one read at most, and characters (a line is given whole unless it alone is longer) */
export const READ_LINES = 2000;
export const READ_CHUNK = 20_000;

const count = (k: number) => (k === 1 ? '1 line' : `${k} lines`);

/**
 * The lines of `text` from `offset` (1-based), at most `limit` of them and READ_CHUNK characters, each numbered; note
 * says which lines these are and where to continue, or that the text ends. past: offset is after the last line (what to
 * tell the model instead)
 */
export function readLines(text: string, offset: number, limit: number, name: string): { lines: string; note: string } | { past: string } {
  const all = text.split('\n');
  if (offset > all.length) return { past: `offset=${offset} is past the end of ${name}, which has ${count(all.length)}.` };
  const out: string[] = [];
  let chars = 0;
  let n = offset;
  // Only a line longer than a whole read is cut (it is then the only line of the read)
  let cut = '';
  for (; n <= all.length && n < offset + limit; n++) {
    const line = all[n - 1];
    const numbered = `${String(n).padStart(6)}\t${line.length > READ_CHUNK ? `${line.slice(0, READ_CHUNK)}…` : line}`;
    if (out.length && chars + numbered.length > READ_CHUNK) break;
    if (line.length > READ_CHUNK) cut = `\n[line ${n} is cut at ${READ_CHUNK} of its ${line.length} characters]`;
    out.push(numbered);
    chars += numbered.length + 1;
  }
  const note = cut + (n <= all.length ? `\n[lines ${offset}-${n - 1} of ${all.length}; continue with offset=${n}]` : `\n[end of file; ${count(all.length)}]`);
  return { lines: out.join('\n'), note };
}
