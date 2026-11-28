import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { encryptFile, encryptSecret, MIN_ITERATIONS } from '../lib/crypto/passphrase';
import { exportBackup } from '../lib/db/export';
import { readBytes, storeBytes } from '../lib/db/files';
import { db } from '../lib/db/schema';
import { BackupPasswordNeeded, ENCRYPTED_BACKUP_FORMAT, importFromFile } from './data';

const chat = () => db().conversations.put({ id: 'c1', title: 'secret chat', createdAt: 1, updatedAt: 1, currentLeafId: null, providerId: 'venice', modelId: 'm', systemPrompt: '', webSearch: 'off', pinned: 0, tags: [] });

beforeEach(async () => {
  await Promise.all(db().tables.map((t) => t.clear()));
});

describe('encrypted backups', () => {
  it('asks for the password, rejects a wrong one, and imports with the right one (a chunk at a time)', { timeout: 30_000 }, async () => {
    await chat();
    const plain = await exportBackup();
    await db().conversations.clear();
    const file = new File([await encryptFile(plain, 'backup-pass', ENCRYPTED_BACKUP_FORMAT, MIN_ITERATIONS)], 'b.encrypted');
    expect(await file.text()).not.toContain('secret chat');
    await expect(importFromFile(file)).rejects.toBeInstanceOf(BackupPasswordNeeded);
    await expect(importFromFile(file, 'wrong-pass')).rejects.toThrow(/パスワード/);
    const r = await importFromFile(file, 'backup-pass');
    expect(r.conversations).toBe(1);
    expect((await db().conversations.get('c1'))?.title).toBe('secret chat');
  });

  it('still opens one encrypted whole, as written before chunks', { timeout: 30_000 }, async () => {
    await chat();
    const plain = await (await exportBackup()).text();
    await db().conversations.clear();
    const file = new File([JSON.stringify({ format: ENCRYPTED_BACKUP_FORMAT, version: 1, enc: await encryptSecret(plain, 'backup-pass', MIN_ITERATIONS) })], 'b.json');
    await expect(importFromFile(file)).rejects.toBeInstanceOf(BackupPasswordNeeded);
    expect((await importFromFile(file, 'backup-pass')).conversations).toBe(1);
  });

  it('refuses a file whose iteration count is out of range, saying so instead of blaming the password', async () => {
    const enc = await encryptSecret('{}', 'backup-pass');
    const file = new File([JSON.stringify({ format: ENCRYPTED_BACKUP_FORMAT, version: 1, enc: { ...enc, iter: 1e12 } })], 'b.json');
    await expect(importFromFile(file, 'backup-pass')).rejects.toThrow(/反復回数/);
  });

  it('encrypts a zip backup with its images, and opens it again', { timeout: 30_000 }, async () => {
    await chat();
    await storeBytes({ id: 'i1', mime: 'image/png', origin: { kind: 'made' }, conversationId: 'c1', name: 'cat.png' }, new Blob(['png bytes'], { type: 'image/png' }), false);
    const plain = await exportBackup(true);
    expect(plain.type).toBe('application/zip');
    const file = new File([await encryptFile(plain, 'backup-pass', ENCRYPTED_BACKUP_FORMAT, MIN_ITERATIONS)], 'b.encrypted');
    await Promise.all(db().tables.map((t) => t.clear()));
    const r = await importFromFile(file, 'backup-pass');
    expect(r).toMatchObject({ conversations: 1, tables: { images: 1 } });
    expect(await (await readBytes('i1'))?.text()).toBe('png bytes');
  });
});

describe('backups the browser cannot hold', () => {
  it('says the backup is too large instead of showing the engine\'s error', async () => {
    class Huge extends Blob {
      override text(): Promise<string> {
        throw new RangeError('Invalid string length');
      }
    }
    await expect(importFromFile(new Huge(['{"format":"nobackend-llm-client/export"}']) as File)).rejects.toThrow(/大きすぎて/);
  });
});
