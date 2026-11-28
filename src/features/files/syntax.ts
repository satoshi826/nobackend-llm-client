// Checking what a model writes for syntax errors, so it hears of a broken script or JSON file in the result of the
// write rather than when the page fails later. JSON is parsed here; JavaScript (a .js / .mjs file, the inline
// scripts of an HTML page) is parsed in the sandbox, as a <script> whose first statement throws, so none of it runs
// (the app's CSP compiles no code, and the browser reports a script's syntax error with its line and column).
import { runJavaScript } from '../../lib/sandbox/client';
import { extOf } from '../../lib/paths';

export interface SyntaxProblem {
  /** 1-based, in the file; absent when the place is not known (JSON nested too deep for the scanner) */
  line?: number;
  col?: number;
  message: string;
  /** In an inline script of an HTML page */
  inline?: boolean;
}

/** A script to parse: its text, as a module or not, and where it starts in the file (1-based) */
export interface Script {
  code: string;
  module: boolean;
  line: number;
  col: number;
}

/** What parsing a script found: null when it parsed, else the error and where it is in the script (1-based) */
export type Parsed = { message: string; line: number; col: number } | null;

/** Parses scripts in the sandbox, in order (the inline scripts of a page share its globals, as on the page) */
export type ParseScripts = (scripts: Script[]) => Promise<Parsed[]>;

/** Characters after the start of `text` up to `at`, as a line and column (1-based) */
function lineCol(text: string, at: number): { line: number; col: number } {
  const before = text.slice(0, at);
  const nl = before.lastIndexOf('\n');
  return { line: before.split('\n').length, col: at - nl };
}

/**
 * Where JSON text goes wrong, and how: JSON.parse says so in a different way in every browser, often without a
 * place (V8 then quotes the whole text), so a small scanner finds the first error once JSON.parse has refused it
 */
function jsonErrorAt(text: string): { at: number; message: string } | undefined {
  let i = 0;
  const fail = (message: string): never => {
    throw { at: i, message };
  };
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const literal = /true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const string = () => {
    for (i++; i < text.length; i++) {
      const c = text[i];
      if (c === '"') return void i++;
      if (c === '\\') {
        if (!/^(["\\/bfnrt]|u[0-9a-fA-F]{4})/.test(text.slice(i + 1, i + 6))) fail('Bad escape in a string');
        i += text[i + 1] === 'u' ? 5 : 1;
      } else if (c < ' ') fail('Line break or control character in a string');
    }
    fail('Unterminated string');
  };
  const items = (close: string, item: () => void) => {
    i++;
    ws();
    if (text[i] === close) return void i++;
    for (;;) {
      item();
      ws();
      if (text[i] === close) return void i++;
      if (text[i] !== ',') fail(`Expected ',' or '${close}'`);
      i++;
    }
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === '{')
      return items('}', () => {
        ws();
        if (text[i] !== '"') fail('Expected a property name in double quotes');
        string();
        ws();
        if (text[i] !== ':') fail("Expected ':' after a property name");
        i++;
        value();
      });
    if (c === '[') return items(']', value);
    if (c === '"') return string();
    literal.lastIndex = i;
    const m = literal.exec(text);
    if (m) return void (i += m[0].length);
    fail(i >= text.length ? 'Unexpected end of the text' : `Unexpected ${JSON.stringify(c)}`);
  };
  try {
    value();
    ws();
    if (i < text.length) fail('Unexpected text after the JSON value');
  } catch (e) {
    // Nesting too deep for the scanner: JSON.parse's own message, without a place
    return e instanceof Error ? undefined : (e as { at: number; message: string });
  }
  return undefined;
}

/** The first error in JSON text, with its line and column */
export function jsonProblem(text: string): SyntaxProblem | undefined {
  try {
    JSON.parse(text);
    return undefined;
  } catch (e) {
    const found = jsonErrorAt(text);
    return found ? { ...lineCol(text, found.at), message: found.message } : { message: String((e as Error).message).slice(0, 200) };
  }
}

/** Script types a browser runs as JavaScript (no type is one) */
const JS_TYPES = /^((text|application)\/(x-)?(java|ecma)script|text\/jscript|text\/livescript)$/i;

/** The inline scripts of an HTML page that the browser would run, with where their text starts */
export function inlineScripts(html: string): Script[] {
  const out: Script[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs) || !m[2].trim()) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? '';
    const module = type.toLowerCase() === 'module';
    if (!module && type && !JS_TYPES.test(type)) continue;
    out.push({ code: m[2], module, ...lineCol(html, m.index + m[0].indexOf('>') + 1) });
  }
  return out;
}

/** A position in a script as a position in its file */
const inFile = (s: Script, p: NonNullable<Parsed>) => (p.line === 1 ? { line: s.line, col: s.col + p.col - 1 } : { line: s.line + p.line - 1, col: p.col });

/**
 * The first syntax error in a file a model wrote, for the kinds checked (.json, .js, .mjs, .cjs, and the inline
 * scripts of .html); undefined when there is none, or the file is of another kind. A .js file may be loaded either
 * way: it is fine when it parses as a script or as a module (the error told is the module's when it has import or
 * export statements)
 */
export async function syntaxProblem(path: string, text: string, parse: ParseScripts): Promise<SyntaxProblem | undefined> {
  const ext = extOf(path);
  if (ext === 'json') return jsonProblem(text);
  const whole = { code: text, line: 1, col: 1 };
  if (ext === 'mjs') return first([{ ...whole, module: true }], await parse([{ ...whole, module: true }]));
  if (ext === 'js' || ext === 'cjs') {
    const [script, mod] = await parse([
      { ...whole, module: false },
      { ...whole, module: true }
    ]);
    if (!script || !mod) return undefined;
    const p = /^\s*(import|export)\b/m.test(text) ? mod : script;
    return { line: p.line, col: p.col, message: p.message };
  }
  if (ext === 'html' || ext === 'htm') {
    const scripts = inlineScripts(text);
    if (!scripts.length) return undefined;
    const found = first(scripts, await parse(scripts));
    return found && { ...found, inline: true };
  }
  return undefined;
}

function first(scripts: Script[], parsed: Parsed[]): SyntaxProblem | undefined {
  const i = parsed.findIndex(Boolean);
  return i < 0 ? undefined : { ...inFile(scripts[i], parsed[i]!), message: parsed[i]!.message };
}

/**
 * The sandbox side of parseInSandbox: each script goes in as a <script> whose first line throws, so it is parsed
 * whole and nothing of it runs (a module's imports are not fetched: the sandbox blocks every request). A syntax error
 * reaches the window's error event with its line and column; the throw of a script that parsed, or a module that
 * could not load what it imports, means it parsed
 */
const PARSE_CODE = `const scripts = JSON.parse(files.scripts);
const out = [];
for (const s of scripts) {
  out.push(await new Promise((resolve) => {
    const el = document.createElement('script');
    const done = (v) => { removeEventListener('error', onError, true); clearTimeout(timer); el.remove(); resolve(v); };
    const onError = (e) => {
      if (e.target !== window) return;
      e.preventDefault();
      const err = e.error;
      done(err && err.name === 'SyntaxError' ? { message: String(err.message).replace(/^Failed to execute '[^']*' on '[^']*': /, ''), line: Math.max(1, e.lineno - 1), col: e.lineno > 1 ? e.colno : 1 } : null);
    };
    addEventListener('error', onError, true);
    el.addEventListener('error', () => done(null));
    const timer = setTimeout(() => done(null), 2000);
    if (s.module) el.type = 'module';
    // A "use strict" directive stays first, so the script is parsed as strict as it is
    const strict = !s.module && /^(?:\\s+|\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)*(['"])use strict\\1/.test(s.code);
    el.textContent = (strict ? '"use strict";' : '') + 'throw "parsed";\\n' + s.code.replace(/^#![^\\n]*/, '');
    document.head.append(el);
  }));
}
return out;`;

/** Parse scripts in the sandbox (on its page, in a frame of its own); none found wrong when the sandbox does not answer */
export const parseInSandbox: ParseScripts = async (scripts) => {
  try {
    const r = await runJavaScript(PARSE_CODE, { dom: true, files: { scripts: JSON.stringify(scripts) } });
    const parsed = JSON.parse(r.result ?? '') as unknown;
    if (Array.isArray(parsed) && parsed.length === scripts.length) return parsed.map(cleanParsed);
  } catch {
    // Told as no problem: the check is a help, and the file is saved either way
  }
  return scripts.map(() => null);
};

/** A result from the sandbox, in its own shape only */
function cleanParsed(v: unknown): Parsed {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  return typeof p.message === 'string' && Number.isInteger(p.line) && Number.isInteger(p.col) ? { message: p.message.slice(0, 300), line: p.line as number, col: p.col as number } : null;
}
