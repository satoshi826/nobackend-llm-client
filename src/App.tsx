import { ready } from './state/app';
import { uiLang } from './state/settings';
import { dataLock, dataWork } from './state/lock';
import { modal, toast } from './state/ui';
import { LockScreen } from './components/LockScreen';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { lazyComponent } from './components/lazy';
import { SystemPromptModal } from './components/SystemPromptModal';
import { cx, Spinner } from './components/ui';
import { ConfirmDialog } from './components/ConfirmDialog';
import { mainViews, overlays } from './components/extensions';
import { mainView } from './state/ui';
import { t } from './components/messages';

// Screens that are not on the first screen load their code when first opened (components/lazy.tsx)
const closeModal = () => (modal.value = null);
const ModelPicker = lazyComponent(() => import('./components/ModelPicker').then((m) => m.ModelPicker), { overlay: true, onDismiss: closeModal });
const SettingsModal = lazyComponent(() => import('./components/SettingsModal').then((m) => m.SettingsModal), { overlay: true, onDismiss: closeModal });

/** The chat, or a screen a feature registered (e.g. a file) */
function MainArea() {
  const v = mainView.value;
  const view = v.kind !== 'chat' ? mainViews.find((x) => x.kind === v.kind) : undefined;
  return view ? <view.Component id={v.id} /> : <ChatView />;
}

/** The slow background light behind the glass (styles.css .sky-glow) */
function SkyGlow() {
  return (
    <div class="sky-glow" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

export function App() {
  // Reading the language here re-renders the whole tree when it changes (messages are read during render)
  void uiLang.value;
  if (!ready.value) {
    return <div class="grid h-full place-items-center text-sm text-muted">{t('app.loading')}</div>;
  }
  const toastNow = toast.value;
  if (dataLock.value === 'locked' || dataLock.value === 'lost') {
    return (
      <div class="relative isolate h-full">
        <SkyGlow />
        <LockScreen />
        <ConfirmDialog />
      </div>
    );
  }
  return (
    <div class="relative isolate flex h-full md:gap-3 md:p-3">
      <SkyGlow />
      {dataWork.value && (
        <div class="backdrop fixed inset-0 z-[60] grid place-items-center text-sm" role="status" aria-live="polite">
          <div class="panel rise flex items-center gap-2 rounded-2xl px-4 py-3">
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
      {overlays.map((O, i) => (
        <O key={i} />
      ))}
      <ConfirmDialog />
      {toastNow && (
        <div
          data-live
          role={toastNow.kind === 'error' ? 'alert' : 'status'}
          class={cx(
            'panel rise fixed bottom-28 left-1/2 z-[80] -translate-x-1/2 rounded-2xl px-4 py-2.5 text-sm',
            toastNow.kind === 'error' ? 'text-danger' : 'text-ink-strong'
          )}
        >
          {toastNow.text}
        </div>
      )}
    </div>
  );
}
