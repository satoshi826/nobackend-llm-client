// User settings
import { signal } from '@preact/signals';
import * as repo from '../lib/db/repo';
import { detectLang, getLang, setLang, setLanguageTracker, type Lang } from '../lib/i18n';
import type { Permission } from '../lib/tools/types';

export type { ModelSort, ModelFilter } from '../lib/model-list';
import type { ModelSort, ModelFilter } from '../lib/model-list';
import type { BackgroundSetting } from './background';

export interface Settings {
  /** Last used model (new chats start with it) */
  lastProviderId: string;
  lastModelId: string;
  defaultSystemPrompt: string;
  /** Sort order and filters of the model list */
  modelSort: ModelSort;
  modelFilters: ModelFilter[];
  theme: 'system' | 'light' | 'dark';
  /** Page background (state/background.ts; missing fields take the defaults there) */
  background?: Partial<BackgroundSetting>;
  /** Display language ('auto' follows the browser) */
  language: 'auto' | Lang;
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
  /** Whether the passphrase prompt was shown after the first key was saved (set, or postponed) */
  passphrasePrompted: boolean;
  /** Lock after this many minutes of inactivity (0 disables; only when a passphrase is set) */
  autoLockMinutes: number;
  /** Show reply suggestions after an answer */
  replySuggestions: boolean;
  /** Developer view: show the request bodies sent for each reply (Settings → 情報) */
  developerMode: boolean;
  /** "Run" on html / svg / js code blocks (they run in the sandbox) */
  codeRunButtons: boolean;
  /** HTML / SVG files open as a page (else as code, and the page runs only when asked) */
  htmlFilePreview: boolean;
  /** Include images in JSON backups (large) */
  backupIncludeImages: boolean;
  /** Bookmarked models ('providerId|modelId'), shown together at the top of the model picker */
  favoriteModels: string[];
  /** Number of reply suggestions */
  suggestionCount: number;
  /** Number of recent exchanges sent when generating reply suggestions */
  suggestionTurns: number;
  /** Model used for reply suggestions. 'providerId|modelId'; empty means the conversation's model */
  suggestionModel: string;
  /** Per-tool permission (allow: automatic / ask: confirm every time / deny: forbidden) */
  toolPermissions: Record<string, Permission>;
}

export const DEFAULT_SETTINGS: Settings = {
  lastProviderId: '',
  lastModelId: '',
  defaultSystemPrompt: '',
  modelSort: 'recommended',
  modelFilters: [],
  theme: 'dark',
  language: 'auto',
  providerSettings: {},
  temperature: null,
  lastBackupAt: null,
  enabledProviders: [],
  resendReasoning: true,
  autoCompact: false,
  compactThreshold: 0.7,
  compactModel: '',
  passphrasePrompted: false,
  autoLockMinutes: 0,
  favoriteModels: [],
  replySuggestions: true,
  developerMode: false,
  codeRunButtons: true,
  htmlFilePreview: true,
  backupIncludeImages: false,
  suggestionCount: 3,
  suggestionTurns: 2,
  suggestionModel: '',
  toolPermissions: { web_search: 'allow', fetch_url: 'ask', load_skill: 'allow', generate_image: 'ask', run_javascript: 'ask' }
};

export const settings = signal<Settings>(DEFAULT_SETTINGS);

/** Stored settings over the defaults (tool permissions merged one by one) */
export function settingsFrom(stored: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...stored, toolPermissions: { ...DEFAULT_SETTINGS.toolPermissions, ...(stored.toolPermissions ?? {}) } };
}

export async function loadSettings() {
  settings.value = settingsFrom(await repo.getSetting<Partial<Settings>>('settings', {}));
  applyTheme();
  applyLanguage();
}

export async function saveSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  await repo.setSetting('settings', settings.value);
  if ('theme' in patch) applyTheme();
  if ('language' in patch) applyLanguage();
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

/** The language in use; components that render text depend on it through the app root */
export const uiLang = signal<Lang>(getLang());
// Every piece of text read during a render subscribes that component to the language
setLanguageTracker(() => void uiLang.value);

export function applyLanguage() {
  const l = settings.value.language === 'auto' ? detectLang() : settings.value.language;
  setLang(l);
  uiLang.value = l;
  document.documentElement.lang = l;
}

/** Dark only for now: the light theme is not offered (the stored setting is kept for when it comes back) */
export const DARK_ONLY = true;

export function applyTheme() {
  const t = settings.value.theme;
  const dark = DARK_ONLY || t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
