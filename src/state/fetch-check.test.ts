import { afterEach, describe, expect, it } from 'vitest';
import type { Conversation, MessageRecord } from '../lib/db/schema';
import type { Part } from '../lib/providers/types';
import { liveMessages } from './conversations';
import { checkFetch } from './fetch-check';

const conv = { id: 'c1', systemPrompt: '', workDir: '' } as Conversation;
let n = 0;
const msg = (role: 'user' | 'assistant', parts: Part[], extra: Partial<MessageRecord> = {}): MessageRecord =>
  ({ id: `m${++n}`, conversationId: conv.id, parentId: null, createdAt: n, status: 'done', role, parts, ...extra }) as MessageRecord;
const text = (t: string): Part => ({ type: 'text', text: t });
const tool = (name: string, o: Partial<Extract<Part, { type: 'tool' }>>): Part => ({ type: 'tool', toolCallId: `t${++n}`, name, argsText: '', state: 'output-available', ...o });

afterEach(() => liveMessages.clear());

describe('the check for an address a model asks to fetch', () => {
  const history = [
    msg('user', [text('Read https://docs.example/guide and find the install steps')]),
    msg('assistant', [
      tool('fetch_url', { uiDetails: { url: 'https://docs.example/guide', links: ['https://docs.example/guide/install', 'https://cdn.example/a.zip'] }, modelOutput: 'Extract: the guide says to install with npm.' }),
      { type: 'source', url: 'https://news.example/story-1' },
      text('The guide links to https://docs.example/guide/faq too.')
    ]),
    msg('user', [text('Now search the docs for proxy settings')])
  ];
  it('lets through an address the user gave, a source, and a link on a page fetched, exactly', () => {
    expect(checkFetch('https://docs.example/guide', conv, history)).toBeUndefined();
    expect(checkFetch('https://news.example/story-1', conv, history)).toBeUndefined();
    expect(checkFetch('https://docs.example/guide/install#step-2', conv, history)).toBeUndefined();
    expect(checkFetch('https://cdn.jsdelivr.net/npm/marked@18.3.0/lib/marked.esm.js', conv, history)).toBeUndefined();
  });
  it('marks what the model added to a known address, and does not take addresses from its own messages', () => {
    const url = 'https://docs.example/guide/search?q=proxy+settings';
    expect(checkFetch(url, conv, history)?.composed.map(([s, e]) => url.slice(s, e))).toEqual(['search', 'q=proxy+settings']);
    expect(checkFetch('https://docs.example/guide/faq', conv, history)?.composed).toHaveLength(1);
  });
  it('takes the links of a page fetched in the reply being written', () => {
    const url = 'https://shop.example/items/7';
    expect(checkFetch(url, conv, history)).toBeDefined();
    liveMessages.set('live', msg('assistant', [tool('fetch_url', { uiDetails: { links: [url] } })], { id: 'live', status: 'streaming' }));
    expect(checkFetch(url, conv, history)).toBeUndefined();
  });
});
