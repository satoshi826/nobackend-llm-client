import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import * as repo from './repo';
import { db, type Conversation, type MessageRecord, type ModelRecord } from './schema';
import { setDataKey } from './sealed';
import { generateDataKey } from '../crypto/data';

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
const msg = (id: string, conversationId: string, text: string, createdAt = 1): MessageRecord => ({ id, conversationId, parentId: null, role: 'user', parts: [{ type: 'text', text }], createdAt, status: 'done' });
const model = (providerId: string, id: string, source: ModelRecord['source']): Omit<ModelRecord, 'fetchedAt'> => ({ providerId, id, name: id, capabilities: {}, source });

afterEach(async () => {
  for (const c of await repo.listConversations()) await repo.deleteConversation(c.id);
  await Promise.all(['conversations', 'messages', 'models', 'settings'].map((t) => db().table(t).clear()));
  repo.clearSearchCache();
});

describe('conversations', () => {
  it('lists pinned conversations first, then the most recently updated, including temporary ones', async () => {
    await repo.putConversation(conv('old', { updatedAt: 1 }));
    await repo.putConversation(conv('new', { updatedAt: 5 }));
    await repo.putConversation(conv('pinned', { updatedAt: 0, pinned: 1 }));
    await repo.putConversation(conv('temp', { updatedAt: 3, temporary: true }));
    expect((await repo.listConversations()).map((c) => c.id)).toEqual(['pinned', 'new', 'temp', 'old']);
    expect(await db().conversations.get('temp')).toBeUndefined();
    expect((await repo.getConversation('temp'))?.id).toBe('temp');
  });

  it('deletes a conversation together with its messages', async () => {
    await repo.putConversation(conv('a'));
    await repo.putConversation(conv('b'));
    await repo.putMessage(msg('a1', 'a', 'x'));
    await repo.putMessage(msg('b1', 'b', 'y'));
    await repo.deleteConversation('a');
    expect(await repo.getConversation('a')).toBeUndefined();
    expect(await repo.listMessages('a')).toEqual([]);
    expect((await repo.listMessages('b')).map((m) => m.id)).toEqual(['b1']);
  });

  it('keeps a temporary chat’s messages as copies, so later changes to the draft do not leak in', async () => {
    await repo.putConversation(conv('t', { temporary: true }));
    const m = msg('t1', 't', 'first');
    await repo.putMessage(m);
    (m.parts[0] as { text: string }).text = 'changed';
    expect((await repo.listMessages('t'))[0].parts).toEqual([{ type: 'text', text: 'first' }]);
    expect(await db().messages.count()).toBe(0);
  });

  it('keeps a message of a temporary chat out of the database also when it is saved after the chat was deleted', async () => {
    await repo.putConversation(conv('t', { temporary: true }));
    await repo.deleteConversation('t');
    await repo.putMessage(msg('t1', 't', 'late'));
    expect(await db().messages.count()).toBe(0);
  });
});

describe('searchMessages', () => {
  it('finds text case-insensitively, one hit per conversation, newest message first', async () => {
    await repo.putConversation(conv('a'));
    await repo.putConversation(conv('b'));
    await repo.putMessage(msg('a1', 'a', 'Hello World', 1));
    await repo.putMessage(msg('a2', 'a', 'hello again', 2));
    await repo.putMessage(msg('b1', 'b', 'nothing here', 3));
    const hits = await repo.searchMessages('  HELLO ');
    expect(hits).toEqual([{ conversationId: 'a', messageId: 'a2', snippet: 'hello again' }]);
    expect(await repo.searchMessages('   ')).toEqual([]);
  });

  it('cuts a snippet around the match and strips Markdown syntax', async () => {
    await repo.putConversation(conv('a'));
    await repo.putMessage(msg('a1', 'a', `${'x'.repeat(50)} | **needle** | ---|---\n# after`));
    const [hit] = await repo.searchMessages('needle');
    expect(hit.snippet.startsWith('…')).toBe(true);
    expect(hit.snippet).toContain('needle');
    expect(hit.snippet).not.toMatch(/[|*#]|---/);
  });

  it('searches temporary chats too, and stops at the limit', async () => {
    await repo.putConversation(conv('t', { temporary: true }));
    await repo.putMessage(msg('t1', 't', 'find me'));
    for (const id of ['a', 'b', 'c']) {
      await repo.putConversation(conv(id));
      await repo.putMessage(msg(`${id}1`, id, 'find me'));
    }
    expect((await repo.searchMessages('find')).map((h) => h.conversationId).sort()).toEqual(['a', 'b', 'c', 't']);
    expect(await repo.searchMessages('find', undefined, 2)).toHaveLength(2);
  });

  it('with a passphrase, decrypts stored messages once, keeps up with saves and deletes, and finds the newest first', async () => {
    setDataKey(await generateDataKey());
    try {
      await repo.putConversation(conv('a'));
      await repo.putConversation(conv('b'));
      await repo.putMessage(msg('a1', 'a', 'Secret one', 1));
      await repo.putMessage(msg('b1', 'b', 'secret two', 2));
      // As after a reload: what is stored is read and decrypted by the first search
      repo.clearSearchCache();
      const [first, second] = await Promise.all([repo.searchMessages('SECRET'), repo.searchMessages('secret')]);
      expect(first.map((h) => h.messageId)).toEqual(['b1', 'a1']);
      expect(second).toEqual(first);
      await repo.putMessage(msg('a2', 'a', 'a newer secret', 3));
      expect((await repo.searchMessages('secret')).map((h) => h.messageId)).toEqual(['a2', 'b1']);
      await repo.deleteConversation('a');
      expect((await repo.searchMessages('secret')).map((h) => h.messageId)).toEqual(['b1']);
    } finally {
      // Encrypted rows go before the key does (the shared clean-up reads what is stored)
      await Promise.all(['conversations', 'messages'].map((t) => db().table(t).clear()));
      setDataKey(null);
    }
  });
});

describe('model cache', () => {
  it('replaces only the fetched models of one provider, and keeps manual ones', async () => {
    await repo.replaceModels('p', [model('p', 'old', 'fetched'), model('p', 'mine', 'manual')]);
    await repo.replaceModels('q', [model('q', 'other', 'fetched')]);
    await repo.replaceModels('p', [model('p', 'new', 'fetched')]);
    const ids = (await repo.listAllModels()).map((m) => `${m.providerId}/${m.id}`).sort();
    expect(ids).toEqual(['p/mine', 'p/new', 'q/other']);
  });
});

describe('settings and counts', () => {
  it('returns the fallback for a missing setting, and counts rows per table', async () => {
    expect(await repo.getSetting('missing', 42)).toBe(42);
    await repo.setSetting('k', { a: 1 });
    expect(await repo.getSetting('k', null)).toEqual({ a: 1 });
    await repo.putConversation(conv('a'));
    await repo.putMessage(msg('a1', 'a', 'x'));
    const counts = await repo.tableCounts();
    expect(counts).toMatchObject({ conversations: 1, messages: 1, files: 0, usage: 0 });
  });
});
