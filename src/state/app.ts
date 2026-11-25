// Entry point for app state. The UI imports from here (UI-independent lib/ code does not import from here).
import { effect, signal } from '@preact/signals';
import { loadSettings } from './settings';
import { checkLeftoverLocalKeys, connectKeys } from './keys';
import { loadModels, refreshModelsNeedingKey } from './models';
import { keyInfos, vaultState } from './keys';
import { saveSettings, settings } from './settings';
import { loadConversations, startNewChat } from './conversations';
import { restoreRoute } from './router';
import { loadSkills } from './skills';
import { dataLock, initDataLock, setBusyCheck } from './lock';
import { isStreaming } from './generation';

export * from './settings';
export * from './ui';
export * from './keys';
export * from './models';
export * from './conversations';
export * from './generation';
export * from './data';
export * from './skills';
export * from './lock';
export * from './images';
export * from './router';
export * from './tool-registry';

export const ready = signal(false);

export async function init() {
  await loadSettings();
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
    await loadSkills();
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
