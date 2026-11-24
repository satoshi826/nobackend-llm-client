// API キーを預かる接続先の一覧（LLM プロバイダー + ツールの外部サービス）。
// キー金庫はここに載っている接続先のキーだけを、ここに書かれたホスト宛てにだけ付けて送る。
// 本体アプリからは変更できない（ビルド時に固定）。
import { PRESETS } from '../providers/registry';
import { SERVICES } from '../tools/services';
import type { ProviderConfig, ProviderPreset } from '../providers/types';

export interface Account {
  id: string;
  label: string;
  /** キーを付けてよいホスト */
  host: string;
  kind: 'llm' | 'tool';
  /** キーなしでも使える（制限付き） */
  keyOptional: boolean;
  keyGuide: string;
  /** キーの確認方法（LLM プロバイダーのみ） */
  preset?: ProviderPreset;
}

function hostOf(url: string): string {
  return new URL(url).host;
}

export const ACCOUNTS: Record<string, Account> = {};
for (const [id, p] of Object.entries(PRESETS)) {
  ACCOUNTS[id] = { id, label: p.label, host: hostOf(p.defaults.baseUrl), kind: 'llm', keyOptional: false, keyGuide: p.keyGuide ?? '', preset: p };
}
for (const [id, s] of Object.entries(SERVICES)) {
  ACCOUNTS[id] = { id, label: s.label, host: hostOf(s.baseUrl), kind: 'tool', keyOptional: s.keyOptional, keyGuide: s.keyGuide };
}

export const ACCOUNT_IDS = Object.keys(ACCOUNTS);

export function accountById(id: string): Account | undefined {
  return ACCOUNTS[id];
}

export function providerConfigOf(id: string): ProviderConfig | undefined {
  const p = PRESETS[id];
  return p ? { id, ...p.defaults } : undefined;
}

/** キーの状態（金庫が本体に知らせる内容。キーそのものは含まない） */
export interface KeyStatus {
  present: boolean;
  /** パスフレーズで暗号化して保存されている */
  encrypted: boolean;
  locked: boolean;
  hosts: string[];
  last4: string;
}

export const EMPTY_KEY_STATUS: KeyStatus = { present: false, encrypted: false, locked: false, hosts: [], last4: '' };

/** 金庫全体の状態（パスフレーズは金庫に 1 つ） */
export interface VaultState {
  hasPassphrase: boolean;
  locked: boolean;
}

export const EMPTY_VAULT_STATE: VaultState = { hasPassphrase: false, locked: false };
