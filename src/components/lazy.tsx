// Code splitting for screens that are not on the first screen (settings, model picker, file manager, ...).
// lazyComponent(() => import('./X').then((m) => m.X)) returns a component that loads its code the first
// time it renders. Extension points and the app shell hold these like any other component.
//
// - While loading: nothing for the first 150 ms (cached chunks arrive sooner), then a small spinner.
// - If loading fails (offline before the chunk was cached, or the app was updated and the old file is gone):
//   a message with a reload button (browsers remember a failed import() of a URL, so only a reload helps).
// - preloadLazyComponents(): loads every registered chunk when the browser is idle after startup,
//   so opening a screen later does not wait for the network.
import { h, type ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Button, Icon, Spinner, cx } from './ui';
import { t } from './messages';

type Loader<P> = () => Promise<ComponentType<P>>;
const starts: (() => Promise<unknown>)[] = [];

export function lazyComponent<P extends object>(load: Loader<P>, opts: { overlay?: boolean; onDismiss?: () => void } = {}): ComponentType<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const start = () =>
    (pending ??= load().then(
      (c) => (loaded = c),
      (e) => {
        pending = null;
        throw e;
      }
    ));
  starts.push(start);

  function Lazy(props: P) {
    const [, setTick] = useState(0);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (loaded) return;
      let alive = true;
      start().then(
        () => alive && setTick((n) => n + 1),
        (e) => {
          console.warn('Could not load a part of the app', e);
          if (alive) setFailed(true);
        }
      );
      return () => {
        alive = false;
      };
    }, []);
    if (loaded) return h(loaded, props);
    if (failed) return <LoadFailed overlay={opts.overlay} onDismiss={opts.onDismiss} />;
    return <Loading overlay={opts.overlay} />;
  }
  return Lazy;
}

/** Loads every lazy chunk in the background (call once the first screen is up) */
export function preloadLazyComponents() {
  const run = () => starts.forEach((s) => s().catch(() => {}));
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2000);
}

function Loading({ overlay }: { overlay?: boolean }) {
  // Shown only when loading takes noticeably long
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShow(true), 150);
    return () => clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <div role="status" aria-label={t('lazy.loading')} class={cx('fade-in grid place-items-center text-muted', overlay ? 'fixed inset-0 z-40 bg-scrim' : 'min-h-24 flex-1')}>
      <Spinner class="size-5" />
    </div>
  );
}

function LoadFailed({ overlay, onDismiss }: { overlay?: boolean; onDismiss?: () => void }) {
  return (
    <div class={cx('grid place-items-center p-4', overlay ? 'fixed inset-0 z-40 bg-scrim' : 'min-h-24 flex-1')}>
      <div role="alert" class={cx('max-w-sm rounded-2xl p-4 text-sm', overlay ? 'panel' : 'border border-line bg-glass')}>
        <p class="flex items-start gap-2 text-ink">
          <Icon name="refresh" class="mt-0.5 size-4 shrink-0 text-muted" />
          {t('lazy.failed')}
        </p>
        <div class="mt-3 flex justify-end gap-2">
          {onDismiss && <Button onClick={onDismiss}>{t('lazy.close')}</Button>}
          <Button variant="primary" onClick={() => location.reload()}>
            {t('lazy.reload')}
          </Button>
        </div>
      </div>
    </div>
  );
}
