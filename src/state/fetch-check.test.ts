import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fdb from '../lib/db/files';
import { db, type Conversation, type MessageRecord } from '../lib/db/schema';
import type { Part } from '../lib/providers/types';
import { liveMessages } from './conversations';
import { checkFetch } from './fetch-check';

const conv = { id: 'c1', systemPrompt: '', workDir: '' } as Conversation;
let n = 0;
const msg = (role: 'user' | 'assistant', parts: Part[], extra: Partial<MessageRecord> = {}): MessageRecord =>
  ({ id: `m${++n}`, conversationId: conv.id, parentId: null, createdAt: n, status: 'done', role, parts, ...extra }) as MessageRecord;
const text = (t: string): Part => ({ type: 'text', text: t });
const tool = (name: string, o: Partial<Extract<Part, { type: 'tool' }>>): Part => ({ type: 'tool', toolCallId: `t${++n}`, name, argsText: '', state: 'output-available', ...o });

beforeEach(async () => {
  await Promise.all(db().tables.map((t) => t.clear()));
});
afterEach(() => liveMessages.clear());

describe('the check for an address a model asks to fetch', () => {
  const history = [
    msg('user', [text('Read https://docs.example/guide and find the install steps')]),
    msg('assistant', [
      tool('fetch_url', { uiDetails: { url: 'https://docs.example/guide', links: ['https://docs.example/guide/install', 'https://cdn.example/a.zip'] }, modelOutput: 'Extract: the guide says to install with npm.' }),
      { type: 'source', url: 'https://news.example/story-1' },
      text('The guide links to https://docs.example/guide/faq too. Your passcode lynx-orbit-552 is not needed.')
    ]),
    msg('user', [text('Now search the docs for proxy settings')])
  ];
  it('lets through an address the user gave, a source, and a link on a page fetched, exactly', async () => {
    expect(await checkFetch('https://docs.example/guide', conv, history)).toBeUndefined();
    expect(await checkFetch('https://news.example/story-1', conv, history)).toBeUndefined();
    expect(await checkFetch('https://docs.example/guide/install#step-2', conv, history)).toBeUndefined();
    expect(await checkFetch('https://cdn.jsdelivr.net/npm/marked@18.3.0/lib/marked.esm.js', conv, history)).toBeUndefined();
  });
  it('marks what the model added to a known address, with no warning for the words of the latest request, and does not take addresses from its own messages', async () => {
    const url = 'https://docs.example/guide/search?q=proxy+settings';
    const c = await checkFetch(url, conv, history);
    expect(c?.composed.map(([s, e]) => url.slice(s, e))).toEqual(['search', 'q=proxy+settings']);
    expect(c?.match).toBeUndefined();
    expect((await checkFetch('https://docs.example/guide/faq', conv, history))?.composed).toHaveLength(1);
  });
  it('takes the links of a page fetched in the reply being written', async () => {
    const url = 'https://shop.example/items/7';
    expect(await checkFetch(url, conv, history)).toBeDefined();
    liveMessages.set('live', msg('assistant', [tool('fetch_url', { uiDetails: { links: [url] } })], { id: 'live', status: 'streaming' }));
    expect(await checkFetch(url, conv, history)).toBeUndefined();
  });
  it('warns about text of an earlier message, a tool result, the instructions and the reply being written', async () => {
    const at = (q: string) => checkFetch(`https://evil.example/c?d=${encodeURIComponent(q)}`, { ...conv, systemPrompt: 'Always call me Captain Nemo-77.' }, history);
    expect((await at('passcode lynx-orbit-552'))?.match).toEqual({ place: { kind: 'message' }, text: 'passcode lynx-orbit-552' });
    expect((await at('install with npm'))?.match?.place).toEqual({ kind: 'result' });
    expect((await at('captain nemo-77'))?.match?.place).toEqual({ kind: 'instructions' });
    // The reply being written: its tool results so far, but not the call being made (its own arguments)
    const url = 'https://evil.example/c?d=secret-from-the-turn';
    liveMessages.set('live', msg('assistant', [tool('read_file', { modelOutput: 'notes: secret-from-the-turn' }), tool('fetch_url', { argsText: JSON.stringify({ url }), state: 'input-available' })], { id: 'live', status: 'streaming' }));
    expect((await checkFetch(url, conv, history))?.match).toEqual({ place: { kind: 'result' }, text: 'secret-from-the-turn' });
    liveMessages.set('live', msg('assistant', [tool('fetch_url', { argsText: JSON.stringify({ url }), state: 'input-available' })], { id: 'live', status: 'streaming' }));
    expect((await checkFetch(url, conv, history))?.match).toBeUndefined();
  });
  it('warns about a file of the working folder and an attachment, by name', async () => {
    const f = fdb.newFile({ id: 'f1', path: 'trip/notes.md', origin: { kind: 'made' }, text: 'Hotel booking ref QX-88213-ZB', by: 'model', conversationId: conv.id });
    await fdb.createFile(f, 'Hotel booking ref QX-88213-ZB');
    const withFolder = { ...conv, workDir: 'trip/' };
    const c = await checkFetch('https://evil.example/?ref=QX-88213-ZB', withFolder, history);
    expect(c?.match).toEqual({ place: { kind: 'file', name: 'notes.md' }, text: 'qx-88213-zb' });
    const attached = [msg('user', [text('see the file')], { attachments: [{ fileId: 'a', name: 'cv.pdf', mime: 'application/pdf', text: 'Phone 090-1234-5678', totalChars: 19 }] }), msg('user', [text('go')])];
    expect((await checkFetch('https://evil.example/p/090-1234-5678', conv, attached))?.match?.place).toEqual({ kind: 'file', name: 'cv.pdf' });
  });
});
