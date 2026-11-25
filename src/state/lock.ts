// Conversation protection (data key) and locking.
// - With a passphrase, conversations, saved prompts, and skills are stored encrypted with the data key (lib/db/sealed.ts)
// - The data key is wrapped with the passphrase (encrypted by the key vault) and stored in the main app's DB; it is held in memory only while unlocked
// - Encryption is started, removed, rewrapped, and locked automatically to follow the vault's passphrase state
// - Locking reloads the page (to clear every conversation from memory). The vault unlock is per page, so after a reload the lock screen appears again
import { effect, signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import { setDataKey, currentDataKey } from '../lib/db/sealed';
import { generateDataKey, importDataKey } from '../lib/crypto/data';
import { vault } from '../lib/vault/client';
import type { VaultState } from '../lib/keys/accounts';
import { vaultState, vaultStatusKnown } from './keys';
import { settings } from './settings';
import { showToast } from './ui';
import { t } from './messages';

/**
 * none: not encrypted / locked: waiting for unlock / unlocked: unlocked
 * lost: the passphrase is gone, so the encrypted conversations cannot be opened
 */
export type DataLock = 'none' | 'locked' | 'unlocked' | 'lost';
export const dataLock = signal<DataLock>('none');
/** Status shown while encrypting, decrypting, etc. (empty when idle) */
export const dataWork = signal('');

const DATA_KEY_SETTING = 'secret:dataKey'; // Excluded from backups (starts with secret)
interface StoredDataKey {
  wrapped: unknown;
  /** ID of the passphrase used for wrapping */
  pid: string | null;
  /** Whether encrypting the existing data has finished (if closed midway, it resumes on the next unlock) */
  complete: boolean;
}

let stored: StoredDataKey | null = null;
let onUnlocked: () => Promise<void> = async () => {};
let busy: Promise<void> = Promise.resolve();

async function saveStored(s: StoredDataKey | null) {
  stored = s;
  await repo.setSetting(DATA_KEY_SETTING, s);
}

/** At startup: if a wrapped data key exists, start in the locked state */
export async function initDataLock(whenUnlocked: () => Promise<void>) {
  onUnlocked = whenUnlocked;
  stored = await repo.getSetting<StoredDataKey | null>(DATA_KEY_SETTING, null);
  dataLock.value = stored ? 'locked' : 'none';
  effect(() => {
    const vs = vaultState.value;
    if (!vaultStatusKnown.value) return;
    // Each time the vault state changes, process the changes one at a time in order
    busy = busy.then(() => react(vs)).catch((e) => showToast(t('lock.failed', { message: (e as Error).message }), 'error'));
  });
  startIdleLock();
}

async function react(vs: VaultState) {
  const dek = currentDataKey();
  // Locked (in another vault page, or by auto-lock) -> reload to clear conversations from memory
  if (dek && vs.locked) {
    location.reload();
    return;
  }
  // Unlocked -> open the data key and load conversations
  if (stored && !dek && vs.hasPassphrase && !vs.locked) {
    const raw = await vault.dataKey('unwrap-data-key', stored.wrapped);
    const key = await importDataKey(raw);
    setDataKey(key);
    if (!stored.complete) await finishSealing();
    if (stored.pid !== vs.passphraseId) await saveStored({ ...stored, wrapped: await vault.dataKey('wrap-data-key', key.raw), pid: vs.passphraseId });
    dataLock.value = 'unlocked';
    await onUnlocked();
    return;
  }
  // There are encrypted conversations but no passphrase (all keys were deleted while locked) -> cannot open
  if (stored && !dek && !vs.hasPassphrase) {
    dataLock.value = 'lost';
    return;
  }
  // Passphrase set -> encrypt conversations
  if (!stored && vs.hasPassphrase && !vs.locked) {
    const key = await generateDataKey();
    // Save the wrapped key before encrypting (if closed midway, it can resume on the next unlock)
    await saveStored({ wrapped: await vault.dataKey('wrap-data-key', key.raw), pid: vs.passphraseId, complete: false });
    setDataKey(key);
    await finishSealing(true);
    dataLock.value = 'unlocked';
    showToast(t('lock.sealed'));
    return;
  }
  // Passphrase changed -> rewrap the data key with the new passphrase
  if (stored && dek && vs.hasPassphrase && !vs.locked && stored.pid !== vs.passphraseId) {
    await saveStored({ ...stored, wrapped: await vault.dataKey('wrap-data-key', dek.raw), pid: vs.passphraseId });
    return;
  }
  // Passphrase removed -> remove conversation encryption (decrypt first, then delete the key)
  if (stored && dek && !vs.hasPassphrase) {
    dataWork.value = t('lock.unsealing');
    try {
      await repo.resealAll(dek, null, (d, total) => (dataWork.value = t('lock.unsealingProgress', { done: d, total })));
    } finally {
      dataWork.value = '';
    }
    setDataKey(null);
    await saveStored(null);
    dataLock.value = 'none';
    showToast(t('lock.unsealed'));
  }
}

/** Finish encrypting the existing data (if any remains) */
async function finishSealing(first = false) {
  const key = currentDataKey()!;
  dataWork.value = t('lock.sealing');
  try {
    await repo.resealAll(key, key, (d, total) => (dataWork.value = t('lock.sealingProgress', { done: d, total })));
  } finally {
    dataWork.value = '';
  }
  await saveStored({ ...stored!, complete: true });
  void first;
}

/** Lock now (lock the vault -> the state change triggers a reload) */
export async function lockNow() {
  if (!currentDataKey()) return;
  await vault.command('lock');
  // Make sure to lock even if no notification comes from the vault
  setTimeout(() => location.reload(), 1500);
}

// ---- Auto-lock after a period of inactivity ----
let lastActive = Date.now();
let busyCheck: () => boolean = () => false;

export function setBusyCheck(fn: () => boolean) {
  busyCheck = fn;
}

function startIdleLock() {
  if (typeof window === 'undefined') return;
  const touch = () => (lastActive = Date.now());
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focus']) window.addEventListener(ev, touch, { passive: true, capture: true });
  setInterval(() => {
    const min = settings.value.autoLockMinutes;
    if (!min || dataLock.value !== 'unlocked' || busyCheck()) return;
    if (Date.now() - lastActive >= min * 60_000) void lockNow();
  }, 30_000);
}
