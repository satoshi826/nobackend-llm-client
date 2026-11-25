import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ensureHighlighter, isHighlighterReady, renderMarkdown, setSafeHTML } from '../lib/markdown/render';
import { cx } from './ui';
import { t } from './messages';

/** Renders Markdown. This component (setSafeHTML) is the only place that inserts HTML into the DOM. */
export function Markdown({ text, streaming, citations, class: className }: { text: string; streaming?: boolean; citations?: string[]; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hlReady, setHlReady] = useState(isHighlighterReady());

  useEffect(() => {
    if (!streaming && !hlReady && /```/.test(text)) {
      ensureHighlighter().then(() => setHlReady(true));
    }
  }, [streaming, text]);

  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.dataset.raw = text;
    // Do not highlight while streaming (expensive, and the code is incomplete)
    setSafeHTML(ref.current, renderMarkdown(text, { highlight: !streaming && hlReady, citations }));
  }, [text, streaming, hlReady, citations?.join('|')]);

  const onClick = async (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('[data-copy]') as HTMLElement | null;
    if (!btn) return;
    const code = btn.closest('.code-block')?.querySelector('code')?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = t('md.copied');
      setTimeout(() => (btn.textContent = t('md.copy')), 1500);
    } catch {
      btn.textContent = t('md.copyFailed');
    }
  };

  return <div ref={ref} class={cx('md', streaming && 'streaming-caret', className)} onClick={onClick} />;
}
