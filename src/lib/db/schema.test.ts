import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { AppDB, db, onDatabaseReplaced, setDatabaseName } from './schema';

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
      { id: 'sealed', createdAt: 1, mime: 'image/png', size: 3, enc: { iv: 'AAEC', data: new Uint8Array([1, 2, 3]).buffer } },
      { id: 'plain', createdAt: 2, mime: 'image/png', size: 1, blob: new Blob([new Uint8Array([9])]) }
    ]);
    old.close();

    const db = new AppDB(name);
    await db.open();
    const sealed = await db.blobs.get('sealed');
    expect(sealed!.enc!.iv).toEqual(new Uint8Array([0, 1, 2]));
    expect(sealed!.enc!.data).toBeInstanceOf(Blob);
    expect(new Uint8Array(await sealed!.enc!.data.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const plain = await db.blobs.get('plain');
    expect(plain!.enc).toBeUndefined();
    expect(plain!.blob).toBeInstanceOf(Blob);
    expect(db.tables.map((t) => t.name)).toContain('fileVersions');
    db.close();
  });

  it('turns encrypted data stored as base64 into bytes, in every table, without the key', async () => {
    const name = 'sealed-bytes-upgrade-test';
    const old = new Dexie(name);
    old.version(11).stores({
      conversations: 'id, updatedAt, pinned, *tags',
      messages: 'id, conversationId, parentId, groupId, createdAt',
      blobs: 'id, conversationId, createdAt',
      prompts: 'id, name, updatedAt',
      models: '[providerId+id], providerId, fetchedAt',
      settings: 'key',
      skills: 'id, name, updatedAt',
      files: 'id, updatedAt, conversationId',
      fileTexts: 'id, fileId',
      fileVersions: 'id, fileId',
      usage: 'id, at, providerId, conversationId'
    });
    await old.open();
    // 'AAEC' is the bytes 0, 1, 2; 'AwQ=' is 3, 4
    const enc = { iv: 'AAEC', ct: 'AwQ=' };
    await old.table('messages').bulkPut([
      { id: 'sealed', conversationId: 'c', createdAt: 1, enc },
      { id: 'plain', conversationId: 'c', createdAt: 2, parts: [] }
    ]);
    await old.table('fileTexts').put({ id: 't', fileId: 'f', enc });
    await old.table('blobs').put({ id: 'i', createdAt: 1, mime: 'image/png', size: 1, infoEnc: enc, enc: { iv: 'AAEC', data: new Blob([new Uint8Array([7])]) }, thumb: { iv: 'AwQ=', data: new Blob([]) } });
    old.close();

    const db = new AppDB(name);
    await db.open();
    const bytes = new Uint8Array([0, 1, 2, 3, 4]);
    expect((await db.messages.get('sealed')) as unknown).toMatchObject({ enc: bytes });
    expect(await db.messages.get('plain')).toMatchObject({ parts: [] });
    expect((await db.fileTexts.get('t')) as unknown).toMatchObject({ enc: bytes });
    const image = await db.blobs.get('i');
    expect(image!.infoEnc).toEqual(bytes);
    expect(image!.enc!.iv).toEqual(new Uint8Array([0, 1, 2]));
    expect((image!.thumb as { iv: Uint8Array }).iv).toEqual(new Uint8Array([3, 4]));
    db.close();
  });
});

describe('another tab upgrading the database', () => {
  it('makes this tab close it for good and say so, instead of opening it again with the old code', async () => {
    setDatabaseName('replaced-test');
    await db().open();
    let told = 0;
    onDatabaseReplaced(() => told++);
    // A newer version of the app in another tab
    const newer = new Dexie('replaced-test');
    newer.version(db().verno + 1).stores({ conversations: 'id' });
    await newer.open();
    expect(told).toBe(1);
    await expect(db().conversations.toArray()).rejects.toThrow();
    newer.close();
  });
});
