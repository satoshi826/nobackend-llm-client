import { runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { SkillFile } from '../../lib/skills/files';
import type { ScriptJob, ScriptResult } from '../../lib/sandbox/client';
import { makeReadSkillFileTool, makeRunSkillScriptTool, makeSkillTool, type ScriptDeps, type ScriptOutputFile, type SkillFilesDeps } from './tools';
import nodeSource from '../../../sandbox/node.js?raw';

const ctx = { signal: new AbortController().signal, toolCallId: 'call-1' } as any;
const file = (path: string, mime = 'text/markdown', bytes = 3): SkillFile => ({ path, mime, bytes });

describe('load_skill', () => {
  it('lists the files of the skill after its body, capped, and nothing for a skill without files', async () => {
    const files: Record<string, SkillFile[]> = {
      s1: [file('assets/x.png', 'image/png', 9), file('reference/a.md'), file('scripts/b.js', 'text/javascript', 12)],
      s2: Array.from({ length: 53 }, (_, i) => file(`r/${String(i).padStart(2, '0')}.md`))
    };
    const tool = makeSkillTool(
      [
        { id: 's1', name: 'forms', body: 'Run scripts/b.js.' },
        { id: 's2', name: 'many', body: 'Many.' },
        { id: 's3', name: 'plain', body: 'Plain.' }
      ],
      async (id) => files[id] ?? []
    );
    expect((await tool.execute({ name: 'forms' }, ctx)).content).toBe(
      '<skill name="forms">\nRun scripts/b.js.\n</skill>\n\nFiles in this skill\'s folder (3; paths inside it; read them with read_skill_file, run a .js script with run_skill_script):\n- assets/x.png (binary: image/png, 9 bytes)\n- reference/a.md (3 bytes)\n- scripts/b.js (12 bytes)'
    );
    const many = (await tool.execute({ name: 'many' }, ctx)).content;
    expect(many).toContain('(53; paths inside it; ');
    expect(many).toContain('- r/49.md (3 bytes)\n[3 more; read_skill_file with the path "." lists them all]');
    expect(many).not.toContain('r/50.md');
    expect((await tool.execute({ name: 'plain' }, ctx)).content).toBe('<skill name="plain">\nPlain.\n</skill>');
  });
});

describe('read_skill_file', () => {
  const texts: Record<string, string> = { 'reference/a.md': '# A\nline 2\nline 3', 'scripts/b.js': 'b()' };
  const deps: SkillFilesDeps = {
    skills: [{ id: 's1', name: 'forms' }],
    files: async () => [file('assets/x.png', 'image/png', 9), file('reference/a.md', 'text/markdown', 19), file('scripts/b.js', 'text/javascript', 3)],
    read: async (_id, path) => texts[path] ?? new Blob(['x'])
  };
  const tool = makeReadSkillFileTool(deps);
  const run = async (raw: unknown) => tool.execute(tool.prepare(raw), ctx);

  it('reads a text file with line numbers, a page at a time, as read_file does', async () => {
    expect((tool.parameters as any).properties.skill.enum).toEqual(['forms']);
    expect(tool.defaultPermission).toBe('allow');
    expect((await run({ skill: 'forms', path: './Reference\\A.md' })).content).toBe(
      '<skill_file skill="forms" path="reference/a.md">\n     1\t# A\n     2\tline 2\n     3\tline 3\n</skill_file>\n[end of file; 3 lines]'
    );
    const page = (await run({ skill: 'forms', path: 'reference/a.md', offset: 2, limit: 1 })).content;
    expect(page).toBe('<skill_file skill="forms" path="reference/a.md">\n     2\tline 2\n</skill_file>\n[lines 2-2 of 3; continue with offset=3]');
    expect((await run({ skill: 'forms', path: 'reference/a.md', offset: 9 })).content).toBe('offset=9 is past the end of "reference/a.md", which has 3 lines.');
  });

  it('lists a folder, or the whole skill for "."', async () => {
    expect((await run({ skill: 'forms', path: 'scripts/' })).content).toBe('Files in "scripts/" of the skill "forms" (1):\n- scripts/b.js (3 bytes)');
    expect((await run({ skill: 'forms', path: '.' })).content).toContain('Files in the folder of the skill "forms" (3):\n- assets/x.png (binary: image/png, 9 bytes)');
  });

  it('refuses binary files, missing files, paths outside the skill and skills not loaded', async () => {
    await expect(run({ skill: 'forms', path: 'assets/x.png' })).rejects.toMatchObject({ english: '"assets/x.png" is not a text file, so it can\'t be read (image/png, 9 B).' });
    await expect(run({ skill: 'forms', path: 'nope.md' })).rejects.toMatchObject({ english: 'The skill "forms" has no file "nope.md". Use a path listed in load_skill\'s result.' });
    expect(() => tool.prepare({ skill: 'forms', path: '../other/SKILL.md' })).toThrow();
    expect(() => tool.prepare({ skill: 'forms', path: '/etc/passwd' })).toThrow();
    expect(() => tool.prepare({ skill: 'forms' })).toThrow();
    await expect(run({ skill: 'other', path: 'a.md' })).rejects.toMatchObject({ english: 'There is no skill "other". Available skills: forms' });
  });
});

describe('run_skill_script', () => {
  // The sandbox's shim, run here as the worker runs it (each module a script of its own)
  const nodeScript = new Function(`${nodeSource}\nreturn nodeScript;`)() as (job: ScriptJob, compile: (code: string) => string) => Promise<ScriptResult>;
  let n = 0;
  const compile = (code: string) => {
    const url = `blob:null/tool-${++n}`;
    runInThisContext(code, { filename: url });
    return url;
  };
  const skillFiles: Record<string, string | Blob> = {
    'scripts/hello.js': `const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../reference/data.json'), 'utf8'));
const input = fs.existsSync('notes.md') ? fs.readFileSync('notes.md', 'utf8') : '';
console.log('Hello, ' + process.argv[2] + '! ' + data.greeting + (input ? ' / ' + input : ''));
fs.writeFileSync('out.txt', 'made by hello.js');
fs.writeFileSync('notes.md', input + ' (seen)');
fs.writeFileSync('logo.bin', new Uint8Array([0, 159, 146]));
if (process.argv[3] === 'fail') { console.error('failing on purpose'); process.exit(2); }`,
    'reference/data.json': '{"greeting":"from the skill"}',
    'assets/logo.png': new Blob([new Uint8Array([137, 80])], { type: 'image/png' })
  };
  const asked: { id: string; files: ScriptOutputFile[] }[] = [];
  const saved: { path: string; text: string }[][] = [];
  const deps = (answer: string[] | null, over: Partial<ScriptDeps> = {}): ScriptDeps => ({
    skills: [{ id: 's1', name: 'greeter' }],
    files: async () => Object.entries(skillFiles).map(([path, v]) => file(path, typeof v === 'string' ? (path.endsWith('.js') ? 'text/javascript' : 'application/json') : 'image/png', 1)),
    read: async (_id, path) => skillFiles[path],
    input: async (ref) => (ref === 'notes.md' ? { name: 'notes.md', text: 'my notes' } : undefined),
    libraries: async () => ({}),
    libraryNames: [],
    run: (job) => nodeScript(job, compile),
    existing: async (paths) => new Set(paths.filter((p) => p === 'notes.md')),
    ask: async (id, files) => (asked.push({ id, files }), answer),
    save: async (files) => (saved.push(files), files.map((f) => ({ path: f.path, replaced: f.path === 'notes.md' }))),
    ...over
  });
  const run = async (d: ScriptDeps, raw: unknown) => {
    const tool = makeRunSkillScriptTool(d);
    return tool.execute(tool.prepare(raw), ctx);
  };

  it('runs a script with its arguments, its skill\'s files and the working-folder files given, then saves what the user chose', async () => {
    asked.length = saved.length = 0;
    const tool = makeRunSkillScriptTool(deps(['out.txt', 'notes.md']));
    expect(tool.alwaysAsk).toBeUndefined();
    expect(tool.risk).toBe('exec');
    expect(tool.description).not.toContain('libraries');
    expect(tool.summarize(tool.prepare({ skill: 'greeter', path: 'scripts/hello.js', args: ['world'] }))).toBe('greeter/scripts/hello.js world');
    const r = await run(deps(['out.txt', 'notes.md']), { skill: 'greeter', path: 'scripts/hello.js', args: ['world'], file_ids: ['notes.md'] });
    expect(r.isError).toBe(false);
    expect(r.content).toBe(
      [
        'Ran scripts/hello.js of the skill "greeter": exit code 0.',
        'stdout:\nHello, world! from the skill / my notes\n',
        'It wrote 3 files in /work: out.txt (16 bytes), notes.md (15 bytes), logo.bin (3 bytes).',
        'Not offered for saving: logo.bin (binary: the working folder keeps text files).',
        'Saved in the working folder: "out.txt" (new), "notes.md" (replaced its text).'
      ].join('\n')
    );
    expect(asked).toEqual([{ id: 'call-1', files: [{ path: 'out.txt', bytes: 16, replaces: false }, { path: 'notes.md', bytes: 15, replaces: true }] }]);
    expect(saved).toEqual([[{ path: 'out.txt', text: 'made by hello.js' }, { path: 'notes.md', text: 'my notes (seen)' }]]);
    expect(r.details).toMatchObject({ code: 0, stdout: 'Hello, world! from the skill / my notes\n', saved: ['out.txt', 'notes.md'] });
  });

  it('saves nothing when the user declines, or only the files chosen', async () => {
    saved.length = 0;
    const declined = await run(deps(null), { skill: 'greeter', path: 'scripts/hello.js', args: ['a'] });
    expect(declined.content).toContain('The user chose not to save them in the working folder.');
    expect(declined.details).toMatchObject({ declined: true });
    const some = await run(deps(['out.txt']), { skill: 'greeter', path: 'scripts/hello.js', args: ['a'] });
    expect(some.content).toContain('Saved in the working folder: "out.txt" (new).\nThe user chose not to save: "notes.md".');
    expect(saved).toEqual([[{ path: 'out.txt', text: 'made by hello.js' }]]);
  });

  it('gives a failing script\'s exit code and stderr as an error', async () => {
    const r = await run(deps(null), { skill: 'greeter', path: 'scripts/hello.js', args: ['a', 'fail'] });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('exit code 2.');
    expect(r.content).toContain('stderr:\nfailing on purpose\n');
    expect(r.details).toMatchObject({ code: 2, stderr: 'failing on purpose\n' });
  });

  it('gives what a run printed until it was stopped, and saves nothing it wrote', async () => {
    asked.length = saved.length = 0;
    const stopped = { code: 1, stdout: 'started\n', stderr: 'warned\n', stdoutChars: 8, stderrChars: 7, written: {}, stopped: 'time' as const };
    const r = await run(deps(['out.txt'], { run: async () => stopped }), { skill: 'greeter', path: 'scripts/hello.js' });
    expect(r).toEqual({
      content: 'scripts/hello.js of the skill "greeter" did not finish: Stopped after 10 s. What it printed until then:\nstdout:\nstarted\n\nstderr:\nwarned\n\nFiles it wrote, if any, were discarded.',
      isError: true,
      details: { stdout: 'started\n', stderr: 'warned\n', stopped: 'time' }
    });
    const byUser = await run(deps(null, { run: async () => ({ ...stopped, stdout: '', stderr: '', stopped: 'user' as const }) }), { skill: 'greeter', path: 'scripts/hello.js' });
    expect(byUser.content).toBe('scripts/hello.js of the skill "greeter" did not finish: Stopped by the user. What it printed until then:\nstdout:\n(nothing)\nFiles it wrote, if any, were discarded.');
    const failed = await run(deps(null, { run: async () => ({ ...stopped, stopped: undefined, error: 'Stopped: no answer within 12000 ms.' }) }), { skill: 'greeter', path: 'scripts/hello.js' });
    expect(failed).toMatchObject({ isError: true, details: { error: 'Stopped: no answer within 12000 ms.' } });
    expect(asked).toEqual([]);
    expect(saved).toEqual([]);
  });

  it('cuts long output for the model: the start of stdout, the end of stderr', async () => {
    const long = { code: 0, stdout: 'o'.repeat(9000), stderr: 'e'.repeat(4500) + 'END', stdoutChars: 2_000_000, stderrChars: 4503, written: {} };
    const r = await run(deps(null, { run: async () => long }), { skill: 'greeter', path: 'scripts/hello.js' });
    expect(r.content).toContain(`${'o'.repeat(8000)}\n[stdout is cut at 8000 of its 2000000 characters]`);
    expect(r.content).toContain('[the first 503 characters of stderr are left out]\n');
    expect(r.content).toMatch(/eEND\nIt wrote no files in \/work\.$/);
  });

  it('refuses what is not a JavaScript file of a loaded skill before running anything', async () => {
    const tool = makeRunSkillScriptTool(deps(null));
    expect(() => tool.prepare({ skill: 'greeter', path: 'scripts/fill.py' })).toThrow(expect.objectContaining({ english: expect.stringMatching(/^Only JavaScript scripts \(\.js, \.cjs\) run in this app, so "scripts\/fill\.py" can't be run/) }));
    expect(() => tool.prepare({ skill: 'greeter', path: 'run.sh' })).toThrow(/JavaScript/);
    expect(() => tool.prepare({ skill: 'greeter', path: 'scripts/x.mjs' })).toThrow(expect.objectContaining({ english: expect.stringContaining('is an ES module') }));
    expect(() => tool.prepare({ skill: 'greeter', path: '../other/x.js' })).toThrow();
    await expect(run(deps(null), { skill: 'greeter', path: 'scripts/none.js' })).rejects.toMatchObject({ english: 'The skill "greeter" has no file "scripts/none.js". Use a path listed in load_skill\'s result.' });
    await expect(run(deps(null), { skill: 'other', path: 'a.js' })).rejects.toMatchObject({ english: 'There is no skill "other". Available skills: greeter' });
    await expect(run(deps(null), { skill: 'greeter', path: 'scripts/hello.js', file_ids: ['missing.md'] })).rejects.toMatchObject({ english: expect.stringContaining('There is no file "missing.md"') });
  });

  it('names the libraries there are, and hands the ones the skill\'s scripts require to the run', async () => {
    let job: ScriptJob | undefined;
    const d = deps(null, {
      libraryNames: ['tiny'],
      libraries: async (sources): Promise<Record<string, string>> => (sources.some((x) => x.includes("require('tiny')")) ? { tiny: 'exports.n = 1;' } : {}),
      read: async (_id, path) => (path === 'scripts/hello.js' ? "console.log(require('tiny').n)" : skillFiles[path]),
      run: async (j) => ((job = j), nodeScript(j, compile))
    });
    expect(makeRunSkillScriptTool(d).description).toContain('the libraries tiny by name');
    const r = await run(d, { skill: 'greeter', path: 'scripts/hello.js' });
    expect(job?.libraries).toEqual({ tiny: 'exports.n = 1;' });
    expect(job?.files['/skill/assets/logo.png']).toEqual(new Uint8Array([137, 80]));
    expect(r.content).toContain('stdout:\n1\n');
  });
});
