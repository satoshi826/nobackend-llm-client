import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFile, getFile, listFiles, newFile, readText } from '../../lib/db/files';
import { resetCatalog } from '../../lib/db/catalog';
import { folderNameFor } from '../../lib/paths';
import { listImages, putImage } from '../../lib/db/images';
import { moveIntoWorkDirs, renumberTakenPaths } from '../../lib/db/paths';
import { db, type Conversation, type MessageRecord } from '../../lib/db/schema';
import { putConversation } from '../../lib/db/repo';
import { conversations } from '../../state/conversations';
import { contributedTools } from '../../state/tool-registry';
import type { ModelInfo } from '../../lib/providers/types';
import { moveItems, planRemoval, refreshFiles, refreshImages, siteOf, workDirOf } from './state';

const ctx = { signal: new AbortController().signal, transport: {} as never, authFor: () => undefined };
const model = { capabilities: { tools: true } } as ModelInfo;
const conv = (id: string, extra: Partial<Conversation> = {}): Conversation =>
  ({ id, title: id, createdAt: new Date(2026, 10, 27).getTime(), updatedAt: 1, currentLeafId: null, providerId: 'p', modelId: 'm', systemPrompt: '', webSearch: 'off', pinned: 0, tags: [], ...extra }) as Conversation;

function toolsFor(c: Conversation, history: MessageRecord[] = []) {
  const live = conversations.value.find((x) => x.id === c.id) ?? c;
  const tools = contributedTools({ conv: live, history, model, messageId: '' }).filter((t) => /_file$/.test(t.name));
  const run = async (name: string, raw: unknown) => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`no ${name}`);
    return t.execute(t.prepare(raw), ctx);
  };
  return { names: tools.map((t) => t.name), run };
}

/** Save a new file with its text */
const make = (o: Parameters<typeof newFile>[0]) => createFile(newFile(o), o.text);

beforeEach(async () => {
  await Promise.all(db().tables.map((t) => t.clear()));
  resetCatalog();
  conversations.value = [];
});

describe('working folder', () => {
  it('is made by the first file, named by the model, and holds every later one', async () => {
    const c = conv('c1');
    await putConversation(c);
    conversations.value = [c];
    const first = toolsFor(c);
    expect(first.names).toEqual(['write_file', 'fetch_file']);
    await first.run('write_file', { name: 'index.html', content: '<p>hi</p>', folder: 'Todo App' });
    expect(workDirOf('c1')).toBe('Todo App/');
    const next = toolsFor(c);
    expect(next.names).toContain('read_file');
    // Paths are relative to the folder; a leading "/" means the folder too
    await next.run('write_file', { name: '/js/app.js', content: 'x' });
    expect((await listFiles()).map((f) => f.name).sort()).toEqual(['Todo App/index.html', 'Todo App/js/app.js']);
    expect((await next.run('read_file', { file_id: 'JS/APP.js' })).content).toContain('x');
    // The same path again is the same file
    const again = await next.run('write_file', { name: 'index.html', content: '<p>2</p>' });
    expect(again.content).toMatch(/^Replaced/);
  });

  it('gets a number when another conversation has a folder of that name, and must be named by the model', async () => {
    const a = conv('a');
    const b = conv('b');
    const d = conv('d');
    conversations.value = [a, b, d];
    await toolsFor(a).run('write_file', { name: 'x.md', content: '1', folder: 'notes' });
    await toolsFor(b).run('write_file', { name: 'x.md', content: '2', folder: 'Notes' });
    expect([workDirOf('a'), workDirOf('b')]).toEqual(['notes/', 'Notes (2)/']);
    await expect(toolsFor(d).run('write_file', { name: 'x.md', content: '3' })).rejects.toThrow(/folder/);
    expect(workDirOf('d')).toBe('');
    // When no one chose a name (a fetched file came first): after the file, and the date only for nothing better
    expect(folderNameFor('Market Report.pdf', 0)).toBe('Market Report/');
    expect(folderNameFor('..', new Date(2026, 10, 27).getTime())).toBe('2026-11-27/');
  });

  it('reaches only its own folder; a file attached from outside is read but not changed', async () => {
    const c = conv('c', { workDir: 'mine/' });
    conversations.value = [c];
    await make({ id: 'out', name: 'theirs/secret.md', origin: { kind: 'made' }, text: 'secret', by: 'model', conversationId: 'other' });
    await make({ id: 'in', name: 'mine/a.md', origin: { kind: 'made' }, text: 'a', by: 'model', conversationId: 'c' });
    const plain = toolsFor(c);
    await expect(plain.run('read_file', { file_id: 'out' })).rejects.toThrow(/使えません|can't be used/);
    await expect(plain.run('read_file', { file_id: '../theirs/secret.md' })).rejects.toThrow();
    // A file written to a path outside lands inside: there is no way to name another folder
    await plain.run('write_file', { name: '../theirs/secret.md', content: 'overwrite?' });
    expect(await readText('out')).toBe('secret');
    expect((await listFiles()).some((f) => f.name === 'mine/theirs/secret.md')).toBe(true);
    const history = [{ attachments: [{ fileId: 'out' }], parts: [] } as unknown as MessageRecord];
    const attached = toolsFor(c, history);
    expect((await attached.run('read_file', { file_id: 'out' })).content).toContain('secret');
    await expect(attached.run('edit_file', { file_id: 'out', old_string: 'secret', new_string: 'changed' })).rejects.toThrow(/読むことしか|only be read/);
  });
});

describe('moving older data', () => {
  it('keeps a conversation’s own top folder as its working folder, moves loose files into one named after them, and numbers shared paths', async () => {
    const site = conv('site');
    const loose = conv('loose');
    await putConversation(site);
    await putConversation(loose);
    await make({ id: 'p', name: 'site/index.html', origin: { kind: 'made' }, text: '<link href="style.css">', by: 'model', conversationId: 'site' });
    await make({ id: 's', name: 'site/style.css', origin: { kind: 'made' }, text: 'p{}', by: 'model', conversationId: 'site' });
    await make({ id: 'c', name: 'counter.html', origin: { kind: 'made' }, text: '<p>', by: 'model', conversationId: 'loose' });
    await make({ id: 'j', name: 'js/app.js', origin: { kind: 'made' }, text: '1', by: 'model', conversationId: 'loose' });
    // An image attached in the chat stays where the user put it
    await putImage({ id: 'img', mime: 'image/png', conversationId: 'loose', origin: { kind: 'upload' }, name: 'cat.png' }, new Blob(['x'], { type: 'image/png' }), false);
    await make({ id: 'n1', name: 'Notes.md', origin: { kind: 'upload' }, text: '1', by: 'upload' });
    await make({ id: 'n2', name: 'notes.md', origin: { kind: 'upload' }, text: '2', by: 'upload' });
    const moved = await moveIntoWorkDirs([site, loose]);
    expect(moved.map((x) => x.workDir)).toEqual(['site/', 'counter/']);
    expect((await db().conversations.get('site'))!.workDir).toBe('site/');
    expect((await getFile('p'))!.name).toBe('site/index.html');
    // Moved together, so references between them still hold
    expect((await getFile('c'))!.name).toBe('counter/counter.html');
    expect((await getFile('j'))!.name).toBe('counter/js/app.js');
    expect((await listImages()).find((im) => im.id === 'img')!.path).toBe('cat.png');
    // Done once: a conversation with a folder is left alone
    expect(await moveIntoWorkDirs(moved)).toEqual([]);
    expect(await renumberTakenPaths()).toBe(1);
    const notes = (await listFiles()).map((f) => f.name).filter((n) => /notes/i.test(n));
    expect(notes).toHaveLength(2);
    expect(notes.filter((n) => / \(2\)\.md$/.test(n))).toHaveLength(1);
  });

  it('moves a conversation whose top folder holds other files too', async () => {
    const c = conv('mixed');
    await putConversation(c);
    await make({ id: 'a', name: 'shared/a.md', origin: { kind: 'made' }, text: 'a', by: 'model', conversationId: 'mixed' });
    await make({ id: 'b', name: 'shared/b.md', origin: { kind: 'upload' }, text: 'b', by: 'upload' });
    const [m] = await moveIntoWorkDirs([c]);
    expect(m.workDir).toBe('a/');
    expect((await getFile('a'))!.name).toBe('a/shared/a.md');
    expect((await getFile('b'))!.name).toBe('shared/b.md');
  });
});

describe('sites', () => {
  it('is the nearest folder above a page with an index.html, else the page’s own folder; none at the top', () => {
    const paths = ['p/todo/index.html', 'p/todo/pages/about.html', 'p/notes/memo.html', 'index.html', 'counter.html', 'P/TODO/js/x.html'];
    expect(siteOf('p/todo/index.html', paths)).toBe('p/todo/');
    expect(siteOf('p/todo/pages/about.html', paths)).toBe('p/todo/');
    expect(siteOf('P/TODO/js/x.html', paths)).toBe('P/TODO/');
    expect(siteOf('p/notes/memo.html', paths)).toBe('p/notes/');
    // The top is never a site, even with an index.html there
    expect(siteOf('counter.html', paths)).toBe('');
  });
});

describe('moving into folders', () => {
  it('moves files and images with their names, still as made, and numbers a taken one', async () => {
    const at = await putImage({ id: 'made', mime: 'image/png', conversationId: 'c' }, new Blob(['x'], { type: 'image/png' }), false);
    await make({ id: 'f', name: 'pics/notes.md', origin: { kind: 'made' }, text: 'x', by: 'model' });
    await moveItems([{ id: 'made', type: 'image' }, { id: 'f', type: 'file' }], 'pics/');
    const im = (await listImages()).find((i) => i.id === 'made')!;
    expect([im.path, im.origin]).toEqual([`pics/${at}`, { kind: 'made' }]);
    // Already there: stays as it is
    expect((await getFile('f'))!.name).toBe('pics/notes.md');
    await make({ id: 'g', name: 'other/notes.md', origin: { kind: 'made' }, text: 'y', by: 'model' });
    await moveItems([{ id: 'g', type: 'file' }], 'pics/');
    expect((await getFile('g'))!.name).toBe('pics/notes (2).md');
  });
  it('plans a delete: a folder goes with everything inside it, chosen items once', async () => {
    await make({ id: 'a', name: 'pics/a.md', origin: { kind: 'made' }, text: 'x', by: 'model' });
    await make({ id: 'b', name: 'pics/deep/b.md', origin: { kind: 'made' }, text: 'x', by: 'model' });
    await make({ id: 'c', name: 'other/c.md', origin: { kind: 'made' }, text: 'x', by: 'model' });
    await putImage({ id: 'i', mime: 'image/png', folder: 'pics/' }, new Blob(['x'], { type: 'image/png' }), false);
    await refreshFiles();
    await refreshImages();
    const r = planRemoval(['pics/'], [{ id: 'a', type: 'file' }, { id: 'c', type: 'file' }]);
    expect([r.fileIds.sort(), r.imageIds]).toEqual([['a', 'b', 'c'], ['i']]);
  });
});
