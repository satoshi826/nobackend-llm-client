import type { Transport } from './types';
import { ProviderFailure } from './errors';

/**
 * 既定の Transport: ブラウザから直接 fetch する。
 * 資格情報（キー）は「登録時に紐づけたホスト」宛てのリクエストにだけ付与する（docs/design.md §5.3-5）。
 * - https 以外へはキーを送らない（localhost の http は例外）
 * - リダイレクトは拒否（別ホストへキーが転送されるのを防ぐ）
 */
export const directTransport: Transport = {
  async fetch(url, init, credential) {
    const headers = new Headers(init.headers);
    if (credential) {
      if (credential.kind === 'vault') throw new ProviderFailure({ kind: 'auth', message: 'キー金庫が使えない状態です。ページを再読み込みしてください。' });
      assertCredentialAllowed(url, credential);
      headers.set('Authorization', `Bearer ${credential.key}`);
    }
    return fetch(url, {
      ...init,
      headers,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store'
    });
  }
};

export function assertCredentialAllowed(url: string, credential: { hosts: string[] }): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ProviderFailure({ kind: 'host-mismatch', message: '接続先 URL が不正です。' });
  }
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal)) {
    throw new ProviderFailure({ kind: 'host-mismatch', message: 'https 以外の接続先には API キーを送信しません。' });
  }
  if (!credential.hosts.includes(u.host)) {
    throw new ProviderFailure({
      kind: 'host-mismatch',
      message: `API キーは ${credential.hosts.join(', ')} 用に登録されています。${u.host} には送信しません。接続先を変更した場合はキーを再登録してください。`
    });
  }
}

export function hostOf(url: string): string {
  return new URL(url).host;
}
