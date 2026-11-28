import { describe, expect, it } from 'vitest';
import { inlineScripts, jsonProblem, syntaxProblem, type Parsed, type ParseScripts, type Script } from './syntax';

/** Stands in for the sandbox: a script containing "oops" fails at the "oops" (positions in the script, 1-based) */
const fake: ParseScripts = async (scripts) =>
  scripts.map((s): Parsed => {
    // A module may use import / export; a script may not
    if (!s.module && /^\s*(import|export)\b/m.test(s.code)) return { message: 'Cannot use import statement outside a module', line: 1, col: 1 };
    const at = s.code.indexOf('oops');
    if (at < 0) return null;
    const before = s.code.slice(0, at).split('\n');
    return { message: "Unexpected identifier 'oops'", line: before.length, col: before.at(-1)!.length + 1 };
  });

describe('syntax check on write', () => {
  it('reads the line and column from JSON.parse', () => {
    expect(jsonProblem('{"a": 1}')).toBeUndefined();
    expect(jsonProblem('{\n  "a": 1,\n  "b": }')).toEqual({ line: 3, col: 8, message: 'Unexpected "}"' });
    expect(jsonProblem('{"a": 1 "b": 2}')).toEqual({ line: 1, col: 9, message: "Expected ',' or '}'" });
    expect(jsonProblem("{'a': 1}")).toMatchObject({ line: 1, col: 2, message: 'Expected a property name in double quotes' });
    expect(jsonProblem('["a\\x"]')).toMatchObject({ col: 4, message: 'Bad escape in a string' });
    expect(jsonProblem('[1] 2')).toMatchObject({ col: 5, message: 'Unexpected text after the JSON value' });
    expect(jsonProblem('{"a": [1, 2')).toMatchObject({ col: 12, message: "Expected ',' or ']'" });
    expect(jsonProblem('')).toMatchObject({ col: 1, message: 'Unexpected end of the text' });
  });
  it('finds the inline scripts a browser runs, and where they start', () => {
    const html = '<!doctype html>\n<p>x</p><script>a()</script>\n<script type="module">\nb()\n</script>\n<script src="x.js"></script><script type="application/json">{}</script><script type="text/javascript">c()</script>';
    expect(inlineScripts(html).map(({ module, line, col }) => ({ module, line, col }))).toEqual([
      { module: false, line: 2, col: 17 },
      { module: true, line: 3, col: 23 },
      { module: false, line: 6, col: 103 }
    ] satisfies Partial<Script>[]);
  });
  it('gives the first error with its place in the file', async () => {
    expect(await syntaxProblem('a.js', 'let a = 1;\nlet b = oops;', fake)).toEqual({ line: 2, col: 9, message: "Unexpected identifier 'oops'" });
    expect(await syntaxProblem('a.js', 'let a = 1;', fake)).toBeUndefined();
    // A .js file may be a module: fine either way, and told as a module when it imports
    expect(await syntaxProblem('a.js', "import x from './x.js';\nx();", fake)).toBeUndefined();
    expect(await syntaxProblem('a.js', "import x from './x.js';\noops", fake)).toMatchObject({ line: 2, col: 1 });
    expect(await syntaxProblem('a.mjs', 'export const a = oops;', fake)).toMatchObject({ line: 1, col: 18 });
    // In a page: lines and columns of the page, the first script that fails
    const page = '<html>\n<script>ok()</script>\n<script>  oops</script>\n<script>\n\noops</script>';
    expect(await syntaxProblem('index.html', page, fake)).toEqual({ line: 3, col: 11, message: "Unexpected identifier 'oops'", inline: true });
    expect(await syntaxProblem('data.json', '[1,]', fake)).toMatchObject({ line: 1, col: 4 });
    expect(await syntaxProblem('notes.md', 'oops', fake)).toBeUndefined();
  });
});
