import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { encryptSecret } from '../src/lib/crypto/passphrase';
import { clearAll, lock, removePassphrase, revealKey, saveKey, setPassphrase, status, unlock, unwrapDataKey, vaultState, wrapDataKey } from './store';

// tavily does no key check (network) on save, so only the store's behaviour is exercised
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
    expect(await vaultState()).toMatchObject({ hasPassphrase: false, locked: false });

    expect((await setPassphrase('short')).ok).toBe(false);
    expect((await setPassphrase(PASS)).ok).toBe(true);
    const pid1 = (await vaultState()).passphraseId;
    expect(pid1).toBeTruthy();
    expect(await status('tavily')).toMatchObject({ encrypted: true, locked: false });
    // Keys saved after setting a passphrase are encrypted automatically
    await saveKey('tavily', 'tvly-2');
    expect(await status('tavily')).toMatchObject({ encrypted: true, locked: false });

    lock();
    expect(await vaultState()).toMatchObject({ hasPassphrase: true, locked: true });
    expect(await status('tavily')).toMatchObject({ present: true, locked: true });
    expect((await saveKey('tavily', 'x')).ok).toBe(false);
    expect((await unlock('wrong passphrase')).ok).toBe(false);
    expect((await unlock(PASS)).ok).toBe(true);
    expect(await status('tavily')).toMatchObject({ locked: false, last4: 'vly-2'.slice(-4) });

    expect((await setPassphrase('another passphrase', 'wrong one!')).ok).toBe(false);
    // Wrap / unwrap the data key (anything without the marker is refused)
    const blob = await wrapDataKey('RAWKEY');
    expect(await unwrapDataKey(blob)).toBe('RAWKEY');
    await expect(unwrapDataKey(await encryptSecret('not a data key', PASS))).rejects.toThrow();
    // Changing it renews the ID, so the wrapped data key must be rewrapped with the new passphrase
    expect((await setPassphrase('another passphrase', PASS)).ok).toBe(true);
    expect((await vaultState()).passphraseId).not.toBe(pid1);
    await expect(unwrapDataKey(blob)).rejects.toThrow();
    expect((await setPassphrase(PASS, 'another passphrase')).ok).toBe(true);
    expect((await removePassphrase('wrong one!')).ok).toBe(false);
    expect((await removePassphrase(PASS)).ok).toBe(true);
    expect(await status('tavily')).toMatchObject({ encrypted: false, locked: false });
    expect(await vaultState()).toMatchObject({ hasPassphrase: false, locked: false });

    await clearAll();
    expect((await status('tavily')).present).toBe(false);
  });

  it('shows a saved key, asking for the passphrase again when there is one', { timeout: 30_000 }, async () => {
    await clearAll();
    expect((await revealKey('tavily')).ok).toBe(false);
    await saveKey('tavily', 'tvly-1');
    expect(await revealKey('tavily')).toEqual({ ok: true, key: 'tvly-1' });

    await setPassphrase(PASS);
    // Being unlocked is not enough: the passphrase has to be entered again
    expect((await revealKey('tavily')).ok).toBe(false);
    expect((await revealKey('tavily', 'wrong passphrase')).ok).toBe(false);
    expect(await revealKey('tavily', PASS)).toEqual({ ok: true, key: 'tvly-1' });

    lock();
    expect((await revealKey('tavily', PASS)).ok).toBe(false);
    await clearAll();
  });

  it('adopts the passphrase of keys encrypted by the old per-key scheme', { timeout: 30_000 }, async () => {
    await clearAll();
    await rawPut({ id: 'tavily', hosts: ['api.tavily.com'], createdAt: 1, enc: await encryptSecret('tvly-old', PASS) });
    await rawPut({ id: 'openrouter', hosts: ['openrouter.ai'], createdAt: 1, key: 'or-plain' });
    lock();
    expect(await vaultState()).toMatchObject({ hasPassphrase: true, locked: true });
    expect((await unlock(PASS)).ok).toBe(true);
    // Keys left in plaintext are encrypted with the same passphrase too
    expect(await status('openrouter')).toMatchObject({ encrypted: true, locked: false });
    lock();
    expect((await unlock(PASS)).ok).toBe(true);
    expect(await status('tavily')).toMatchObject({ locked: false, last4: '-old' });
    await clearAll();
  });
});
