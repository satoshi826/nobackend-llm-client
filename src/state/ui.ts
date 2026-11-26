// Screen state (modals, toasts, sidebar)
import { signal } from '@preact/signals';

export type ModalName = 'settings' | 'models' | 'system';
/** Core tabs, or the id of a tab a feature registered */
export type SettingsTab = 'connections' | 'chat' | 'appearance' | 'features' | 'privacy' | 'about' | (string & {});

export const modal = signal<ModalName | null>(null);
/** What the main area shows: the chat, or a screen registered by a feature (e.g. { kind: 'files' }, { kind: 'file', id }) */
export type MainViewState = { kind: string; id?: string };
export const mainView = signal<MainViewState>({ kind: 'chat' });
/** Selected sidebar tab ('chats' or a feature's tab id) */
export const sidebarTab = signal('chats');
export const settingsTab = signal<SettingsTab>('connections');
export const sidebarOpen = signal(false);
/** Text in the input box (filled when a reply suggestion is clicked) */
export const composerText = signal('');
/** Signal to move focus to the input box (moves each time the value changes) */
export const composerFocus = signal(0);
export const toast = signal<{ text: string; kind: 'info' | 'error' } | null>(null);

/** Purpose of the model picker: change the conversation's model, or regenerate with another model */
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
