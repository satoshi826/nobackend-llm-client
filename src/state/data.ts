// データ管理（バックアップ・読み込み・全削除）
import * as repo from '../lib/db/repo';
import { exportAll, importAll } from '../lib/db/export';
import { saveSettings } from './settings';
import { loadConversations } from './conversations';
import { stopAll } from './generation';

export async function downloadExport() {
  const data = await exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `nobackend-llm-client-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  await saveSettings({ lastBackupAt: Date.now() });
}

export async function importFromFile(file: File) {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error('JSON として読み込めませんでした。');
  }
  const r = await importAll(json);
  await loadConversations();
  return r;
}

/** このブラウザ内のアプリのデータを消す（同一オリジンのキー金庫のキーも含む） */
export async function wipeEverything() {
  stopAll();
  await repo.wipeAll();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('key-vault');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  location.reload();
}
