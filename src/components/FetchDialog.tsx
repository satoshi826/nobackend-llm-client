// Shows the fetch page (a separate page, see fetch/main.ts): while an address the model asked for is fetched, or with its
// own settings open. The page itself asks the user, fetches and keeps its settings; this only frames it and takes its answer.
import { useEffect, useRef, useState } from 'preact/hooks';
import { FETCH_ORIGIN, fetchPageUrl, fetchSettingsUrl } from '../lib/fetcher/config';
import { FETCH_HELLO, type FromFetcher } from '../lib/fetcher/protocol';
import { fetchRequest, fetchSettingsOpen, type Fetched } from '../state/fetch-page';
import { Modal } from './ui';
import { t } from './messages';

const theme = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

/** A fetch in progress, else the fetch page's settings (the Jina Reader key, the sites not asked about) when open */
export function FetchDialog() {
  const req = fetchRequest.value;
  if (req) return <FetchFrame key={req.url + req.mode} title={t('fetchPage.title')} src={fetchPageUrl(req.url, req.mode, theme())} done={req.done} />;
  if (fetchSettingsOpen.value) return <FetchFrame key="settings" title={t('fetchPage.settings')} src={fetchSettingsUrl(theme())} done={() => (fetchSettingsOpen.value = false)} />;
  return null;
}

/** done: the fetched file, or null when the user cancels or closes */
function FetchFrame({ title, src, done }: { title: string; src: string; done(r: Fetched | null): void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(220);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== FETCH_ORIGIN || e.source !== ref.current?.contentWindow) return;
      const m = e.data as FromFetcher;
      if (m?.type === 'fetch-resize' && typeof m.height === 'number') setHeight(Math.min(800, Math.max(120, m.height + 4)));
      if (m?.type === 'fetch-result') done(m.ok ? { name: m.name, mime: m.mime, data: m.data, url: m.url, via: m.via } : null);
      if (m?.type === 'fetch-close') done(null);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  return (
    <Modal title={title} onClose={() => done(null)}>
      <iframe
        ref={ref}
        src={src}
        title={title}
        referrerpolicy="no-referrer"
        class="block w-full border-0"
        style={{ height: `${height}px` }}
        onLoad={() => ref.current?.contentWindow?.postMessage(FETCH_HELLO, FETCH_ORIGIN)}
      />
    </Modal>
  );
}
