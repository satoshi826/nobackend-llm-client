// Data management (backup, import, delete all)
import * as repo from '../lib/db/repo';
import { exportAll, importAll } from '../lib/db/export';
import { saveSettings, settings } from './settings';
import { loadConversations } from './conversations';
import { loadSkills } from './skills';
import { stopAll } from './generation';
import { clearAllKeys } from './keys';
import { decryptSecret, encryptSecret, type EncryptedBlob } from '../lib/crypto/passphrase';

/** Backup file encrypted with a password (PBKDF2 + AES-GCM, same scheme as the key vault) */
export const ENCRYPTED_BACKUP_FORMAT = 'nobackend-llm-client/export-encrypted';

/** Thrown by importFromFile when the file is encrypted and no password was given */
export class BackupPasswordNeeded extends Error {
  constructor() {
    super('このバックアップはパスワードで暗号化されています。');
  }
}

/** Write a backup file; with a password the whole file is encrypted */
export async function downloadExport(password?: string) {
  const data = await exportAll(settings.value.backupIncludeImages);
  // No indentation: backups with images can be large
  const json = JSON.stringify(data);
  const body = password ? JSON.stringify({ format: ENCRYPTED_BACKUP_FORMAT, version: 1, enc: await encryptSecret(json, password) }) : json;
  const blob = new Blob([body], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nobackend-llm-client-backup-${new Date().toISOString().slice(0, 10)}${password ? '.encrypted' : ''}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  await saveSettings({ lastBackupAt: Date.now() });
}

export async function importFromFile(file: File, password?: string) {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error('JSON として読み込めませんでした。');
  }
  const wrapped = json as { format?: string; enc?: EncryptedBlob };
  if (wrapped?.format === ENCRYPTED_BACKUP_FORMAT) {
    if (!password) throw new BackupPasswordNeeded();
    try {
      json = JSON.parse(await decryptSecret(wrapped.enc as EncryptedBlob, password));
    } catch {
      throw new Error('パスワードが違うか、ファイルが壊れています。');
    }
  }
  const r = await importAll(json);
  await loadConversations();
  await loadSkills();
  return r;
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
