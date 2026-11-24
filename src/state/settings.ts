// ユーザー設定
import { signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import type { Permission } from '../lib/tools/types';

export const DEFAULT_PROVIDER_ID = 'venice';

export interface Settings {
  /** 最後に使ったモデル（新しいチャットはこれで始まる） */
  lastProviderId: string;
  lastModelId: string;
  defaultSystemPrompt: string;
  /** Venice の「外部中継」モデルも一覧に出す */
  showAnonymized: boolean;
  theme: 'system' | 'light' | 'dark';
  includeVeniceSystemPrompt: boolean;
  temperature: number | null;
  lastBackupAt: number | null;
  /** 使う LLM プロバイダー（Venice は常に有効） */
  enabledProviders: string[];
  /** 前回までの思考（reasoning_content）をモデルに送り返す */
  resendReasoning: boolean;
  /** 入力が文脈長の compactThreshold を超えたら自動で圧縮する */
  autoCompact: boolean;
  compactThreshold: number;
  /** 圧縮（要約）に使うモデル。'providerId|modelId'、空なら会話と同じモデル */
  compactModel: string;
  /** Venice での Web 検索の方式。Venice 以外のプロバイダーは常にツール */
  searchEngine: 'venice' | 'tools';
  /** ツールごとの許可（allow: 自動 / ask: 毎回確認 / deny: 禁止） */
  toolPermissions: Record<string, Permission>;
}

export const DEFAULT_SETTINGS: Settings = {
  lastProviderId: DEFAULT_PROVIDER_ID,
  lastModelId: '',
  defaultSystemPrompt: '',
  showAnonymized: false,
  theme: 'system',
  includeVeniceSystemPrompt: false,
  temperature: null,
  lastBackupAt: null,
  enabledProviders: [DEFAULT_PROVIDER_ID],
  resendReasoning: false,
  autoCompact: false,
  compactThreshold: 0.7,
  compactModel: '',
  searchEngine: 'venice',
  toolPermissions: { web_search: 'ask', fetch_url: 'ask' }
};

export const settings = signal<Settings>(DEFAULT_SETTINGS);

export async function loadSettings() {
  const stored = await repo.getSetting<Partial<Settings>>('settings', {});
  settings.value = { ...DEFAULT_SETTINGS, ...stored, toolPermissions: { ...DEFAULT_SETTINGS.toolPermissions, ...(stored.toolPermissions ?? {}) } };
  applyTheme();
}

export async function saveSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  await repo.setSetting('settings', settings.value);
  if ('theme' in patch) applyTheme();
}

export function applyTheme() {
  const t = settings.value.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
