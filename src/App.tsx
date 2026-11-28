import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ready, replacedByAnotherTab, startFailed } from './state/app';
import { diagnosticsText } from './state/diagnostics';
import { tabState, takeOver } from './state/tab';
import { backgroundImage, backgroundOf, GLOW_PRESETS, loadBackgroundImage } from './state/background';
import { uiLang } from './state/settings';
import { dataLock, dataWork } from './state/lock';
import { modal, toast } from './state/ui';
import { LockScreen } from './components/LockScreen';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { lazyComponent } from './components/lazy';
import { FetchDialog, PageFetcher } from './components/FetchDialog';
import { PAGE_WEB } from './lib/fetcher/config';
import { Button, cx, Icon, Spinner } from './components/ui';
import { ConfirmDialog } from './components/ConfirmDialog';
import { mainViews } from './components/extensions';
import { mainView } from './state/ui';
import { lightbox } from './state/media';
import { markdownSettled } from './components/Markdown';
import { t } from './components/messages';
import { t as ts } from './components/settings/messages';

// Screens that are not on the first screen load their code when first opened (components/lazy.tsx)
const closeModal = () => (modal.value = null);
const ModelPicker = lazyComponent(() => import('./components/ModelPicker').then((m) => m.ModelPicker), { overlay: true, onDismiss: closeModal });
const SettingsModal = lazyComponent(() => import('./components/SettingsModal').then((m) => m.SettingsModal), { overlay: true, onDismiss: closeModal });
const SystemPromptModal = lazyComponent(() => import('./components/SystemPromptModal').then((m) => m.SystemPromptModal), { overlay: true, onDismiss: closeModal });
const Lightbox = lazyComponent(() => import('./components/media/Viewer').then((m) => m.Lightbox), { overlay: true, onDismiss: () => (lightbox.value = null) });

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
        'panel rise fixed bottom-28 left-1/2 z-[80] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl px-4 py-2.5 text-sm',
        toastNow.kind === 'error' ? 'text-danger' : 'text-ink-strong'
      )}
    >
      {toastNow.text}
    </div>
  );
}

/** A screen in place of the app, when this tab cannot use its data: what happened, and the way on */
function Stopped({ title, text, children }: { title: string; text: string; children: ComponentChildren }) {
  return (
    <div class="relative isolate grid h-full place-items-center px-6">
      <SkyGlow />
      <div class="w-full max-w-md text-center">
        <h1 class="text-lg font-semibold text-ink-strong">{title}</h1>
        <p class="mt-2 text-sm text-muted">{text}</p>
        {children}
      </div>
    </div>
  );
}

const reloadButton = () => (
  <Button variant="primary" class="mt-4" onClick={() => location.reload()}>
    <Icon name="refresh" />
    {t('app.reload')}
  </Button>
);

/** Another tab uses the data (waiting), or took it over (left): the user can use the app here instead */
function OtherTab({ left }: { left: boolean }) {
  return (
    <Stopped title={t(left ? 'app.leftTitle' : 'app.otherTabTitle')} text={t(left ? 'app.leftText' : 'app.otherTabText')}>
      <Button variant="primary" class="mt-4" onClick={takeOver}>
        <Icon name="swap" />
        {t('app.useHere')}
      </Button>
    </Stopped>
  );
}

/** Starting failed: why, a reload, and the diagnostics to report it with */
function StartFailed({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const copy = async () => {
    const s = await diagnosticsText();
    try {
      await navigator.clipboard.writeText(s);
      setCopied(true);
    } catch {
      // No clipboard (e.g. not allowed): the text is shown to select by hand
      setText(s);
    }
  };
  return (
    <Stopped title={t('app.startFailedTitle')} text={t('app.startFailedText')}>
      <p class="mt-3 rounded-lg bg-sunken px-3 py-2 text-left font-mono text-xs break-words text-ink">{message}</p>
      <div class="flex flex-wrap justify-center gap-2">
        {reloadButton()}
        <Button variant="outline" class="mt-4" onClick={() => void copy()}>
          <Icon name="copy" />
          {ts('about.diagCopy')}
        </Button>
      </div>
      {copied && (
        <p role="status" class="mt-3 text-xs text-muted">
          {ts('about.diagCopied')}
        </p>
      )}
      {text !== null && <textarea readOnly class="mt-3 h-48 w-full rounded-lg bg-sunken p-3 font-mono text-xs text-ink" value={text} />}
    </Stopped>
  );
}

export function App() {
  // Reading the language here re-renders the whole tree when it changes (messages are read during render)
  void uiLang.value;
  // Another tab upgraded the app's data: this tab stopped using it, so nothing is lost by reloading
  if (replacedByAnotherTab.value)
    return (
      <Stopped title={t('app.replacedTitle')} text={t('app.replacedText')}>
        {reloadButton()}
      </Stopped>
    );
  if (tabState.value !== 'active') return <OtherTab left={tabState.value === 'left'} />;
  if (startFailed.value !== null) return <StartFailed message={startFailed.value} />;
  // The Markdown renderer too, so answers never show before they can be rendered (components/Markdown.tsx)
  if (!ready.value || !markdownSettled.value) {
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
    <div class="relative isolate flex h-full pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] md:gap-3 md:py-3 md:pl-[max(0.75rem,env(safe-area-inset-left))]">
      <SkyGlow />
      <DataWork />
      <Sidebar />
      <MainArea />
      <Modals />
      {lightbox.value && <Lightbox />}
      <FetchDialog />
      {PAGE_WEB && <PageFetcher />}
      <ConfirmDialog />
      <Toast />
    </div>
  );
}
