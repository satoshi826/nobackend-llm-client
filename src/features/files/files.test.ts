import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { cleanFileName, cleanFiles, currentText, getFile, listFiles, MAX_VERSIONS, newFile, putFile, withVersion } from '../../lib/db/files';
import { exportAll, importAll } from '../../lib/db/export';
import { db } from '../../lib/db/schema';
import type { FileRecord, MessageRecord } from '../../lib/db/schema';
import { buildRequestMessages } from '../../lib/chat/request';
import { attachmentsTransform, withAttachments } from './transform';
import { registerMessageTransform } from '../../lib/chat/request';

registerMessageTransform(attachmentsTransform);
import { parseDelimited } from './csv';
import { filesNote, makeFileTools, READ_CHUNK, type FileToolDeps } from './tools';

const ctx = { signal: new AbortController().signal, transport: {} as never, authFor: () => undefined };

function memDeps(scope = new Set<string>()) {
  const files = new Map<string, FileRecord>();
  let n = 0;
  const deps: FileToolDeps = {
    async create(name, text) {
      const f = newFile({ id: `f${++n}`, name, kind: 'document', text, by: 'model' });
      files.set(f.id, f);
      scope.add(f.id);
      return f;
    },
    get: async (id) => (scope.has(id) ? files.get(id) : undefined),
    async update(id, text, note) {
      const f = withVersion(files.get(id)!, text, 'model', note);
      files.set(id, f);
      return f;
    },
    // Stands in for the fetch page: "decline" in the address means the user said no; .png is an image
    async fetch(url) {
      if (url.includes('decline')) return null;
      if (url.endsWith('.png')) return { kind: 'image', name: 'cat.png' };
      return { kind: 'file', file: await deps.create('page.txt', 'fetched text') };
    }
  };
  return { deps, files, scope };
}

const tool = (deps: FileToolDeps, name: string) => makeFileTools(deps).find((t) => t.name === name)!;
const run = async (deps: FileToolDeps, name: string, raw: unknown) => {
  const t = tool(deps, name);
  return t.execute(t.prepare(raw), ctx);
};

describe('file names and versions', () => {
  it('cleans names from models and disks', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd.md');
    expect(cleanFileName('C:\\x\\report.csv')).toBe('report.csv');
    expect(cleanFileName('  ', 'txt')).toBe('untitled.txt');
    expect(cleanFileName('a\u0000b.md')).toBe('ab.md');
  });
  it('appends versions and keeps at most MAX_VERSIONS', () => {
    let f = newFile({ id: 'x', name: 'a.md', kind: 'document', text: 'v1', by: 'model' });
    for (let i = 2; i <= MAX_VERSIONS + 5; i++) f = withVersion(f, `v${i}`, 'user');
    expect(f.versions).toHaveLength(MAX_VERSIONS);
    expect(currentText(f)).toBe(`v${MAX_VERSIONS + 5}`);
    expect(f.versions[f.versions.length - 1].v).toBe(MAX_VERSIONS + 5);
    expect(f.size).toBe(currentText(f).length);
  });
});

describe('file tools', () => {
  it('creates, appends, edits by find/replace and reads in chunks', async () => {
    const { deps, files } = memDeps();
    const c = await run(deps, 'create_file', { name: 'report', content: '# Title\nintro' });
    expect((c.details as { name: string }).name).toBe('report.md');
    const id = (c.details as { fileId: string }).fileId;
    await run(deps, 'append_file', { file_id: id, content: '\n## More' });
    await run(deps, 'edit_file', { file_id: id, find: 'intro', replace: 'Introduction', note: 'wording' });
    const f = files.get(id)!;
    expect(currentText(f)).toBe('# Title\nIntroduction\n## More');
    expect(f.versions.map((v) => v.v)).toEqual([1, 2, 3]);
    expect(f.versions[2].note).toBe('wording');
    const r = await run(deps, 'read_file', { file_id: id });
    expect(r.content).toContain('Introduction');
    expect(r.content).toContain('end of file');
  });
  it('rejects ambiguous or missing find text, and both modes at once', async () => {
    const { deps } = memDeps();
    const id = ((await run(deps, 'create_file', { name: 'a.txt', content: 'x x' })).details as { fileId: string }).fileId;
    await expect(run(deps, 'edit_file', { file_id: id, find: 'x', replace: 'y' })).rejects.toThrow(/複数/);
    await expect(run(deps, 'edit_file', { file_id: id, find: 'zzz', replace: 'y' })).rejects.toThrow(/見つかりません/);
    expect(() => tool(deps, 'edit_file').prepare({ file_id: id, content: 'a', find: 'x', replace: 'y' })).toThrow(/どちらか一方/);
  });
  it('cannot touch files outside the conversation', async () => {
    const scope = new Set<string>();
    const { deps, files } = memDeps(scope);
    files.set('other', newFile({ id: 'other', name: 'secret.md', kind: 'upload', text: 'secret', by: 'upload' }));
    await expect(run(deps, 'read_file', { file_id: 'other' })).rejects.toThrow(/使えません/);
    await expect(run(deps, 'append_file', { file_id: 'other', content: 'x' })).rejects.toThrow(/使えません/);
  });
  it('reads long files in pages', async () => {
    const { deps } = memDeps();
    const id = ((await run(deps, 'create_file', { name: 'long.txt', content: 'a'.repeat(READ_CHUNK + 10) })).details as { fileId: string }).fileId;
    const first = await run(deps, 'read_file', { file_id: id });
    expect(first.content).toContain(`offset=${READ_CHUNK}`);
    const second = await run(deps, 'read_file', { file_id: id, offset: READ_CHUNK });
    expect(second.content).toContain('end of file');
  });
  it('lists the files of the conversation for the system prompt', () => {
    expect(filesNote([])).toBeUndefined();
    expect(filesNote([{ id: 'f1', name: 'a.md', size: 3 }])).toContain('a.md (id: f1, 3 chars)');
  });
});

describe('attachments in requests', () => {
  it('puts attached files before the text and notes partial files', () => {
    const t = withAttachments('summarize', [
      { fileId: 'f1', name: 'a.txt', mime: 'text/plain', version: 1, text: 'hello', totalChars: 5 },
      { fileId: 'f2', name: 'b.pdf', mime: 'text/plain', version: 2, text: 'abc', totalChars: 10 }
    ]);
    expect(t.indexOf('hello')).toBeLessThan(t.indexOf('summarize'));
    expect(t).toContain('offset=3');
    expect(t).not.toContain('f1" version="1">\nhello\n</file>\n[Only');
  });
  it('sends attachments with the user message', () => {
    const m: MessageRecord = {
      id: 'u1',
      conversationId: 'c',
      parentId: null,
      role: 'user',
      parts: [{ type: 'text', text: 'what is this?' }],
      createdAt: 1,
      status: 'done',
      attachments: [{ fileId: 'f1', name: 'a.txt', mime: 'text/plain', version: 1, text: 'file body', totalChars: 9 }]
    };
    const out = buildRequestMessages([m], '');
    const text = out[0].parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    expect(text).toContain('file body');
    expect(text).toContain('what is this?');
  });
});

describe('csv preview', () => {
  it('handles quotes, escaped quotes and newlines in cells', () => {
    const { rows } = parseDelimited('a,b\n"x, y","he said ""hi"""\n"multi\nline",2\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', '2']
    ]);
  });
});

describe('file storage and backups', () => {
  it('stores files and round-trips them through export / import', { timeout: 30_000 }, async () => {
    const f = withVersion(newFile({ id: 'file-1', name: 'notes.md', kind: 'document', text: 'one', by: 'model', conversationId: 'c1' }), 'two', 'user');
    await putFile(f);
    expect(currentText((await getFile('file-1'))!)).toBe('two');
    const dump = await exportAll();
    expect((dump.files as { id: string }[] | undefined)?.map((x) => x.id)).toContain('file-1');
    await db().files.clear();
    const r = await importAll(JSON.parse(JSON.stringify(dump)));
    expect(r.tables.files).toBe(1);
    const back = (await listFiles()).find((x) => x.id === 'file-1')!;
    expect(back.versions.map((v) => v.text)).toEqual(['one', 'two']);
  });
  it('drops malformed file records on import', () => {
    expect(cleanFiles([{ id: 'a' }, null, { id: 'b', name: '../x', versions: [{ v: 1, text: 'ok' }] }]).map((f) => f.name)).toEqual(['x.md']);
  });
});

describe('fetch_file', () => {
  it('only takes https addresses', () => {
    const { deps } = memDeps();
    expect(() => tool(deps, 'fetch_file').prepare({ url: 'http://example.com/a.txt' })).toThrow();
    expect(() => tool(deps, 'fetch_file').prepare({ url: 'javascript:alert(1)' })).toThrow();
    expect(tool(deps, 'fetch_file').prepare({ url: ' https://example.com/a.txt ' })).toEqual({ url: 'https://example.com/a.txt' });
  });
  it('asks the user itself, so the app does not ask again', () => {
    expect(tool(memDeps().deps, 'fetch_file').confirmsItself).toBe(true);
  });
  it('gives the model a file id it can read, says when an image was saved, and when the user declined', async () => {
    const { deps } = memDeps();
    const file = await run(deps, 'fetch_file', { url: 'https://example.com/a.txt' });
    expect(file.content).toMatch(/id: f1/);
    expect((await run(deps, 'read_file', { file_id: 'f1' })).content).toContain('fetched text');
    expect((await run(deps, 'fetch_file', { url: 'https://example.com/cat.png' })).content).toMatch(/image "cat.png"/);
    expect((await run(deps, 'fetch_file', { url: 'https://example.com/decline' })).content).toMatch(/declined/);
  });
});
