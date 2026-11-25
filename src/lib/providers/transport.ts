import type { Transport } from './types';
import { ProviderFailure } from './errors';
import { t as tp } from './messages';

/**
 * Requests without a key (fetching the model list etc.).
 * Requests that need a key can only go through the key vault, so passing auth is rejected.
 */
export const plainTransport: Transport = {
  async fetch(url, init, auth) {
    if (auth) throw new ProviderFailure({ kind: 'auth', message: tp('error.keyNeedsVault') });
    return fetch(url, { ...init, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  }
};

export function hostOf(url: string): string {
  return new URL(url).host;
}
