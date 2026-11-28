// Runs a skill's script as Node would run it, as far as a browser worker can: CommonJS modules, process, console and
// fs/path/util over files held in memory. The build puts this file into the sandbox page's script (vite.config.ts); the
// page gives its source to a worker of its own for each run, so it must keep to one function and use only what a
// worker has. It must not contain a closing script tag. It changes no global: what a script sees as process, console
// and the timers are given to each module, as Node gives require and module.
//   nodeScript(job, compile, onPrint): job is { main, args, cwd, files, readOnly, libraries, libraryNames }:
//     main: the script's absolute path ('/skill/scripts/fill.js'); args: its arguments (strings); cwd: the directory
//     relative paths start from; files: { absolute path: text or Uint8Array }, the files it starts with; readOnly:
//     directories nothing may be written in ('/skill'); libraries: { name: source of a CommonJS module } that require
//     gives by name; libraryNames: every library the app could have given (to tell one not loaded from an unknown one).
//   compile(code) runs a classic script and returns the name its stack frames carry (a blob: URL in the worker).
//   onPrint(kind, text), if given, gets what it prints as it prints it ('stdout' or 'stderr', within OUT_MAX), so that
//   a run stopped before it ends still has its output.
//   Resolves to { code, stdout, stderr, stdoutChars, stderrChars, written }: the exit code, what it printed (each cut at
//   OUT_MAX; the *Chars say how much there was), and { absolute path: text or Uint8Array } of every file it wrote that
//   still exists. It ends as Node does: on process.exit, on an error nothing caught, or once no timer is left.
function nodeScript(job, compile, onPrint) {
  'use strict';
  const OUT_MAX = 1_000_000;
  const WRITE_MAX = 50 * 1024 * 1024;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const plainTimeout = setTimeout;
  let cwd = job.cwd;

  // ---- path (POSIX) ----
  const join2 = (parts, abs) => {
    const out = [];
    for (const s of parts.split('/')) {
      if (!s || s === '.') continue;
      if (s !== '..') out.push(s);
      else if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!abs) out.push('..');
    }
    return out.join('/');
  };
  const path = {
    sep: '/',
    delimiter: ':',
    isAbsolute: (p) => String(p).startsWith('/'),
    normalize(p) {
      p = String(p);
      const abs = p.startsWith('/');
      const r = join2(p, abs);
      return (abs ? '/' : '') + (r || (abs ? '' : '.')) + (r && p.endsWith('/') ? '/' : '');
    },
    join: (...ps) => path.normalize(ps.map(String).filter((x) => x).join('/') || '.'),
    resolve(...ps) {
      let r = '';
      for (let i = ps.length - 1; i >= 0 && !r.startsWith('/'); i--) if (ps[i]) r = String(ps[i]) + (r ? '/' + r : '');
      if (!r.startsWith('/')) r = cwd + '/' + r;
      return '/' + join2(r, true);
    },
    dirname(p) {
      p = String(p);
      const s = p.replace(/\/+$/, '');
      if (!s) return p.startsWith('/') ? '/' : '.';
      const i = s.lastIndexOf('/');
      return i < 0 ? '.' : i === 0 ? '/' : s.slice(0, i);
    },
    basename(p, ext) {
      const s = String(p).replace(/\/+$/, '');
      let b = s.slice(s.lastIndexOf('/') + 1);
      if (ext && b.endsWith(ext) && b !== ext) b = b.slice(0, -ext.length);
      return b;
    },
    extname(p) {
      const b = path.basename(p);
      const i = b.lastIndexOf('.');
      return i <= 0 ? '' : b.slice(i);
    },
    relative(from, to) {
      const a = path.resolve(from).split('/').filter(Boolean);
      const b = path.resolve(to).split('/').filter(Boolean);
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
    },
    parse(p) {
      p = String(p);
      const base = path.basename(p);
      const ext = path.extname(p);
      return { root: p.startsWith('/') ? '/' : '', dir: p.includes('/') ? path.dirname(p) : '', base, ext, name: ext ? base.slice(0, -ext.length) : base };
    },
    format(o) {
      const dir = o.dir || o.root || '';
      const base = o.base || (o.name || '') + (o.ext || '');
      return !dir ? base : dir.endsWith('/') ? dir + base : dir + '/' + base;
    },
    toNamespacedPath: (p) => p
  };
  path.posix = path;

  // ---- what it prints ----
  /** Each module's blob: URL, and its path: errors name the file and line of the script */
  const urls = new Map();
  // Frames of the worker, and those below the script's outermost one (this file running it), are left out
  const here = typeof location === 'object' ? String(location.href) : null;
  function stackOf(e) {
    let s = String((e && e.stack) || e);
    if (e instanceof Error && !s.includes(e.message)) s = `${e.name}: ${e.message}\n${s}`;
    for (const [url, name] of urls) s = s.split(url).join(name);
    const lines = s.split('\n').filter((l) => !here || !l.includes(here));
    const ours = (l) => [...urls.values()].some((name) => l.includes(name));
    while (lines.length > 1 && /^\s*at |@/.test(lines[lines.length - 1]) && !ours(lines[lines.length - 1])) lines.pop();
    return lines.join('\n');
  }
  const out = { stdout: '', stderr: '', stdoutChars: 0, stderrChars: 0 };
  const print = (kind, s) => {
    s = typeof s === 'string' ? s : ArrayBuffer.isView(s) ? dec.decode(s) : String(s);
    const kept = s.slice(0, OUT_MAX - out[kind].length);
    out[kind] += kept;
    out[kind + 'Chars'] += s.length;
    if (kept && onPrint) onPrint(kind, kept);
  };
  /** A value as Node's console shows it (shortened: no colours, nested objects two levels deep) */
  function inspect(v, depth = 2, seen = []) {
    if (typeof v === 'string') return seen.length ? `'${v.replace(/'/g, "\\'")}'` : v;
    if (typeof v === 'bigint') return v + 'n';
    if (typeof v === 'function') return `[Function: ${v.name || '(anonymous)'}]`;
    if (typeof v === 'symbol') return v.toString();
    if (v === null || typeof v !== 'object') return String(v);
    if (v instanceof Error) return stackOf(v);
    if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
    if (v instanceof RegExp) return String(v);
    if (seen.includes(v)) return '[Circular]';
    const inner = (x) => inspect(x, depth - 1, [...seen, v]);
    const wrap = (items, open, close) => (items.length ? `${open} ${items.join(', ')} ${close}` : open + close);
    if (Array.isArray(v)) return depth < 0 ? '[Array]' : wrap(v.map(inner), '[', ']');
    if (ArrayBuffer.isView(v)) return `${v.constructor.name}(${v.length}) [${Array.prototype.slice.call(v, 0, 50).join(', ')}${v.length > 50 ? ', ...' : ''}]`;
    if (v instanceof Map) return depth < 0 ? '[Map]' : wrap([...v].map(([k, x]) => `${inner(k)} => ${inner(x)}`), `Map(${v.size}) {`, '}');
    if (v instanceof Set) return depth < 0 ? '[Set]' : wrap([...v].map(inner), `Set(${v.size}) {`, '}');
    if (depth < 0) return '[Object]';
    const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`);
    return wrap(Object.keys(v).map((k) => `${key(k)}: ${inner(v[k])}`), '{', '}');
  }
  /** util.format: printf-like %s %d %i %f %j %o %O, then the rest of the values */
  function format(...args) {
    let first = args.length && typeof args[0] === 'string' ? args.shift() : '';
    if (first) {
      first = first.replace(/%([sdifjoO%])/g, (m, c) => {
        if (c === '%') return '%';
        if (!args.length) return m;
        const a = args.shift();
        if (c === 's') return typeof a === 'string' ? a : inspect(a, 1);
        if (c === 'd' || c === 'i') return String(c === 'i' ? parseInt(a) : Number(a));
        if (c === 'f') return String(parseFloat(a));
        if (c === 'j') return JSON.stringify(a);
        return inspect(a, 4);
      });
    }
    return [...(first || !args.length ? [first] : []), ...args.map((a) => inspect(a))].join(' ');
  }
  const timersOf = new Map();
  const console = {
    log: (...a) => print('stdout', format(...a) + '\n'),
    error: (...a) => print('stderr', format(...a) + '\n'),
    dir: (v) => print('stdout', inspect(v) + '\n'),
    table: (v) => print('stdout', inspect(v) + '\n'),
    trace: (...a) => print('stderr', 'Trace: ' + format(...a) + '\n'),
    assert: (ok, ...a) => ok || print('stderr', 'Assertion failed' + (a.length ? ': ' + format(...a) : '') + '\n'),
    time: (label = 'default') => timersOf.set(label, performance.now()),
    timeEnd: (label = 'default') => print('stdout', `${label}: ${(performance.now() - (timersOf.get(label) ?? performance.now())).toFixed(3)}ms\n`)
  };
  console.info = console.debug = console.log;
  console.warn = console.error;

  // ---- files ----
  const files = new Map(Object.entries(job.files));
  const dirs = new Set(['/']);
  const addDirs = (p) => {
    for (let d = path.dirname(p); !dirs.has(d); d = path.dirname(d)) dirs.add(d);
  };
  for (const p of files.keys()) addDirs(p);
  dirs.add(cwd);
  addDirs(cwd);
  const written = new Set();
  let writtenBytes = 0;
  const MESSAGES = {
    ENOENT: 'no such file or directory',
    EISDIR: 'illegal operation on a directory',
    ENOTDIR: 'not a directory',
    EROFS: 'read-only file system',
    EEXIST: 'file already exists',
    ENOSPC: 'no space left on device',
    ENOTEMPTY: 'directory not empty'
  };
  const fail = (code, syscall, p) => {
    const e = new Error(`${code}: ${MESSAGES[code]}, ${syscall} '${p}'`);
    Object.assign(e, { code, syscall, path: p });
    throw e;
  };
  const abs = (p) => path.resolve(p instanceof URL ? decodeURIComponent(p.pathname) : String(p));
  const readOnly = (p) => job.readOnly.some((r) => p === r || p.startsWith(r + '/'));
  const encodingOf = (o) => (typeof o === 'string' ? o : (o && o.encoding) || null);
  const utf8 = (e) => /^utf-?8$/i.test(e);
  /** A file's bytes as readFileSync gives them: a Uint8Array whose toString() decodes it, as a Buffer's does */
  class FileBytes extends Uint8Array {
    toString(e = 'utf8') {
      if (e === 'base64') return btoa(Array.from(this, (b) => String.fromCharCode(b)).join(''));
      if (e === 'hex') return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
      if (e === 'latin1' || e === 'binary') return Array.from(this, (b) => String.fromCharCode(b)).join('');
      return dec.decode(this);
    }
  }
  const bytesOf = (v) => new FileBytes(typeof v === 'string' ? enc.encode(v) : v);
  /** Data given to a write, kept as text or bytes */
  const dataOf = (data, e) => {
    if (typeof data === 'string') {
      if (e === 'base64') return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      if (e === 'hex') return Uint8Array.from(data.match(/../g) || [], (h) => parseInt(h, 16));
      return data;
    }
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    return String(data);
  };
  const sizeOf = (v) => (typeof v === 'string' ? enc.encode(v).length : v.length);
  function put(a, v, syscall) {
    if (readOnly(a)) fail('EROFS', syscall, a);
    if (dirs.has(a)) fail('EISDIR', syscall, a);
    if (!dirs.has(path.dirname(a))) fail(files.has(path.dirname(a)) ? 'ENOTDIR' : 'ENOENT', syscall, a);
    writtenBytes += v.length;
    if (writtenBytes > WRITE_MAX) fail('ENOSPC', syscall, a);
    files.set(a, v);
    written.add(a);
  }
  const isFile = (a) => files.has(a);
  const stats = (a) => {
    const dir = dirs.has(a);
    const now = new Date();
    return { size: dir ? 0 : sizeOf(files.get(a)), mode: dir ? 0o40755 : 0o100644, mtime: now, ctime: now, birthtime: now, mtimeMs: +now, isFile: () => !dir, isDirectory: () => dir, isSymbolicLink: () => false };
  };
  const fs = {
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },
    existsSync(p) {
      try {
        const a = abs(p);
        return isFile(a) || dirs.has(a);
      } catch {
        return false;
      }
    },
    accessSync(p) {
      const a = abs(p);
      if (!isFile(a) && !dirs.has(a)) fail('ENOENT', 'access', a);
    },
    readFileSync(p, o) {
      const a = abs(p);
      if (dirs.has(a)) fail('EISDIR', 'read', a);
      if (!isFile(a)) fail('ENOENT', 'open', a);
      const v = files.get(a);
      const e = encodingOf(o);
      if (!e) return bytesOf(v);
      return typeof v === 'string' && utf8(e) ? v : bytesOf(v).toString(e);
    },
    writeFileSync(p, data, o) {
      const a = abs(p);
      if (o && o.flag && o.flag.startsWith('a')) return fs.appendFileSync(a, data, o);
      put(a, dataOf(data, encodingOf(o)), 'open');
    },
    appendFileSync(p, data, o) {
      const a = abs(p);
      const add = dataOf(data, encodingOf(o));
      const had = files.get(a);
      if (had === undefined) return put(a, add, 'open');
      if (typeof had === 'string' && typeof add === 'string') return put(a, had + add, 'open');
      const x = bytesOf(had);
      const y = bytesOf(add);
      const both = new Uint8Array(x.length + y.length);
      both.set(x);
      both.set(y, x.length);
      put(a, both, 'open');
    },
    mkdirSync(p, o) {
      const a = abs(p);
      const recursive = !!(o && o.recursive);
      if (dirs.has(a)) return recursive ? undefined : fail('EEXIST', 'mkdir', a);
      if (isFile(a)) fail('EEXIST', 'mkdir', a);
      if (readOnly(a)) fail('EROFS', 'mkdir', a);
      const parent = path.dirname(a);
      if (!dirs.has(parent)) {
        if (!recursive) fail('ENOENT', 'mkdir', a);
        fs.mkdirSync(parent, o);
      }
      dirs.add(a);
      return recursive ? a : undefined;
    },
    readdirSync(p, o) {
      const a = abs(p);
      if (isFile(a)) fail('ENOTDIR', 'scandir', a);
      if (!dirs.has(a)) fail('ENOENT', 'scandir', a);
      const names = [...new Set([...files.keys(), ...dirs].filter((x) => x !== a && path.dirname(x) === a).map((x) => path.basename(x)))].sort();
      if (!(o && o.withFileTypes)) return names;
      return names.map((name) => {
        const dir = dirs.has(path.join(a, name));
        return { name, path: a, parentPath: a, isFile: () => !dir, isDirectory: () => dir, isSymbolicLink: () => false };
      });
    },
    statSync(p, o) {
      const a = abs(p);
      if (isFile(a) || dirs.has(a)) return stats(a);
      if (o && o.throwIfNoEntry === false) return undefined;
      fail('ENOENT', 'stat', a);
    },
    unlinkSync(p) {
      const a = abs(p);
      if (readOnly(a)) fail('EROFS', 'unlink', a);
      if (dirs.has(a)) fail('EISDIR', 'unlink', a);
      if (!isFile(a)) fail('ENOENT', 'unlink', a);
      files.delete(a);
      written.delete(a);
    },
    rmSync(p, o) {
      const a = abs(p);
      if (isFile(a)) return fs.unlinkSync(a);
      if (!dirs.has(a)) return o && o.force ? undefined : fail('ENOENT', 'rm', a);
      if (readOnly(a)) fail('EROFS', 'rm', a);
      const inside = (x) => x.startsWith(a + '/');
      if (!(o && o.recursive)) fail('EISDIR', 'rm', a);
      for (const x of [...files.keys()].filter(inside)) fs.unlinkSync(x);
      for (const x of [...dirs].filter(inside)) dirs.delete(x);
      dirs.delete(a);
    },
    copyFileSync(from, to) {
      const a = abs(from);
      if (!isFile(a)) fail('ENOENT', 'copyfile', a);
      const v = files.get(a);
      put(abs(to), typeof v === 'string' ? v : v.slice(), 'copyfile');
    },
    renameSync(from, to) {
      const a = abs(from);
      if (!isFile(a)) fail('ENOENT', 'rename', a);
      if (readOnly(a)) fail('EROFS', 'rename', a);
      put(abs(to), files.get(a), 'rename');
      fs.unlinkSync(a);
    }
  };
  fs.lstatSync = fs.statSync;
  fs.rmdirSync = (p, o) => fs.rmSync(p, { ...o, recursive: !!(o && o.recursive) || fs.readdirSync(p).length === 0 });
  // The callback and promise forms, over the same calls (their results come after the current code, as in Node)
  const promised = {};
  for (const name of ['access', 'readFile', 'writeFile', 'appendFile', 'mkdir', 'readdir', 'stat', 'lstat', 'unlink', 'rm', 'rmdir', 'copyFile', 'rename']) {
    const sync = fs[name + 'Sync'];
    promised[name] = (...a) => new Promise((resolve) => resolve(sync(...a)));
    fs[name] = (...a) => {
      const cb = typeof a[a.length - 1] === 'function' ? a.pop() : () => {};
      promised[name](...a).then((v) => cb(null, v), (e) => cb(e));
    };
  }
  fs.exists = (p, cb) => Promise.resolve().then(() => cb(fs.existsSync(p)));
  fs.promises = promised;

  // ---- process, timers, the end of the run ----
  class Exit {
    constructor(code) {
      this.code = code;
    }
  }
  const noop = function () {
    return process;
  };
  const process = {
    argv: ['node', job.main, ...job.args],
    argv0: 'node',
    execArgv: [],
    execPath: '/usr/local/bin/node',
    env: {},
    platform: 'linux',
    arch: 'x64',
    version: 'v20.0.0',
    versions: { node: '20.0.0' },
    pid: 1,
    exitCode: undefined,
    cwd: () => cwd,
    chdir(d) {
      const a = abs(d);
      if (!dirs.has(a)) fail('ENOENT', 'chdir', a);
      cwd = a;
    },
    exit(code) {
      throw new Exit(Number(code ?? process.exitCode ?? 0) || 0);
    },
    stdout: { write: (s) => (print('stdout', s), true), isTTY: false, columns: 80 },
    stderr: { write: (s) => (print('stderr', s), true), isTTY: false, columns: 80 },
    nextTick: (fn, ...a) => queueMicrotask(() => fn(...a)),
    hrtime: Object.assign((prev) => {
      const ns = Math.round(performance.now() * 1e6);
      const t = [Math.floor(ns / 1e9), ns % 1e9];
      return prev ? [t[0] - prev[0], t[1] - prev[1]] : t;
    }, { bigint: () => BigInt(Math.round(performance.now() * 1e6)) }),
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0 }),
    uptime: () => performance.now() / 1000,
    on: noop,
    once: noop,
    off: noop,
    removeListener: noop,
    emit: () => false
  };

  return new Promise((resolve) => {
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      const kept = {};
      for (const a of written) if (files.has(a)) kept[a] = files.get(a);
      resolve({ code, ...out, written: kept });
    };
    /** What ends a run: process.exit, or an error nothing caught (printed as Node prints it, exit code 1) */
    const crash = (e) => {
      if (e instanceof Exit) return finish(e.code);
      print('stderr', (e instanceof Error ? stackOf(e) : 'Uncaught ' + inspect(e, 2, [{}])) + '\n');
      finish(1);
    };
    // Timers the script has pending: the run ends once none is left
    const pending = new Map();
    let lastTimer = 0;
    const timer = (fn, ms, args, repeat) => {
      const id = ++lastTimer;
      const tick = () => {
        if (done || !pending.has(id)) return;
        if (repeat) pending.set(id, plainTimeout(tick, Math.max(1, Number(ms) || 0)));
        else pending.delete(id);
        try {
          if (typeof fn === 'function') fn(...args);
        } catch (e) {
          crash(e);
        }
      };
      pending.set(id, plainTimeout(tick, Number(ms) || 0));
      return id;
    };
    const clear = (id) => {
      clearTimeout(pending.get(id));
      pending.delete(id);
    };
    const timers = {
      setTimeout: (fn, ms, ...a) => timer(fn, ms, a, false),
      setInterval: (fn, ms, ...a) => timer(fn, ms, a, true),
      setImmediate: (fn, ...a) => timer(fn, 0, a, false),
      clearTimeout: clear,
      clearInterval: clear,
      clearImmediate: clear
    };
    if (typeof addEventListener === 'function')
      addEventListener('unhandledrejection', (e) => {
        e.preventDefault();
        crash(e.reason);
      });

    // ---- modules ----
    const cache = new Map();
    const util = {
      format,
      inspect: (v, o) => inspect(v, o && o.depth != null ? o.depth : 2, [{}]),
      promisify: (fn) => (...a) => new Promise((ok, no) => fn(...a, (e, v) => (e ? no(e) : ok(v)))),
      inherits: (ctor, base) => Object.setPrototypeOf(ctor.prototype, base.prototype),
      deprecate: (fn) => fn,
      TextEncoder,
      TextDecoder
    };
    const builtins = { fs, 'fs/promises': fs.promises, path, 'path/posix': path, util, process, timers };
    const notFound = (id) => {
      const libs = Object.keys(job.libraries);
      const e = new Error(
        `Cannot find module '${id}'. A script here can require fs, path, util${libs.length ? ', ' + libs.join(', ') : ''} and its skill's own .js and .json files by a relative path: this is not Node, and no other package is installed.`
      );
      e.code = 'MODULE_NOT_FOUND';
      return e;
    };
    function resolveFile(id, from) {
      const a = path.resolve(from, id);
      for (const c of [a, a + '.js', a + '.cjs', a + '.json', a + '/index.js', a + '/index.json']) if (isFile(c)) return c;
      throw notFound(id);
    }
    function requireFrom(dir) {
      const req = (id) => {
        id = String(id);
        const name = id.replace(/^node:/, '');
        if (Object.hasOwn(builtins, name)) return builtins[name];
        if (/^\.{0,2}(\/|$)/.test(id)) return load(resolveFile(id, dir));
        if (Object.hasOwn(job.libraries, id)) return load('/node_modules/' + id + '/index.js', job.libraries[id]);
        if (job.libraryNames.includes(id))
          throw new Error(`The library '${id}' was not loaded: libraries are loaded before a script runs, for each require('${id}') written with the name in quotes in the script or a file it requires.`);
        throw notFound(id);
      };
      req.resolve = (id) => resolveFile(id, dir);
      req.cache = {};
      return req;
    }
    function load(file, source) {
      const had = cache.get(file);
      if (had) return had.exports;
      const module = { id: file, filename: file, path: path.dirname(file), exports: {}, loaded: false, children: [], paths: [] };
      cache.set(file, module);
      const raw = source ?? files.get(file);
      const text = typeof raw === 'string' ? raw : dec.decode(raw);
      if (file.endsWith('.json')) {
        try {
          module.exports = JSON.parse(text);
        } catch (e) {
          e.message = file + ': ' + e.message;
          throw e;
        }
      } else if (file.endsWith('.mjs')) {
        throw new Error(`${file} is an ES module (.mjs): only CommonJS scripts run here (require and module.exports, not import and export).`);
      } else {
        // On the first line, so every line of the file keeps its number in stack traces. A #! line stays as a comment
        const code = 'nodeModule((function (exports, require, module, __filename, __dirname, process, console, global, setTimeout, setInterval, setImmediate, clearTimeout, clearInterval, clearImmediate) {' + text.replace(/^#!/, '//') + '\n}));';
        let fn;
        globalThis.nodeModule = (f) => (fn = f);
        try {
          urls.set(compile(code), file);
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
          // Told with the file it is in (the browser's message names importScripts); its stack would show only this file
          const esm = /^\s*(import|export)\s/m.test(text) ? ': it is written as an ES module; only CommonJS scripts run here (require and module.exports, not import and export)' : '';
          const err = new SyntaxError(`${e.message.replace(/^Failed to execute 'importScripts' on 'WorkerGlobalScope': /, '')} (in ${file}${esm})`);
          err.stack = `SyntaxError: ${err.message}`;
          throw err;
        } finally {
          delete globalThis.nodeModule;
        }
        const t = timers;
        fn.call(module.exports, module.exports, requireFrom(module.path), module, file, module.path, process, console, globalThis, t.setTimeout, t.setInterval, t.setImmediate, t.clearTimeout, t.clearInterval, t.clearImmediate);
      }
      module.loaded = true;
      return module.exports;
    }

    try {
      load(job.main);
    } catch (e) {
      return crash(e);
    }
    // Node ends once nothing is left to do: here, once the promises have settled and no timer is pending
    const idle = () => {
      if (done) return;
      if (pending.size) return plainTimeout(idle, 5);
      finish(process.exitCode ?? 0);
    };
    plainTimeout(idle, 0);
  });
}
