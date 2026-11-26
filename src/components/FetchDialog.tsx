// Shows the fetch page (a separate page, see fetch/main.ts) while an address the model asked for is fetched. The page itself
// asks the user (or remembers a site they allowed) and does the fetching; this only frames it and takes its answer.
import { useEffect, useRef, useState } from 'preact/hooks';
import { FETCH_ORIGIN, fetchPageUrl } from '../lib/fetcher/config';
import type { FetchMode, FromFetcher } from '../lib/fetcher/protocol';
import { fetchRequest, type Fetched } from '../state/fetch-page';
import { Modal } from './ui';
import { t } from './messages';

export function FetchDialog() {
  const req = fetchRequest.value;
  if (!req) return null;
  return <FetchFrame key={req.url + req.mode} url={req.url} mode={req.mode} done={req.done} />;
}

function FetchFrame({ url, mode, done }: { url: string; mode: FetchMode; done(r: Fetched | null): void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(220);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== FETCH_ORIGIN || e.source !== ref.current?.contentWindow) return;
      const m = e.data as FromFetcher;
      if (m?.type === 'fetch-resize' && typeof m.height === 'number') setHeight(Math.min(800, Math.max(120, m.height + 4)));
      if (m?.type === 'fetch-result') done(m.ok ? { name: m.name, mime: m.mime, data: m.data, url: m.url, via: m.via } : null);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const dark = document.documentElement.classList.contains('dark');
  return (
    <Modal title={t('fetchPage.title')} onClose={() => done(null)}>
      <iframe ref={ref} src={fetchPageUrl(url, mode, dark ? 'dark' : 'light')} title={t('fetchPage.title')} referrerpolicy="no-referrer" class="block w-full border-0" style={{ height: `${height}px` }} />
    </Modal>
  );
}
