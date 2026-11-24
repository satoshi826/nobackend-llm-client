// 画面の状態（モーダル・トースト・サイドバー）
import { signal } from '@preact/signals';

export type ModalName = 'settings' | 'models' | 'system';
export type SettingsTab = 'connections' | 'chat' | 'search' | 'privacy';

export const modal = signal<ModalName | null>(null);
export const settingsTab = signal<SettingsTab>('connections');
export const sidebarOpen = signal(false);
export const toast = signal<{ text: string; kind: 'info' | 'error' } | null>(null);

/** モデル選択画面の用途: 会話のモデル変更 or 別のモデルで再生成 */
export type ModelPickerTarget = { kind: 'conversation' } | { kind: 'regenerate'; assistantId: string };
export const modelPickerTarget = signal<ModelPickerTarget>({ kind: 'conversation' });

export function openModelPicker(target: ModelPickerTarget = { kind: 'conversation' }) {
  modelPickerTarget.value = target;
  modal.value = 'models';
}

export function openSettings(tab: SettingsTab = 'connections') {
  settingsTab.value = tab;
  modal.value = 'settings';
}

let toastTimer = 0;
export function showToast(text: string, kind: 'info' | 'error' = 'info') {
  toast.value = { text, kind };
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = null), kind === 'error' ? 6000 : 3500);
}
