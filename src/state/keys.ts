// Key state. The keys themselves live only in the key vault (a separate page); the main app only knows whether each is set and whether it is locked.
import { signal } from '@preact/signals';
import { vault, vaultIsolated } from '../lib/vault/client';
import { EMPTY_KEY_STATUS, EMPTY_VAULT_STATE, type KeyStatus, type VaultState } from '../lib/keys/accounts';
import type { AuthRef } from '../lib/providers/types';
import { showToast } from './ui';

export const keyInfos = signal<Record<string, KeyStatus>>({});
/** State of the whole vault (whether a passphrase is set, whether it is locked) */
export const vaultState = signal<VaultState>(EMPTY_VAULT_STATE);
/** Whether the vault's state has been received at least once (until then vaultState is a placeholder) */
export const vaultStatusKnown = signal(false);

export function keyStatus(id: string): KeyStatus {
  return keyInfos.value[id] ?? EMPTY_KEY_STATUS;
}

/** Whether the key is usable (set and unlocked) */
export function keyReady(id: string): boolean {
  const s = keyStatus(id);
  return s.present && !s.locked;
}

/** Directive asking the vault to attach the key to a request (undefined when no key is usable, i.e. send without a key) */
export function authFor(id: string): AuthRef | undefined {
  return keyReady(id) ? { keyId: id } : undefined;
}

let subscribed = false;
export async function connectKeys() {
  if (!subscribed) {
    subscribed = true;
    vault.onStatus((st, v) => {
      keyInfos.value = st;
      vaultState.value = v;
      vaultStatusKnown.value = true;
    });
  }
  try {
    await vault.requestStatus();
  } catch (e) {
    showToast((e as Error).message, 'error');
  }
}

/** Delete all API keys (asks the vault, because the main app cannot delete a cross-origin vault's keys directly) */
export async function clearAllKeys() {
  await vault.command('clear-all');
}

// ---- Old keys left on the main app's origin after moving to a cross-origin vault ----
const LOCAL_KEY_DB = 'key-vault';
export const leftoverLocalKeys = signal(false);

export async function checkLeftoverLocalKeys() {
  if (!vaultIsolated || !indexedDB.databases) return;
  const dbs = await indexedDB.databases();
  leftoverLocalKeys.value = dbs.some((d) => d.name === LOCAL_KEY_DB);
}

export async function clearLeftoverLocalKeys() {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(LOCAL_KEY_DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  leftoverLocalKeys.value = false;
}
