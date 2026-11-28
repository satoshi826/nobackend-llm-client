// What edit_file tells the model about an edit: the lines it changed, as a short diff, so a leftover line or a change
// in the wrong place shows without reading the file again; and where text that differs only in whitespace is, when
// old_string is not in the file.

/** Lines of unchanged text shown around each change */
const CONTEXT = 3;
/** Lines of the view at most, and characters of one line in it */
const VIEW_LINES = 40;
const LINE_CHARS = 300;
/** Lines of a near match given back at most */
const NEAR_LINES = 30;

/** Where each line starts */
function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

/** The line (0-based) that holds character `pos` */
function lineAt(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** One change, in lines (0-based, end exclusive): before[o0, o1) became after[n0, n1) */
interface Change {
  o0: number;
  o1: number;
  n0: number;
  n1: number;
}

const cut = (s: string) => (s.length > LINE_CHARS ? `${s.slice(0, LINE_CHARS)}…` : s);

/**
 * The lines an edit changed: each replacement of `oldLen` characters at `at` (positions in `before`, in order) by
 * `newLen` characters, as '-' lines removed and '+' lines added with their numbers in the new text, CONTEXT lines
 * around, at most VIEW_LINES lines. Lines the replacement copied unchanged count as context. '' when nothing changed
 */
export function editView(before: string, after: string, at: number[], oldLen: number, newLen: number): string {
  const bs = lineStarts(before);
  const as = lineStarts(after);
  const bl = before.split('\n');
  const al = after.split('\n');
  // The whole lines each replacement touched; replacements on the same lines are one change
  const changes: Change[] = [];
  at.forEach((pos, k) => {
    const n = pos + k * (newLen - oldLen);
    const c = { o0: lineAt(bs, pos), o1: lineAt(bs, pos + oldLen) + 1, n0: lineAt(as, n), n1: lineAt(as, n + newLen) + 1 };
    const last = changes.at(-1);
    if (last && c.o0 < last.o1) Object.assign(last, { o1: c.o1, n1: c.n1 });
    else changes.push(c);
  });
  for (const c of changes) {
    while (c.o0 < c.o1 && c.n0 < c.n1 && bl[c.o0] === al[c.n0]) {
      c.o0++;
      c.n0++;
    }
    while (c.o1 > c.o0 && c.n1 > c.n0 && bl[c.o1 - 1] === al[c.n1 - 1]) {
      c.o1--;
      c.n1--;
    }
  }
  const real = changes.filter((c) => c.o0 < c.o1 || c.n0 < c.n1);
  if (!real.length) return '';
  const ctx = (from: number, to: number) => al.slice(Math.max(0, from), Math.min(al.length, to)).map((l, i) => ` ${String(Math.max(0, from) + i + 1).padStart(5)}\t${cut(l)}`);
  const out: string[] = [];
  let shown = 0;
  for (const [k, c] of real.entries()) {
    const prev = real[k - 1];
    // Changes whose context meets are shown as one, with the lines between them
    const lead = !prev ? ctx(c.n0 - CONTEXT, c.n0) : c.n0 - prev.n1 <= 2 * CONTEXT ? ctx(prev.n1, c.n0) : [...ctx(prev.n1, prev.n1 + CONTEXT), '…', ...ctx(c.n0 - CONTEXT, c.n0)];
    const lines = [...lead, ...bl.slice(c.o0, c.o1).map((l) => `-     \t${cut(l)}`), ...al.slice(c.n0, c.n1).map((l, i) => `+${String(c.n0 + i + 1).padStart(5)}\t${cut(l)}`)];
    // Whole changes only, but always the first
    if (out.length && out.length + lines.length > VIEW_LINES) break;
    out.push(...lines);
    shown++;
  }
  // Only the first change can be longer than the view: cut, without the context after it
  const long = out.length > VIEW_LINES;
  if (!long) out.push(...ctx(real[shown - 1].n1, real[shown - 1].n1 + CONTEXT));
  const rest = real.length - shown;
  const notes = [...(long ? ['the rest of this change'] : []), ...(rest ? [`${rest} more change${rest === 1 ? '' : 's'}`] : [])];
  return out.slice(0, long ? VIEW_LINES : undefined).join('\n') + (notes.length ? `\n[… ${notes.join(' and ')} not shown; check with read_file]` : '');
}

/**
 * Where text that matches `old` except for whitespace (spaces, indentation, line breaks) is in `text`: its lines
 * (1-based) and their text (at most NEAR_LINES), and how many places match so. null when none does
 */
export function nearMatch(text: string, old: string): { from: number; to: number; lines: string; count: number } | null {
  const want = old.replace(/\s+/g, '');
  if (!want) return null;
  // The text without whitespace, and where each of its characters was
  let bare = '';
  const where: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    bare += text[i];
    where.push(i);
  }
  const at = bare.indexOf(want);
  if (at < 0) return null;
  let count = 0;
  for (let i = at; i >= 0; i = bare.indexOf(want, i + want.length)) count++;
  const starts = lineStarts(text);
  const from = lineAt(starts, where[at]);
  const to = lineAt(starts, where[at + want.length - 1]);
  const lines = text
    .split('\n')
    .slice(from, Math.min(to + 1, from + NEAR_LINES))
    .map((l, i) => `${String(from + i + 1).padStart(6)}\t${cut(l)}`)
    .join('\n');
  return { from: from + 1, to: to + 1, lines, count };
}

/** The lines (1-based) where `old` starts in `text`, each once */
export function occurrenceLines(text: string, old: string): number[] {
  const starts = lineStarts(text);
  const out: number[] = [];
  for (let i = text.indexOf(old); i >= 0; i = text.indexOf(old, i + old.length)) {
    const line = lineAt(starts, i) + 1;
    if (out.at(-1) !== line) out.push(line);
  }
  return out;
}
