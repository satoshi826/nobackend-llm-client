// Data management (backup, import, delete all)
import * as repo from '../lib/db/repo';
import { exportBackup, importBackup } from '../lib/db/export';
import { saveSettings, settings } from './settings';
import { loadConversations } from './conversations';
import { loadFeatureData } from './lifecycle';
import { stopAll } from './runs';
import { clearAllKeys } from './keys';
import { decryptFile, decryptSecret, encryptFile, readFileHeader, UnsupportedBlobError, type EncryptedBlob } from '../lib/crypto/passphrase';
import { t } from './messages';

export type { StorageBreakdown } from '../lib/db/storage-usage';
/** What each kind of data takes in this browser's storage */
export { storageBreakdown } from '../lib/db/storage-usage';
/** How many images and videos are kept, and their bytes (they make backups large) */
export { imageUsage } from '../lib/db/images';

/**
 * Backup file encrypted with a password (PBKDF2 + AES-GCM, same scheme as the key vault): the backup file (JSON or
 * zip) encrypted a chunk at a time (version 2; lib/crypto/passphrase.ts encryptFile), or, written before that, a JSON
 * wrapper holding the whole backup as one encrypted value (version 1)
 */
export const ENCRYPTED_BACKUP_FORMAT = 'nobackend-llm-client/export-encrypted';

/** Thrown by importFromFile when the file is encrypted and no password was given */
export class BackupPasswordNeeded extends Error {
  constructor() {
    super(t('data.passwordNeeded'));
  }
}

/** The browser could not hold the data (out of memory, or its Blob storage is full) */
function outOfMemory(e: unknown): boolean {
  return e instanceof RangeError || (e instanceof DOMException && ['NotReadableError', 'QuotaExceededError', 'DataCloneError'].includes(e.name));
}

/** Write a backup file; with a password the whole file is encrypted */
export async function downloadExport(password?: string) {
  let file: Blob;
  try {
    const plain = await exportBackup(settings.value.backupIncludeImages);
    file = password ? await encryptFile(plain, password, ENCRYPTED_BACKUP_FORMAT) : plain;
    const ext = password ? 'encrypted' : plain.type === 'application/zip' ? 'zip' : 'json';
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nobackend-llm-client-backup-${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    throw outOfMemory(e) ? new Error(t('data.exportTooLarge')) : e;
  }
  await saveSettings({ lastBackupAt: Date.now() });
}

export async function importFromFile(file: File, password?: string) {
  let r;
  try {
    r = await importBackup(await opened(file, password));
  } catch (e) {
    throw outOfMemory(e) ? new Error(t('data.importTooLarge')) : e;
  }
  await loadConversations();
  await loadFeatureData();
  return r;
}

/** How every encrypted backup starts (the chunked file's header line, or the older JSON wrapper) */
const ENCRYPTED_START = `{"format":${JSON.stringify(ENCRYPTED_BACKUP_FORMAT)}`;

/** The backup file inside a file: the file itself, or what it holds decrypted with the password */
async function opened(file: Blob, password?: string): Promise<Blob> {
  if ((await file.slice(0, ENCRYPTED_START.length).text()) !== ENCRYPTED_START) return file;
  if (!password) throw new BackupPasswordNeeded();
  try {
    const chunked = await readFileHeader(file);
    if (chunked) return await decryptFile(file, chunked, password);
    const wrapped = JSON.parse(await file.text()) as { enc?: EncryptedBlob };
    return new Blob([await decryptSecret(wrapped.enc as EncryptedBlob, password)]);
  } catch (e) {
    // A file this app cannot open says so; anything else is a wrong password or a damaged file
    if (e instanceof UnsupportedBlobError || outOfMemory(e)) throw e;
    throw new Error(t('data.badPassword'));
  }
}

/** Delete this app's data in this browser (including keys in a same-origin key vault) */
export async function wipeEverything() {
  stopAll();
  // Ask the vault to delete first, so keys are removed even if the vault is on another origin
  try {
    await Promise.race([clearAllKeys(), new Promise((r) => setTimeout(r, 3000))]);
  } catch {
    /* Continue even if the vault cannot be reached */
  }
  await repo.wipeAll();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('key-vault');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  location.reload();
}
