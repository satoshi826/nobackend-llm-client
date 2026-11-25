import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { encryptSecret } from '../lib/crypto/passphrase';
import { exportAll } from '../lib/db/export';
import { db } from '../lib/db/schema';
import { BackupPasswordNeeded, ENCRYPTED_BACKUP_FORMAT, importFromFile } from './data';

describe('encrypted backups', () => {
  it('asks for the password, rejects a wrong one, and imports with the right one', { timeout: 30_000 }, async () => {
    await db().conversations.put({ id: 'c1', title: 'secret chat', createdAt: 1, updatedAt: 1, currentLeafId: null, providerId: 'venice', modelId: 'm', systemPrompt: '', webSearch: 'off', pinned: 0, tags: [] });
    const plain = JSON.stringify(await exportAll());
    await db().conversations.clear();
    const file = new File([JSON.stringify({ format: ENCRYPTED_BACKUP_FORMAT, version: 1, enc: await encryptSecret(plain, 'backup-pass') })], 'b.json');
    expect(await file.text()).not.toContain('secret chat');
    await expect(importFromFile(file)).rejects.toBeInstanceOf(BackupPasswordNeeded);
    await expect(importFromFile(file, 'wrong-pass')).rejects.toThrow(/パスワード/);
    const r = await importFromFile(file, 'backup-pass');
    expect(r.conversations).toBe(1);
    expect((await db().conversations.get('c1'))?.title).toBe('secret chat');
  });
});
