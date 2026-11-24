import { modal, ready, toast } from './state/app';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { ModelPicker } from './components/ModelPicker';
import { SettingsModal, PrivacyModal } from './components/SettingsModal';
import { SystemPromptModal } from './components/SystemPromptModal';
import { cx } from './components/ui';
import { ConfirmDialog } from './components/ConfirmDialog';

export function App() {
  if (!ready.value) {
    return <div class="grid h-full place-items-center text-sm text-zinc-500">読み込み中…</div>;
  }
  const t = toast.value;
  return (
    <div class="flex h-full">
      <Sidebar />
      <ChatView />
      {modal.value === 'models' && <ModelPicker />}
      {modal.value === 'settings' && <SettingsModal />}
      {modal.value === 'privacy' && <PrivacyModal />}
      {modal.value === 'system' && <SystemPromptModal />}
      <ConfirmDialog />
      {t && (
        <div
          role="status"
          class={cx(
            'fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg',
            t.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
          )}
        >
          {t.text}
        </div>
      )}
    </div>
  );
}
