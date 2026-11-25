import { dataLock, dataWork, modal, ready, toast } from './state/app';
import { LockScreen } from './components/LockScreen';
import { Lightbox } from './components/ImageView';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { ModelPicker } from './components/ModelPicker';
import { SettingsModal } from './components/SettingsModal';
import { SystemPromptModal } from './components/SystemPromptModal';
import { cx, Spinner } from './components/ui';
import { ConfirmDialog } from './components/ConfirmDialog';
import { mainViews } from './components/extensions';
import { mainView } from './state/app';

/** The chat, or a screen a feature registered (e.g. a file) */
function MainArea() {
  const v = mainView.value;
  const view = v.kind !== 'chat' ? mainViews.find((x) => x.kind === v.kind) : undefined;
  return view ? <view.Component id={v.id} /> : <ChatView />;
}

export function App() {
  if (!ready.value) {
    return <div class="grid h-full place-items-center text-sm text-zinc-500">読み込み中…</div>;
  }
  const t = toast.value;
  if (dataLock.value === 'locked' || dataLock.value === 'lost') {
    return (
      <div class="h-full">
        <LockScreen />
        <ConfirmDialog />
      </div>
    );
  }
  return (
    <div class="flex h-full">
      {dataWork.value && (
        <div class="fixed inset-0 z-[60] grid place-items-center bg-white/80 text-sm dark:bg-zinc-950/80" role="status" aria-live="polite">
          <div class="flex items-center gap-2 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-zinc-900">
            <Spinner class="size-4" />
            {dataWork.value}
          </div>
        </div>
      )}
      <Sidebar />
      <MainArea />
      {modal.value === 'models' && <ModelPicker />}
      {modal.value === 'settings' && <SettingsModal />}
      {modal.value === 'system' && <SystemPromptModal />}
      <Lightbox />
      <ConfirmDialog />
      {t && (
        <div
          data-live
          role={t.kind === 'error' ? 'alert' : 'status'}
          class={cx(
            'fixed bottom-24 left-1/2 z-[80] -translate-x-1/2 rounded-lg px-4 py-2 text-sm shadow-lg',
            t.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
          )}
        >
          {t.text}
        </div>
      )}
    </div>
  );
}
