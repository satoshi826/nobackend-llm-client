// アプリ状態の入口。UI はここから import する（UI 非依存の lib/ からは import しない）。
import { effect, signal } from '@preact/signals';
import { loadSettings } from './settings';
import { checkLeftoverLocalKeys, connectKeys } from './keys';
import { loadModels, refreshModelsNeedingKey } from './models';
import { keyInfos } from './keys';
import { loadConversations, restoreFromHash, startNewChat } from './conversations';
import { loadSkills } from './skills';

export * from './settings';
export * from './ui';
export * from './keys';
export * from './models';
export * from './conversations';
export * from './generation';
export * from './data';
export * from './skills';

export const ready = signal(false);

export async function init() {
  await loadSettings();
  await loadModels();
  await connectKeys();
  await checkLeftoverLocalKeys();
  await loadConversations();
  await loadSkills();
  startNewChat();
  ready.value = true;
  // キーを設定・解錠したら、キーが要るモデル一覧を取る
  effect(() => {
    void keyInfos.value;
    refreshModelsNeedingKey();
  });
  await restoreFromHash();
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }
}
