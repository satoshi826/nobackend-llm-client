// キーの状態。キーそのものはキー金庫（別ページ）にだけあり、本体は「設定済みか・ロック中か」だけを知る。
import { signal } from '@preact/signals';
import { vault, vaultIsolated } from '../lib/vault/client';
import { EMPTY_KEY_STATUS, type KeyStatus } from '../lib/keys/accounts';
import type { AuthRef } from '../lib/providers/types';
import { showToast } from './ui';

export const keyInfos = signal<Record<string, KeyStatus>>({});

export function keyStatus(id: string): KeyStatus {
  return keyInfos.value[id] ?? EMPTY_KEY_STATUS;
}

/** キーが使える状態（設定済み・解錠済み） */
export function keyReady(id: string): boolean {
  const s = keyStatus(id);
  return s.present && !s.locked;
}

/** 通信にキーを付けてもらう指定（キーが使えないときは undefined＝キーなしで送る） */
export function authFor(id: string): AuthRef | undefined {
  return keyReady(id) ? { keyId: id } : undefined;
}

let subscribed = false;
export async function connectKeys() {
  if (!subscribed) {
    subscribed = true;
    vault.onStatus((st) => (keyInfos.value = st));
  }
  try {
    await vault.requestStatus();
  } catch (e) {
    showToast((e as Error).message, 'error');
  }
}

// ---- 別オリジンの金庫に移った後、本体オリジンに残っている古いキー ----
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
