// HTML shown in the sandbox (sandbox/sandbox.html): its scripts run there, with no origin of its own and no network.
// A page that stops answering (an endless loop) is removed, so it cannot keep a CPU busy.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { renderInFrame, SANDBOX_FLAGS, SANDBOX_URL, type SandboxPage } from '../lib/sandbox/client';
import { Button, Icon, cx } from './ui';
import { t } from './messages';

/** An SVG as a page that centers it on white */
export const svgPage = (svg: string) =>
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#fff}body{display:grid;place-items:center}svg{max-width:100%;max-height:100vh}</style>${svg}`;

// A number for each page object, so the render key changes with the page without reading its files
const pageIds = new WeakMap<SandboxPage, number>();
let lastPageId = 0;
function pageId(page: SandboxPage): number {
  if (!pageIds.has(page)) pageIds.set(page, ++lastPageId);
  return pageIds.get(page)!;
}

/** page: the project files the html may use; a new object renders again, so keep the same one while the files stay */
export function SandboxFrame({ html, page, title, class: className }: { html: string; page?: SandboxPage; title: string; class?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [round, setRound] = useState(0);
  // Which render got stuck: new html, a new page or "show again" starts a fresh one
  const key = `${round}:${page ? pageId(page) : 0}:${html}`;
  const [stuckKey, setStuckKey] = useState<string | null>(null);
  const stuck = stuckKey === key;
  // The frame reloads for each render (the page replaces itself with what it is given)
  useLayoutEffect(() => (ref.current && !stuck ? renderInFrame(ref.current, html, () => setStuckKey(key), page) : undefined), [key, stuck]);
  if (stuck)
    return (
      <div class={cx('flex flex-col items-center justify-center gap-2 rounded-xl border border-line bg-sunken p-4 text-center text-xs text-muted', className)}>
        <p>{t('run.stuck')}</p>
        <Button class="text-xs" variant="outline" onClick={() => setRound(round + 1)}>
          <Icon name="refresh" class="size-3.5" />
          {t('run.again')}
        </Button>
      </div>
    );
  return <iframe key={key} ref={ref} sandbox={SANDBOX_FLAGS} src={SANDBOX_URL} title={title} referrerpolicy="no-referrer" class={cx('block w-full rounded-xl border border-line bg-white', className)} />;
}
