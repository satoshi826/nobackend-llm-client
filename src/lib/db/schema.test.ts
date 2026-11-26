import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { AppDB } from './schema';

describe('database upgrades', () => {
  it('turns encrypted image bytes stored as ArrayBuffers into Blobs, and leaves the rest as it was', async () => {
    const name = 'blob-upgrade-test';
    const old = new Dexie(name);
    old.version(7).stores({
      conversations: 'id, updatedAt, folderId, pinned, *tags',
      messages: 'id, conversationId, parentId, groupId, createdAt',
      blobs: 'id, conversationId, createdAt',
      prompts: 'id, name, updatedAt',
      models: '[providerId+id], providerId, fetchedAt',
      settings: 'key',
      skills: 'id, name, updatedAt',
      files: 'id, updatedAt, conversationId, kind',
      usage: 'id, at, providerId, conversationId'
    });
    await old.open();
    await old.table('blobs').bulkPut([
      { id: 'sealed', createdAt: 1, mime: 'image/png', size: 3, enc: { iv: 'iv', data: new Uint8Array([1, 2, 3]).buffer } },
      { id: 'plain', createdAt: 2, mime: 'image/png', size: 1, blob: new Blob([new Uint8Array([9])]) }
    ]);
    old.close();

    const db = new AppDB(name);
    await db.open();
    const sealed = await db.blobs.get('sealed');
    expect(sealed!.enc!.iv).toBe('iv');
    expect(sealed!.enc!.data).toBeInstanceOf(Blob);
    expect(new Uint8Array(await sealed!.enc!.data.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const plain = await db.blobs.get('plain');
    expect(plain!.enc).toBeUndefined();
    expect(plain!.blob).toBeInstanceOf(Blob);
    expect(db.tables.map((t) => t.name)).toContain('fileVersions');
    db.close();
  });
});
