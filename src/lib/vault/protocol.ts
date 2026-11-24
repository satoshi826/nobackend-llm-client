// キー金庫（別オリジンの iframe）と本体アプリの間のメッセージ形式。
// 本体は API キーを一切持たず、「このプロバイダーのキーを付けてこの URL に送って」とだけ依頼する。

import type { KeyStatus } from '../keys/accounts';

export const VAULT_PROTOCOL = 'nbl-vault/1';


/** 本体 → 金庫（MessagePort 経由） */
export type ToVault =
  | { type: 'fetch'; id: string; providerId: string; url: string; method: 'GET' | 'POST'; headers: [string, string][]; body?: string }
  | { type: 'abort'; id: string }
  | { type: 'status' };

/** 金庫 → 本体（MessagePort 経由） */
export type FromVault =
  | { type: 'status'; providers: Record<string, KeyStatus> }
  | { type: 'head'; id: string; status: number; statusText: string; headers: [string, string][] }
  | { type: 'chunk'; id: string; chunk: Uint8Array }
  | { type: 'end'; id: string }
  | { type: 'error'; id: string; kind: string; message: string };

/** 接続開始（window.postMessage、ports[0] に MessagePort を渡す） */
export interface ConnectMessage {
  type: 'connect';
  protocol: typeof VAULT_PROTOCOL;
}

/** 金庫の画面（キー入力・解錠）→ 親ウィンドウ。iframe の高さ合わせ用 */
export interface ResizeMessage {
  type: 'vault-resize';
  height: number;
}

/** 金庫が中継してよいレスポンスヘッダ（キーや Cookie に関わるものは返さない） */
export const PASSTHROUGH_HEADERS = ['content-type', 'retry-after', 'x-venice-balance-usd', 'x-venice-balance-diem', 'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens'];
