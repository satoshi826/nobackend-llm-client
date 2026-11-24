// キー金庫（別オリジンの iframe）と本体アプリの間のメッセージ形式。
// 本体は API キーを一切持たず、「このプロバイダーのキーを付けてこの URL に送って」とだけ依頼する。

import type { KeyStatus, VaultState } from '../keys/accounts';
import { PRESETS } from '../providers/registry';

export const VAULT_PROTOCOL = 'nbl-vault/1';


/** 本体 → 金庫（MessagePort 経由） */
export type ToVault =
  | { type: 'fetch'; id: string; providerId: string; url: string; method: 'GET' | 'POST'; headers: [string, string][]; body?: string }
  | { type: 'abort'; id: string }
  | { type: 'status' }
  /** すべてのキーを削除 / ロック（終わったら ack） */
  | { type: 'clear-all'; id: string }
  | { type: 'lock'; id: string };

/** 金庫 → 本体（MessagePort 経由） */
export type FromVault =
  | { type: 'status'; providers: Record<string, KeyStatus>; vault: VaultState }
  | { type: 'ack'; id: string }
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
export const PASSTHROUGH_HEADERS = [
  ...new Set(['content-type', 'retry-after', 'x-ratelimit-remaining-requests', 'x-ratelimit-remaining-tokens', ...Object.values(PRESETS).flatMap((p) => p.responseHeaders ?? [])].map((h) => h.toLowerCase()))
];
