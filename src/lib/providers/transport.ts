import type { Transport } from './types';
import { ProviderFailure } from './errors';

/**
 * キーを付けない通信（モデル一覧の取得など）。
 * キーが必要な通信はキー金庫経由でしか送れないので、auth を渡されたら拒否する。
 */
export const plainTransport: Transport = {
  async fetch(url, init, auth) {
    if (auth) throw new ProviderFailure({ kind: 'auth', message: 'キーを付ける通信はキー金庫を経由する必要があります。' });
    return fetch(url, { ...init, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  }
};

export function hostOf(url: string): string {
  return new URL(url).host;
}
