// App startup: settings, models, keys, data lock, then the stored data (conversations and features' data).
// UI code imports from the specific state module (or a feature's index.ts), not from here.
import { effect, signal } from '@preact/signals';
import { onDatabaseReplaced } from '../lib/db/schema';
import { loadSettings } from './settings';
import { loadFeatureSettings } from './feature-settings';
import { checkLeftoverLocalKeys, connectKeys } from './keys';
import { loadModels, refreshModelsNeedingKey } from './models';
import { keyInfos, vaultState } from './keys';
import { saveSettings, settings } from './settings';
import { loadConversations, startNewChat } from './conversations';
import { restoreRoute } from './router';
import { loadFeatureData } from './lifecycle';
import { dataLock, initDataLock, setBusyCheck } from './lock';
import { isStreaming } from './runs';
import { holdData, tabState } from './tab';


export const ready = signal(false);
/** Starting failed: the error's message (the app shows it, with a reload, instead of loading forever) */
export const startFailed = signal<string | null>(null);
/** Another tab upgraded (or deleted) the database: this tab stopped using it and has to be reloaded */
export const replacedByAnotherTab = signal(false);
onDatabaseReplaced(() => (replacedByAnotherTab.value = true));

export async function init() {
  try {
    if (!(await holdData())) {
      tabState.value = 'waiting';
      return;
    }
    await start();
  } catch (e) {
    console.error('Initialization failed', e);
    startFailed.value = String((e as Error)?.message ?? e);
  }
}

async function start() {
  // The vault page loads in its frame while the stored data is read (it is awaited before the first screen,
  // which depends on whether keys are set)
  const keys = connectKeys();
  await loadSettings();
  await Promise.all([loadFeatureSettings(), loadModels()]);
  void checkLeftoverLocalKeys();
  // Read the URL first: startNewChat() clears it, and a reload should reopen the conversation that was open
  const openHash = location.hash;
  // If conversations are encrypted, do not load them until unlocked (show the lock screen)
  let loaded = false;
  const loadData = async () => {
    if (loaded) return;
    loaded = true;
    await loadConversations();
    await loadFeatureData();
    startNewChat();
    await restoreRoute(openHash);
  };
  await initDataLock(loadData);
  setBusyCheck(() => isStreaming.value);
  if (dataLock.value === 'none') await loadData();
  await keys;
  ready.value = true;
  // Once a key is set or unlocked, fetch the model lists that require a key
  effect(() => {
    void keyInfos.value;
    refreshModelsNeedingKey();
  });
  // Once a passphrase is set (from the prompt or from settings), stop prompting for it
  effect(() => {
    if (vaultState.value.hasPassphrase && !settings.peek().passphrasePrompted) void saveSettings({ passphrasePrompted: true });
  });
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}
