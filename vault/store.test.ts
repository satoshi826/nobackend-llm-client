import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { encryptSecret } from '../src/lib/crypto/passphrase';
import { clearAll, lock, removePassphrase, saveKey, setPassphrase, status, unlock, vaultState } from './store';

// tavily / jina は保存時のキー確認（通信）がないので、ストアの動きだけを確かめられる
const PASS = 'correct horse battery';

async function rawPut(rec: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('key-vault', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('secrets', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const req = db.transaction('secrets', 'readwrite').objectStore('secrets').put(rec);
    req.onsuccess = resolve;
    req.onerror = reject;
  });
  db.close();
}

describe('key vault store', () => {
  it('stores plainly without a passphrase, encrypts everything once one is set', { timeout: 30_000 }, async () => {
    expect((await saveKey('tavily', 'tvly-1')).ok).toBe(true);
    expect(await status('tavily')).toMatchObject({ present: true, encrypted: false, locked: false, last4: 'vly-1'.slice(-4) });
    expect(await vaultState()).toEqual({ hasPassphrase: false, locked: false });

    expect((await setPassphrase('short')).ok).toBe(false);
    expect((await setPassphrase(PASS)).ok).toBe(true);
    expect(await status('tavily')).toMatchObject({ encrypted: true, locked: false });
    // パスフレーズ設定後のキーは自動で暗号化
    await saveKey('jina', 'jina-2');
    expect(await status('jina')).toMatchObject({ encrypted: true, locked: false });

    lock();
    expect(await vaultState()).toEqual({ hasPassphrase: true, locked: true });
    expect(await status('jina')).toMatchObject({ present: true, locked: true });
    expect((await saveKey('jina', 'x')).ok).toBe(false);
    expect((await unlock('wrong passphrase')).ok).toBe(false);
    expect((await unlock(PASS)).ok).toBe(true);
    expect(await status('tavily')).toMatchObject({ locked: false, last4: 'vly-1'.slice(-4) });

    expect((await removePassphrase()).ok).toBe(true);
    expect(await status('jina')).toMatchObject({ encrypted: false, locked: false });
    expect(await vaultState()).toEqual({ hasPassphrase: false, locked: false });

    await clearAll();
    expect((await status('tavily')).present).toBe(false);
  });

  it('adopts the passphrase of keys encrypted by the old per-key scheme', { timeout: 30_000 }, async () => {
    await clearAll();
    await rawPut({ id: 'tavily', hosts: ['api.tavily.com'], createdAt: 1, enc: await encryptSecret('tvly-old', PASS) });
    await rawPut({ id: 'jina', hosts: ['r.jina.ai'], createdAt: 1, key: 'jina-plain' });
    lock();
    expect(await vaultState()).toEqual({ hasPassphrase: true, locked: true });
    expect((await unlock(PASS)).ok).toBe(true);
    // 平文で残っていたキーも同じパスフレーズで暗号化される
    expect(await status('jina')).toMatchObject({ encrypted: true, locked: false });
    lock();
    expect((await unlock(PASS)).ok).toBe(true);
    expect(await status('tavily')).toMatchObject({ locked: false, last4: '-old' });
    await clearAll();
  });
});
