// App startup: settings, models, keys, data lock, then the stored data (conversations and features' data).
// UI code imports from the specific state module (or a feature's index.ts), not from here.
import { effect, signal } from '@preact/signals';
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


export const ready = signal(false);

export async function init() {
  await loadSettings();
  await loadFeatureSettings();
  await loadModels();
  await connectKeys();
  await checkLeftoverLocalKeys();
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
