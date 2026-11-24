// ユーザー設定
import { signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import type { Permission } from '../lib/tools/types';

export type { ModelSort, ModelFilter } from '../lib/model-list';
import type { ModelSort, ModelFilter } from '../lib/model-list';

export interface Settings {
  /** 最後に使ったモデル（新しいチャットはこれで始まる） */
  lastProviderId: string;
  lastModelId: string;
  defaultSystemPrompt: string;
  /** モデル一覧の並び順と絞り込み */
  modelSort: ModelSort;
  modelFilters: ModelFilter[];
  theme: 'system' | 'light' | 'dark';
  /** 接続先だけの設定（プリセットの settings）。{ [providerId]: { [key]: value } } */
  providerSettings: Record<string, Record<string, boolean>>;
  temperature: number | null;
  lastBackupAt: number | null;
  /** 使う LLM プロバイダー（空なら最初に接続先を選ぶ画面を出す） */
  enabledProviders: string[];
  /** 前回までの思考（reasoning_content）をモデルに送り返す */
  resendReasoning: boolean;
  /** 入力が文脈長の compactThreshold を超えたら自動で圧縮する */
  autoCompact: boolean;
  compactThreshold: number;
  /** 圧縮（要約）に使うモデル。'providerId|modelId'、空なら会話と同じモデル */
  compactModel: string;
  /** 内蔵の Web 検索を持つ接続先での検索方式。内蔵検索がない接続先は常にツール */
  searchEngine: 'builtin' | 'tools';
  /** ツールごとの許可（allow: 自動 / ask: 毎回確認 / deny: 禁止） */
  toolPermissions: Record<string, Permission>;
}

export const DEFAULT_SETTINGS: Settings = {
  lastProviderId: '',
  lastModelId: '',
  defaultSystemPrompt: '',
  modelSort: 'recommended',
  modelFilters: [],
  theme: 'system',
  providerSettings: {},
  temperature: null,
  lastBackupAt: null,
  enabledProviders: [],
  resendReasoning: false,
  autoCompact: false,
  compactThreshold: 0.7,
  compactModel: '',
  searchEngine: 'builtin',
  toolPermissions: { web_search: 'ask', fetch_url: 'ask', load_skill: 'allow' }
};

export const settings = signal<Settings>(DEFAULT_SETTINGS);

/** 保存されていた設定を今の形にする（以前の版の設定の移行を含む） */
export function migrateSettings(raw: Record<string, unknown>): Settings {
  const { showAnonymized: _a, includeVeniceSystemPrompt: legacyVenicePrompt, ...rest } = raw as Partial<Settings> & {
    showAnonymized?: unknown;
    includeVeniceSystemPrompt?: boolean;
  };
  const stored: Partial<Settings> = rest;
  // Venice 固有の設定は providerSettings へ
  if (legacyVenicePrompt) stored.providerSettings = { ...stored.providerSettings, venice: { ...stored.providerSettings?.venice, includeSystemPrompt: true } };
  // 検索方式 'venice' は 'builtin' へ
  if ((stored.searchEngine as string) === 'venice') stored.searchEngine = 'builtin';
  // 以前は Venice が常に有効だった。使っていた人の設定からは外さない
  if (!('enabledProviders' in stored) && Object.keys(raw).length) stored.enabledProviders = ['venice'];
  return { ...DEFAULT_SETTINGS, ...stored, toolPermissions: { ...DEFAULT_SETTINGS.toolPermissions, ...(stored.toolPermissions ?? {}) } };
}

export async function loadSettings() {
  settings.value = migrateSettings(await repo.getSetting<Record<string, unknown>>('settings', {}));
  applyTheme();
}

export async function saveSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  await repo.setSetting('settings', settings.value);
  if ('theme' in patch) applyTheme();
}

/** 接続先だけの設定の値（未設定ならプリセットの既定値） */
export function providerSettingsOf(providerId: string, defs: { key: string; default: boolean }[] = []): Record<string, boolean> {
  const saved = settings.value.providerSettings[providerId] ?? {};
  return Object.fromEntries(defs.map((d) => [d.key, saved[d.key] ?? d.default]));
}

export async function setProviderSetting(providerId: string, key: string, value: boolean) {
  const all = settings.value.providerSettings;
  await saveSettings({ providerSettings: { ...all, [providerId]: { ...all[providerId], [key]: value } } });
}

export function applyTheme() {
  const t = settings.value.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
