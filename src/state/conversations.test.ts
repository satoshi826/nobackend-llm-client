// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  conversations,
  currentConv,
  currentId,
  currentPath,
  draft,
  isDraft,
  liveMessages,
  loadConversations,
  messages,
  openConversation,
  persistDraft,
  removeConversation,
  startNewChat,
  takeWriting,
  updateConversation,
  writingOf
} from './conversations';
import { restoreRoute } from './router';
import { DEFAULT_SETTINGS, settings } from './settings';
import { mainView } from './ui';
import * as repo from '../lib/db/repo';
import { db, type Conversation, type MessageRecord } from '../lib/db/schema';

const conv = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  title: id,
  createdAt: 1,
  updatedAt: 1,
  currentLeafId: null,
  providerId: 'venice',
  modelId: 'm',
  systemPrompt: '',
  webSearch: 'off',
  pinned: 0,
  tags: [],
  ...extra
});
const msg = (id: string, parentId: string | null, createdAt: number, extra: Partial<MessageRecord> = {}): MessageRecord => ({
  id,
  conversationId: 'c',
  parentId,
  role: parentId ? 'assistant' : 'user',
  parts: [{ type: 'text', text: id }],
  createdAt,
  status: 'done',
  ...extra
});

async function store(c: Conversation, list: MessageRecord[] = []) {
  await repo.putConversation(c);
  for (const m of list) await repo.putMessage(m, !!c.temporary);
  await loadConversations();
}

beforeEach(() => {
  settings.value = { ...DEFAULT_SETTINGS, defaultSystemPrompt: 'Be kind.' };
  startNewChat();
});
afterEach(async () => {
  liveMessages.clear();
  for (const c of await repo.listConversations()) await repo.deleteConversation(c.id);
  await Promise.all(['conversations', 'messages'].map((t) => db().table(t).clear()));
  conversations.value = [];
});

describe('new chats (drafts)', () => {
  it('start as a draft with the default system prompt and no address', () => {
    expect(isDraft.value).toBe(true);
    expect(currentConv.value).toMatchObject({ id: 'draft', systemPrompt: 'Be kind.', currentLeafId: null });
    expect(currentConv.value.temporary).toBeUndefined();
    expect(currentPath.value).toEqual([]);
    expect(location.hash).toBe('');
    startNewChat(true);
    expect(draft.value.temporary).toBe(true);
  });

  it('change only the draft until it is saved', async () => {
    await updateConversation({ systemPrompt: 'Other', id: 'sneaky' } as Partial<Conversation>);
    expect(draft.value).toMatchObject({ id: 'draft', systemPrompt: 'Other' });
    expect(await repo.listConversations()).toEqual([]);
  });

  it('are saved on the first send, titled from the first message, and get an address', async () => {
    const c = await persistDraft(`  Hello\n\n world ${'x'.repeat(60)} `);
    expect(c.title).toBe(`Hello world ${'x'.repeat(28)}…`);
    expect(c.id).not.toBe('draft');
    expect(currentId.value).toBe(c.id);
    expect(conversations.value[0].id).toBe(c.id);
    expect((await repo.getConversation(c.id))?.systemPrompt).toBe('Be kind.');
    expect(location.hash).toBe(`#/c/${c.id}`);
    // already saved: the same conversation comes back
    expect((await persistDraft('again')).id).toBe(c.id);
  });

  it('as a temporary chat, are never written and get no address', async () => {
    startNewChat(true);
    const c = await persistDraft('secret');
    expect(c.temporary).toBe(true);
    expect(await db().conversations.get(c.id)).toBeUndefined();
    expect(location.hash).toBe('');
  });

  it('get a default title from an empty first message', async () => {
    expect((await persistDraft('   ')).title).toBe('新しいチャット');
  });
});

describe('opening a conversation', () => {
  it('treats replies left streaming by a reload as stopped, and prefers newer copies in memory', async () => {
    await store(conv('c', { currentLeafId: 'a1' }), [msg('u1', null, 1), msg('a1', 'u1', 2, { status: 'streaming' }), msg('a2', 'u1', 3, { status: 'streaming' })]);
    liveMessages.set('a2', msg('a2', 'u1', 3, { status: 'streaming', parts: [{ type: 'text', text: 'live' }] }));
    liveMessages.set('a3', msg('a3', 'u1', 4, { status: 'streaming' }));
    await openConversation('c');
    const byId = Object.fromEntries(messages.value.map((m) => [m.id, m]));
    expect(byId.a1.status).toBe('aborted');
    expect(byId.a2.parts).toEqual([{ type: 'text', text: 'live' }]);
    expect(byId.a3.status).toBe('streaming');
    expect(location.hash).toBe('#/c/c');
    expect(mainView.value).toEqual({ kind: 'chat' });
  });

  it('repairs a leaf that points at a message that was never written', async () => {
    await store(conv('c', { currentLeafId: 'missing' }), [msg('u1', null, 1), msg('a1', 'u1', 2)]);
    await openConversation('c');
    expect(currentConv.value.currentLeafId).toBe('a1');
    expect((await repo.getConversation('c'))?.currentLeafId).toBe('a1');
    expect(currentPath.value.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('opens from the address after a reload, and ignores addresses of conversations that do not exist', async () => {
    await store(conv('c', { currentLeafId: 'u1' }), [msg('u1', null, 1)]);
    await restoreRoute('#/c/nope');
    expect(isDraft.value).toBe(true);
    await restoreRoute('#/c/c');
    expect(currentId.value).toBe('c');
  });
});

describe('conversation list', () => {
  it('lists pinned conversations first, then the most recently updated', async () => {
    await repo.putConversation(conv('old', { updatedAt: 1 }));
    await repo.putConversation(conv('pinned', { updatedAt: 0, pinned: 1 }));
    await repo.putConversation(conv('new', { updatedAt: 9 }));
    await loadConversations();
    expect(conversations.value.map((c) => c.id)).toEqual(['pinned', 'new', 'old']);
  });

  it('goes back to a new chat when the open conversation is deleted', async () => {
    await store(conv('c'), [msg('u1', null, 1)]);
    await openConversation('c');
    const seen: string[] = [];
    await removeConversation('c', { beforeRemove: (id) => seen.push(id) });
    expect(seen).toEqual(['c']);
    expect(isDraft.value).toBe(true);
    expect(conversations.value).toEqual([]);
    expect(await repo.listMessages('c')).toEqual([]);
  });
});

describe('a message being written', () => {
  it('grows in its own signal; the messages change only when it starts and ends', () => {
    const m = (text: string, status: 'streaming' | 'done') => ({ id: 'w1', conversationId: 'c', parentId: null, role: 'assistant', createdAt: 1, status, parts: [{ type: 'text', text }] }) as never;
    // It starts: the messages take it, and it gets its own signal
    expect([...takeWriting(new Map([['w1', m('a', 'streaming')]])).keys()]).toEqual(['w1']);
    expect(writingOf('w1')?.value).toMatchObject({ status: 'streaming' });
    // It grows: only its signal changes
    expect(takeWriting(new Map([['w1', m('ab', 'streaming')]])).size).toBe(0);
    expect((writingOf('w1')!.value as { parts: { text: string }[] }).parts[0].text).toBe('ab');
    // It ends: the messages take the last copy, and the signal goes
    expect([...takeWriting(new Map([['w1', m('abc', 'done')]])).keys()]).toEqual(['w1']);
    expect(writingOf('w1')).toBeUndefined();
  });
});
