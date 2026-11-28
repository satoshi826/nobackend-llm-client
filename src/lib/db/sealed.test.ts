import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { generateDataKey, importDataKey } from '../crypto/data';
import { DataLockedError, seal, setDataKey, unseal } from './sealed';
import { db, type Conversation, type MessageRecord } from './schema';
import * as repo from './repo';
import { exportBackup, type ExportFile, importAll } from './export';

const conv = (id: string): Conversation => ({
  id,
  title: '秘密の題名',
  createdAt: 1,
  updatedAt: 2,
  currentLeafId: null,
  providerId: 'venice',
  modelId: 'm',
  systemPrompt: '秘密の指示',
  webSearch: 'off',
  pinned: 0,
  tags: []
});
const msg = (id: string, conversationId: string, text: string): MessageRecord => ({
  id,
  conversationId,
  parentId: null,
  role: 'user',
  parts: [{ type: 'text', text }],
  createdAt: Date.now(),
  status: 'done'
});

afterEach(async () => {
  setDataKey(null);
  await Promise.all(['conversations', 'messages', 'prompts', 'skills'].map((t) => db().table(t).clear()));
  repo.clearSearchCache();
});

describe('sealed storage', () => {
  it('moves secret fields into enc and restores them', async () => {
    const k = await generateDataKey();
    const s = await seal('conversations', conv('c'), k);
    expect(JSON.stringify(s)).not.toContain('秘密');
    expect(s).toMatchObject({ id: 'c', updatedAt: 2, pinned: 0 });
    expect(await unseal(s, k)).toEqual(conv('c'));
    await expect(unseal(s, null)).rejects.toBeInstanceOf(DataLockedError);
    // Opens after re-importing the key / does not open with a different key
    expect(await unseal(s, await importDataKey(k.raw))).toEqual(conv('c'));
    await expect(unseal(s, await generateDataKey())).rejects.toThrow();
    // Unchanged without a key
    expect(await seal('conversations', conv('c'), null)).toEqual(conv('c'));
  });

  it('encrypts every field but the few kept plain, including fields no list names (a video request)', async () => {
    const k = await generateDataKey();
    const m = { id: 'm1', conversationId: 'c1', parentId: null, createdAt: 3, role: 'user', status: 'done', parts: [{ type: 'text', text: '秘密' }], videoRequest: { prompt: '秘密の動画', model: 'v' }, video: { job: { downloadUrl: 'https://once.example/x' } } };
    const stored = (await seal('messages', m, k)) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['conversationId', 'createdAt', 'enc', 'id', 'parentId']);
    expect(JSON.stringify(stored)).not.toContain('秘密');
    expect(JSON.stringify(stored)).not.toContain('once.example');
    expect(await unseal(stored as typeof m, k)).toEqual(m);
  });

  it('stores settings that hold the user\'s text encrypted, reseals them, and opens them in backups', async () => {
    repo.sealSettingKey('settings:test-text');
    const k = await generateDataKey();
    setDataKey(k);
    await repo.setSealedSetting('settings:test-text', { defaultSystemPrompt: '秘密の指示' });
    const stored = await db().settings.get('settings:test-text');
    expect(stored?.enc).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain('秘密');
    expect(await repo.getSealedSetting('settings:test-text', null)).toEqual({ defaultSystemPrompt: '秘密の指示' });
    expect((JSON.parse(await (await exportBackup(false)).text()) as ExportFile).settings.find((x) => x.key === 'settings:test-text')?.value).toEqual({ defaultSystemPrompt: '秘密の指示' });
    // Passphrase removed: back to plain text
    await repo.resealAll(k, null);
    setDataKey(null);
    expect(await db().settings.get('settings:test-text')).toEqual({ key: 'settings:test-text', value: { defaultSystemPrompt: '秘密の指示' } });
    await db().settings.delete('settings:test-text');
  });

  it('repo encrypts at rest, decrypts on read, and searches decrypted text', async () => {
    const k = await generateDataKey();
    setDataKey(k);
    await repo.putConversation(conv('c1'));
    await repo.putMessage(msg('m1', 'c1', '猫の飼い方について'));
    const raw = await db().messages.get('m1');
    expect(JSON.stringify(raw)).not.toContain('猫');
    expect((await repo.listConversations())[0].title).toBe('秘密の題名');
    expect((await repo.listMessages('c1'))[0].parts).toEqual([{ type: 'text', text: '猫の飼い方について' }]);
    repo.clearSearchCache();
    expect((await repo.searchMessages('飼い方')).map((h) => h.messageId)).toEqual(['m1']);
  });

  it('resealAll turns encryption on and off, and export/import go through it', async () => {
    await repo.putConversation(conv('c1'));
    await repo.putMessage(msg('m1', 'c1', 'こんにちは'));
    const k = await generateDataKey();
    await repo.resealAll(null, k);
    expect(JSON.stringify(await db().messages.toArray())).not.toContain('こんにちは');
    // Simulate an interruption: running it again does not break anything
    await repo.resealAll(k, k);
    setDataKey(k);
    const ex: ExportFile = JSON.parse(await (await exportBackup()).text());
    expect(ex.messages[0].parts).toEqual([{ type: 'text', text: 'こんにちは' }]);
    await db().messages.clear();
    await db().conversations.clear();
    expect((await importAll(ex)).messages).toBe(1);
    expect(JSON.stringify(await db().messages.toArray())).not.toContain('こんにちは');
    await repo.resealAll(k, null);
    setDataKey(null);
    expect((await repo.listMessages('c1'))[0].parts[0]).toMatchObject({ text: 'こんにちは' });
    expect((await db().messages.toArray())[0]).not.toHaveProperty('enc');
  });
});
