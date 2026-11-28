// Data that cannot be read must never look like no data: while the data key is not open, every read of encrypted
// data fails as locked (so the app shows its lock screen and never an empty list a user could take for lost data),
// and opening the key afterwards gives everything back.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, type Conversation } from './schema';
import { DataLockedError, setDataKey } from './sealed';
import { generateDataKey } from '../crypto/data';
import { listConversations, putConversation } from './repo';
import { createFile, listFiles, newFile, readText, storeBytes } from './files';
import { resetCatalog } from './catalog';

const conv = { id: 'c', title: 'Plans', createdAt: 1, updatedAt: 1, currentLeafId: null, providerId: 'p', modelId: 'm', systemPrompt: '', webSearch: 'off', pinned: 0, tags: [] } as Conversation;

beforeEach(async () => {
  await Promise.all(db().tables.map((t) => t.clear()));
  resetCatalog();
});
afterEach(() => setDataKey(null));

describe('locked data', () => {
  it('fails as locked instead of looking empty, and comes back whole once unlocked', async () => {
    const key = await generateDataKey();
    setDataKey(key);
    await putConversation(conv);
    await createFile(newFile({ id: 'f', path: 'plans/notes.md', origin: { kind: 'made' }, text: 'secret plan', by: 'model', conversationId: 'c' }), 'secret plan');
    await storeBytes({ id: 'i', mime: 'image/png', origin: { kind: 'made' }, conversationId: 'c', folder: 'plans/' }, new Blob(['png'], { type: 'image/png' }), false);

    // As after a reload: nothing in memory, the key not opened yet
    resetCatalog();
    setDataKey(null);
    await expect(listConversations()).rejects.toBeInstanceOf(DataLockedError);
    await expect(listFiles()).rejects.toBeInstanceOf(DataLockedError);
    await expect(readText('f')).rejects.toBeInstanceOf(DataLockedError);

    // The failed read leaves nothing behind that looks like an empty store
    setDataKey(key);
    expect((await listConversations()).map((c) => c.title)).toEqual(['Plans']);
    const paths = (await listFiles()).map((f) => f.path);
    expect(paths).toHaveLength(2);
    expect(paths).toContain('plans/notes.md');
    expect(await readText('f')).toBe('secret plan');
  });
});
