import { useEffect, useRef } from 'preact/hooks';
import { ready } from './state/app';
import { backgroundImage, backgroundOf, GLOW_PRESETS, loadBackgroundImage } from './state/background';
import { uiLang } from './state/settings';
import { dataLock, dataWork } from './state/lock';
import { modal, toast } from './state/ui';
import { LockScreen } from './components/LockScreen';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { lazyComponent } from './components/lazy';
import { SystemPromptModal } from './components/SystemPromptModal';
import { FetchDialog } from './components/FetchDialog';
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

/** The page background behind the glass (Settings → 表示): moving light, a solid colour or the user's picture */
function SkyGlow() {
  const bg = backgroundOf();
  useEffect(() => {
    if (bg.kind === 'image') void loadBackgroundImage();
  }, [bg.kind]);
  // The drift speed changes the running animations' rate, so the light keeps its place (changing the
  // duration instead would make it jump). 0 holds it where it is
  const glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const a of glow.current?.getAnimations({ subtree: true }) ?? []) a.playbackRate = bg.speed;
  }, [bg.speed, bg.kind]);
  if (bg.kind === 'solid') return <div class="sky-glow" aria-hidden="true" style={{ background: bg.color }} />;
  if (bg.kind === 'image' && backgroundImage.value)
    return (
      <div class="sky-glow" aria-hidden="true" style={{ background: `center / cover no-repeat url("${backgroundImage.value}")` }}>
        <div class="absolute inset-0" style={{ background: `color-mix(in srgb, var(--bg) ${Math.round(bg.dim * 100)}%, transparent)` }} />
      </div>
    );
  const p = GLOW_PRESETS[bg.preset] ?? GLOW_PRESETS.moonlight;
  const vars = {
    '--glow-1': p.colors[0],
    '--glow-2': p.colors[1],
    '--glow-3': p.colors[2],
    '--glow-o1': String(p.opacity[0]),
    '--glow-o2': String(p.opacity[1]),
    '--glow-o3': String(p.opacity[2])
  } as Record<string, string>;
  return (
    <div ref={glow} class="sky-glow" aria-hidden="true" style={vars}>
      <span />
      <span />
      <span />
    </div>
  );
}

// Small components of their own for state that changes often (toasts, modals, data work), so a change
// re-renders only them, not the sidebar and the conversation
function DataWork() {
  if (!dataWork.value) return null;
  return (
    <div class="backdrop fixed inset-0 z-[60] grid place-items-center text-sm" role="status" aria-live="polite">
      <div class="panel rise flex items-center gap-2 rounded-2xl px-4 py-3">
        <Spinner class="size-4" />
        {dataWork.value}
      </div>
    </div>
  );
}

function Modals() {
  const m = modal.value;
  return m === 'models' ? <ModelPicker /> : m === 'settings' ? <SettingsModal /> : m === 'system' ? <SystemPromptModal /> : null;
}

function Toast() {
  const toastNow = toast.value;
  if (!toastNow) return null;
  return (
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
  );
}

export function App() {
  // Reading the language here re-renders the whole tree when it changes (messages are read during render)
  void uiLang.value;
  if (!ready.value) {
    return <div class="grid h-full place-items-center text-sm text-muted">{t('app.loading')}</div>;
  }
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
    <div class="relative isolate flex h-full md:gap-3 md:py-3 md:pl-3">
      <SkyGlow />
      <DataWork />
      <Sidebar />
      <MainArea />
      <Modals />
      {overlays.map((O, i) => (
        <O key={i} />
      ))}
      <FetchDialog />
      <ConfirmDialog />
      <Toast />
    </div>
  );
}
