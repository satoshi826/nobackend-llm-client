import type { Transport } from './types';
import { ProviderFailure } from './errors';

/**
 * Requests without a key (fetching the model list etc.).
 * Requests that need a key can only go through the key vault, so passing auth is rejected.
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
