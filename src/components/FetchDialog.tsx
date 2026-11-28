// Shows the fetch page (a separate page, see fetch/main.ts): while an address the model asked for is fetched, or with its
// own settings open. The page itself asks the user, fetches and keeps its settings; this only frames it and takes its answer.
import { useEffect, useRef, useState } from 'preact/hooks';
import { FETCH_ORIGIN, fetchPageUrl } from '../lib/fetcher/config';
import { FETCH_HELLO, type Fetched, type FromFetcher } from '../lib/fetcher/protocol';
import { fetchRequest, fetchSettingsOpen, pageFetcher, pageFetcherAnswer, pageFetcherAsking, pageFetcherReady } from '../state/fetch-page';
import { Modal, cx } from './ui';
import { t } from './messages';

/** A fetch in progress, else the fetch page's settings (the Jina Reader key, the sites not asked about) when open */
export function FetchDialog() {
  const req = fetchRequest.value;
  if (req) return <FetchFrame key={req.url + req.mode} title={t('fetchPage.title')} src={fetchPageUrl({ url: req.url, mode: req.mode, check: req.check })} done={req.done} />;
  if (fetchSettingsOpen.value) return <FetchFrame key="settings" title={t('fetchPage.settings')} src={fetchPageUrl({ view: 'settings' })} done={() => (fetchSettingsOpen.value = false)} />;
  return null;
}

/** done: the fetched file, or null when the user cancels or closes */
function FetchFrame({ title, src, done }: { title: string; src: string; done(r: Fetched | null): void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(220);
  // done may change identity every render: the page's answer goes to the latest one
  const answer = useRef(done);
  answer.current = done;
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== FETCH_ORIGIN || e.source !== ref.current?.contentWindow) return;
      const m = e.data as FromFetcher;
      if (m?.type === 'fetch-resize' && typeof m.height === 'number') setHeight(Math.min(800, Math.max(120, m.height + 4)));
      if (m?.type === 'fetch-result') {
        const { type: _type, ...r } = m;
        answer.current(r);
      }
      if (m?.type === 'fetch-close') answer.current(null);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  // Bare: the frame shrinks to the room the dialog has and the page scrolls inside it, where its controls are (a dialog
  // body scrolling around a frame has nothing of its own to focus)
  return (
    <Modal title={title} onClose={() => done(null)} bare>
      <iframe
        ref={ref}
        src={src}
        title={title}
        referrerpolicy="no-referrer"
        class="m-5 block min-h-0 border-0"
        style={{ height: `${height}px` }}
        onLoad={() => ref.current?.contentWindow?.postMessage(FETCH_HELLO, FETCH_ORIGIN)}
      />
    </Modal>
  );
}

/**
 * The fetch page that takes the shown pages' requests (experimental, PAGE_WEB): it stays open while any waits, out of
 * sight until it asks the user. Never remounted while open, so its queue and its questions stay
 */
export function PageFetcher() {
  const state = pageFetcher.value;
  return state ? <PageFetchFrame asking={state.asking} /> : null;
}

function PageFetchFrame({ asking }: { asking: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(220);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== FETCH_ORIGIN || e.source !== ref.current?.contentWindow) return;
      const m = e.data as FromFetcher;
      if (m?.type === 'fetch-resize' && typeof m.height === 'number') setHeight(Math.min(800, Math.max(120, m.height + 4)));
      else if (m?.type === 'page-asking') pageFetcherAsking(!!m.asking);
      else if (m?.type === 'page-result' && typeof m.id === 'string') {
        const { type: _type, id, ...r } = m;
        pageFetcherAnswer(id, r);
      } else if (m?.type === 'page-error' && typeof m.id === 'string') pageFetcherAnswer(m.id, { error: String(m.message) });
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  // Keys go to the question (Esc declines it there)
  useEffect(() => {
    if (asking) ref.current?.focus();
  }, [asking]);
  const title = t('fetchPage.title');
  return (
    <div class={asking ? 'backdrop fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-4' : 'invisible fixed size-0 overflow-hidden'}>
      {/* Laid out like Modal, which cannot be used: it would remount the frame each time it shows */}
      <div role="dialog" aria-modal={asking} aria-label={title} class={cx(asking && 'frosted rise-glass flex max-h-[92dvh] w-full flex-col rounded-t-[22px] sm:max-w-lg sm:rounded-[22px]')}>
        {asking && (
          <div class="border-b border-line px-5 py-3">
            <h2 class="font-semibold text-ink-strong">{title}</h2>
          </div>
        )}
        <div class={cx(asking && 'scroll-thin min-h-0 flex-1 overflow-y-auto p-5')}>
          <iframe
            ref={ref}
            src={fetchPageUrl({ mode: 'page' })}
            title={title}
            referrerpolicy="no-referrer"
            class="block w-full border-0"
            style={{ height: `${height}px` }}
            onLoad={() => {
              const win = ref.current?.contentWindow;
              if (!win) return;
              win.postMessage(FETCH_HELLO, FETCH_ORIGIN);
              pageFetcherReady((m) => win.postMessage(m, FETCH_ORIGIN));
            }}
          />
        </div>
      </div>
    </div>
  );
}
