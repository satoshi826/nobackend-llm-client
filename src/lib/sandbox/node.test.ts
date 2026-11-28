import { runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
// The file as the build puts it into the sandbox page's script: a plain script that declares nodeScript
import source from '../../../sandbox/node.js?raw';

interface Result {
  code: number;
  stdout: string;
  stderr: string;
  stdoutChars: number;
  stderrChars: number;
  written: Record<string, string | Uint8Array>;
}
const nodeScript = new Function(`${source}\nreturn nodeScript;`)() as (job: unknown, compile: (code: string) => string, onPrint?: (kind: string, text: string) => void) => Promise<Result>;

// As the worker does: each module is a script of its own, named by a URL its stack frames carry
let n = 0;
const compile = (code: string) => {
  const url = `blob:null/test-${++n}`;
  runInThisContext(code, { filename: url });
  return url;
};

const run = (files: Record<string, string | Uint8Array>, o: { main?: string; args?: string[]; libraries?: Record<string, string>; libraryNames?: string[]; onPrint?: (kind: string, text: string) => void } = {}) =>
  nodeScript(
    {
      main: o.main ?? '/skill/scripts/main.js',
      args: o.args ?? [],
      cwd: '/work',
      files,
      readOnly: ['/skill'],
      libraries: o.libraries ?? {},
      libraryNames: o.libraryNames ?? Object.keys(o.libraries ?? {})
    },
    compile,
    o.onPrint
  );

describe('a skill script in the Node-like shim', () => {
  it('gets argv, __dirname, its skill files to read, and writes files that come back', async () => {
    const r = await run(
      {
        '/skill/scripts/main.js': `const fs = require('fs');
const path = require('node:path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../reference/data.json'), 'utf8'));
console.log('argv', process.argv.slice(1));
console.log('%s has %d items', data.name, data.items.length, { nested: ['x'] });
fs.mkdirSync('out/deep', { recursive: true });
fs.writeFileSync('out/deep/hello.txt', 'Hello ' + process.argv[2]);
fs.writeFileSync('/work/bytes.bin', new Uint8Array([0, 1, 2]));
fs.appendFileSync('log.txt', 'a');
fs.appendFileSync('log.txt', 'b');
console.log(fs.readdirSync('.'), fs.statSync('out').isDirectory(), fs.existsSync('nope'));
process.stderr.write('warned\\n');`,
        '/skill/reference/data.json': '{"name":"list","items":[1,2,3]}',
        '/work/input.csv': 'a,b'
      },
      { args: ['world'] }
    );
    expect(r.stderr).toBe('warned\n');
    expect(r.stdout).toBe(
      "argv [ '/skill/scripts/main.js', 'world' ]\nlist has 3 items { nested: [ 'x' ] }\n[ 'bytes.bin', 'input.csv', 'log.txt', 'out' ] true false\n"
    );
    expect(r.code).toBe(0);
    expect(r.written).toEqual({ '/work/out/deep/hello.txt': 'Hello world', '/work/bytes.bin': new Uint8Array([0, 1, 2]), '/work/log.txt': 'ab' });
  });

  it('reads bytes as a Buffer-like Uint8Array, and refuses to write in the skill', async () => {
    const r = await run({
      '/skill/scripts/main.js': `const fs = require('fs');
const b = fs.readFileSync('/skill/assets/x.bin');
console.log(b.length, b.toString('hex'), fs.readFileSync('/skill/scripts/main.js').toString().length > 10);
try { fs.writeFileSync(__filename, 'x'); } catch (e) { console.log(e.code, e.message); }
try { fs.readFileSync('missing.txt'); } catch (e) { console.log(e.code, e.message); }`,
      '/skill/assets/x.bin': new Uint8Array([255, 0, 16])
    });
    expect(r.stdout).toBe(
      "3 ff0010 true\nEROFS EROFS: read-only file system, open '/skill/scripts/main.js'\nENOENT ENOENT: no such file or directory, open '/work/missing.txt'\n"
    );
    expect(r.written).toEqual({});
  });

  it('requires the skill\'s own modules by relative path (CommonJS, JSON, a cycle), once each', async () => {
    const r = await run({
      '/skill/scripts/main.js': `const a = require('./lib/a');
const again = require('./lib/a.js');
console.log(a.name, a.fromB, a === again, require('../reference/data.json').n, require.resolve('./lib/b'));`,
      '/skill/scripts/lib/a.js': `exports.name = 'a'; exports.fromB = require('./b').value;`,
      '/skill/scripts/lib/b.js': `const a = require('./a'); module.exports = { value: 'b sees a.name=' + a.name };`,
      '/skill/reference/data.json': '{"n": 7}'
    });
    expect(r.stdout).toBe('a b sees a.name=a true 7 /skill/scripts/lib/b.js\n');
  });

  it('ends with process.exit, process.exitCode, or once its timers and promises are done', async () => {
    const exited = await run({ '/skill/scripts/main.js': `console.log('before'); process.exit(3); console.log('after');` });
    expect(exited).toMatchObject({ code: 3, stdout: 'before\n' });
    const later = await run({
      '/skill/scripts/main.js': `async function main() {
  await new Promise((r) => setTimeout(r, 20));
  const text = await require('fs').promises.readFile('/skill/scripts/main.js', 'utf8');
  console.log('waited', text.length > 0);
  const t = setInterval(() => { console.log('tick'); clearInterval(t); process.exitCode = 4; }, 5);
}
main();`
    });
    expect(later).toMatchObject({ code: 4, stdout: 'waited true\ntick\n' });
    const inTimer = await run({ '/skill/scripts/main.js': `setTimeout(() => process.exit(5), 5);` });
    expect(inTimer.code).toBe(5);
  });

  it('prints an error nothing caught with its stack at the script\'s own file and line, exit code 1', async () => {
    const r = await run({
      '/skill/scripts/main.js': `const helper = require('./helper');
console.log('start');
helper.fail();`,
      '/skill/scripts/helper.js': `exports.fail = function fail() {
  throw new TypeError('bad input');
};`
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('start\n');
    expect(r.stderr).toMatch(/^TypeError: bad input\n/);
    expect(r.stderr).toContain('/skill/scripts/helper.js:2:');
    expect(r.stderr).toContain('/skill/scripts/main.js:3:');
    expect(r.stderr).not.toContain('blob:');
  });

  it('says what went wrong with a module that cannot load: syntax, ES modules, packages, libraries not loaded', async () => {
    const syntax = await run({ '/skill/scripts/main.js': 'const x = ;' });
    expect(syntax.code).toBe(1);
    expect(syntax.stderr).toMatch(/^SyntaxError: .+ \(in \/skill\/scripts\/main\.js\)\n$/);
    const esm = await run({ '/skill/scripts/main.js': "import fs from 'fs';\nconsole.log(fs);" });
    expect(esm.stderr).toContain('(in /skill/scripts/main.js: it is written as an ES module; only CommonJS scripts run here');
    const mjs = await run({ '/skill/scripts/main.mjs': 'export {};' }, { main: '/skill/scripts/main.mjs' });
    expect(mjs.stderr).toContain('is an ES module (.mjs): only CommonJS scripts run here');
    const pkg = await run({ '/skill/scripts/main.js': "require('lodash');" });
    expect(pkg.stderr).toContain("Cannot find module 'lodash'. A script here can require fs, path, util and its skill's own .js and .json files");
    const lib = await run({ '/skill/scripts/main.js': "const name = 'tiny'; require(name);" }, { libraryNames: ['tiny'] });
    expect(lib.stderr).toContain("The library 'tiny' was not loaded");
  });

  it('gives a library the app loaded by its name, as a CommonJS module', async () => {
    const r = await run({ '/skill/scripts/main.js': "const tiny = require('tiny'); console.log(tiny.twice(21), require('tiny') === tiny);" }, { libraries: { tiny: 'exports.twice = (n) => n * 2;' } });
    expect(r).toMatchObject({ code: 0, stdout: '42 true\n' });
  });

  it('keeps at most a million characters of what it prints, and says how much there was', async () => {
    const r = await run({ '/skill/scripts/main.js': "process.stdout.write('x'.repeat(1_200_000));" });
    expect(r.stdout.length).toBe(1_000_000);
    expect(r.stdoutChars).toBe(1_200_000);
  });

  it('tells what it prints as it prints it, within the same limit, so a run stopped midway keeps it', async () => {
    const told: [string, string][] = [];
    let atPrint = '';
    const r = await run(
      { '/skill/scripts/main.js': "console.log('one'); console.error('two'); process.stdout.write('x'.repeat(1_200_000)); console.log('past the limit');" },
      { onPrint: (kind, text) => (told.push([kind, text.slice(0, 5)]), kind === 'stderr' && (atPrint = text)) }
    );
    expect(told).toEqual([['stdout', 'one\n'], ['stderr', 'two\n'], ['stdout', 'xxxxx']]);
    expect(atPrint).toBe('two\n');
    expect(r.stdout.length).toBe(1_000_000);
  });

  it('works out paths as Node does', async () => {
    const r = await run({
      '/skill/scripts/main.js': `const p = require('path');
console.log([p.join('a/', '../b', './c.txt'), p.resolve('x', '../y'), p.dirname('/a/b/'), p.basename('/a/b.txt', '.txt'), p.extname('.env'), p.relative('/work/a', '/work/b/c'), p.normalize('../a//b/'), p.parse('/a/b.tar.gz').name].join(' | '));`
    });
    expect(r.stdout).toBe('b/c.txt | /work/y | /a | b |  | ../b/c | ../a/b/ | b.tar\n');
  });
});
