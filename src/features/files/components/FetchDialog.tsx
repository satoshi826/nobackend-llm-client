// Shows the fetch page (a separate page, see fetch/main.ts) while an address the model asked for is fetched. The page itself
// asks the user and does the fetching; this only frames it and takes its answer.
import { useEffect, useRef, useState } from 'preact/hooks';
import { FETCH_ORIGIN, fetchPageUrl } from '../../../lib/fetcher/config';
import type { FromFetcher } from '../../../lib/fetcher/protocol';
import { Modal } from '../../../components/ui';
import { fetchRequest } from '../state';
import { t } from '../messages';

export function FetchDialog() {
  const req = fetchRequest.value;
  if (!req) return null;
  return <FetchFrame key={req.url} url={req.url} done={req.done} />;
}

function FetchFrame({ url, done }: { url: string; done(r: Parameters<NonNullable<typeof fetchRequest.value>['done']>[0]): void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(220);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== FETCH_ORIGIN || e.source !== ref.current?.contentWindow) return;
      const m = e.data as FromFetcher;
      if (m?.type === 'fetch-resize' && typeof m.height === 'number') setHeight(Math.min(800, Math.max(120, m.height + 4)));
      if (m?.type === 'fetch-result') done(m.ok ? { name: m.name, mime: m.mime, data: m.data, url: m.url, relayed: m.relayed } : null);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const dark = document.documentElement.classList.contains('dark');
  return (
    <Modal title={t('fetch.frame')} onClose={() => done(null)}>
      <iframe ref={ref} src={fetchPageUrl(url, dark ? 'dark' : 'light')} title={t('fetch.frame')} referrerpolicy="no-referrer" class="block w-full border-0" style={{ height: `${height}px` }} />
    </Modal>
  );
}
