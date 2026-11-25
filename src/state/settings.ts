// User settings
import { signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import type { Permission } from '../lib/tools/types';

export type { ModelSort, ModelFilter } from '../lib/model-list';
import type { ModelSort, ModelFilter } from '../lib/model-list';

export interface Settings {
  /** Last used model (new chats start with it) */
  lastProviderId: string;
  lastModelId: string;
  defaultSystemPrompt: string;
  /** Sort order and filters of the model list */
  modelSort: ModelSort;
  modelFilters: ModelFilter[];
  theme: 'system' | 'light' | 'dark';
  /** Provider-specific settings (the preset's settings). { [providerId]: { [key]: value } } */
  providerSettings: Record<string, Record<string, boolean>>;
  temperature: number | null;
  lastBackupAt: number | null;
  /** LLM providers in use (if empty, show the screen for choosing a provider first) */
  enabledProviders: string[];
  /** Send previous reasoning (reasoning_content) back to the model */
  resendReasoning: boolean;
  /** Compact automatically when the input exceeds compactThreshold of the context length */
  autoCompact: boolean;
  compactThreshold: number;
  /** Model used for compaction (summarization). 'providerId|modelId'; empty means the conversation's model */
  compactModel: string;
  /** Search method for providers with built-in web search. Providers without built-in search always use tools */
  searchEngine: 'builtin' | 'tools';
  /** Whether the passphrase prompt was shown after the first key was saved (set, or postponed) */
  passphrasePrompted: boolean;
  /** Lock after this many minutes of inactivity (0 disables; only when a passphrase is set) */
  autoLockMinutes: number;
  /** Show reply suggestions after an answer */
  replySuggestions: boolean;
  imageFormat: 'webp' | 'png' | 'jpeg';
  /** Last-used image options (the image mode bar starts from these) */
  imageDefaults: { model: string; aspectRatio: string; resolution: string; variants: number; style: string; negativePrompt: string; enhancePrompt: boolean; seed: string };
  /** Include images in JSON backups (large) */
  backupIncludeImages: boolean;
  /** Let chat models create images with the generate_image tool */
  imageTool: boolean;
  /** Let chat models write and read files (create_file / append_file / edit_file / read_file) */
  fileTools: boolean;
  /** Bookmarked models ('providerId|modelId'), shown together at the top of the model picker */
  favoriteModels: string[];
  /** Number of reply suggestions */
  suggestionCount: number;
  /** Number of recent exchanges sent when generating reply suggestions */
  suggestionTurns: number;
  /** Model used for reply suggestions. 'providerId|modelId'; empty means the conversation's model */
  suggestionModel: string;
  /** Built-in skills that are turned off */
  disabledBuiltinSkills: string[];
  /** Per-tool permission (allow: automatic / ask: confirm every time / deny: forbidden) */
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
  resendReasoning: true,
  autoCompact: false,
  compactThreshold: 0.7,
  compactModel: '',
  searchEngine: 'builtin',
  disabledBuiltinSkills: [],
  passphrasePrompted: false,
  autoLockMinutes: 0,
  favoriteModels: [],
  replySuggestions: true,
  imageFormat: 'webp',
  imageDefaults: { model: '', aspectRatio: '1:1', resolution: '', variants: 1, style: '', negativePrompt: '', enhancePrompt: false, seed: '' },
  backupIncludeImages: false,
  imageTool: false,
  fileTools: true,
  suggestionCount: 3,
  suggestionTurns: 2,
  suggestionModel: '',
  toolPermissions: { web_search: 'ask', fetch_url: 'ask', load_skill: 'allow', generate_image: 'ask', create_file: 'allow', append_file: 'allow', edit_file: 'allow', read_file: 'allow' }
};

export const settings = signal<Settings>(DEFAULT_SETTINGS);

/** Bring stored settings to the current shape (including migration of settings from earlier versions) */
export function migrateSettings(raw: Record<string, unknown>): Settings {
  const { showAnonymized: _a, includeVeniceSystemPrompt: legacyVenicePrompt, ...rest } = raw as Partial<Settings> & {
    showAnonymized?: unknown;
    includeVeniceSystemPrompt?: boolean;
  };
  const stored: Partial<Settings> = rest;
  // Venice-specific settings move to providerSettings
  if (legacyVenicePrompt) stored.providerSettings = { ...stored.providerSettings, venice: { ...stored.providerSettings?.venice, includeSystemPrompt: true } };
  // Search method 'venice' becomes 'builtin'
  if ((stored.searchEngine as string) === 'venice') stored.searchEngine = 'builtin';
  // Venice used to be always enabled. Do not remove it from the settings of people who were using it
  if (!('enabledProviders' in stored) && Object.keys(raw).length) stored.enabledProviders = ['venice'];
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    imageDefaults: { ...DEFAULT_SETTINGS.imageDefaults, ...(stored.imageDefaults ?? {}) },
    toolPermissions: { ...DEFAULT_SETTINGS.toolPermissions, ...(stored.toolPermissions ?? {}) }
  };
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

/** Value of a provider-specific setting (the preset's default if unset) */
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
