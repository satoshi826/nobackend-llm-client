import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ensureHighlighter, isHighlighterReady, renderMarkdown, settledEnd } from '../lib/markdown/render';
import { cx } from './ui';
import { t } from './messages';

/** Renders Markdown (as sanitized nodes from renderMarkdown; no HTML string is inserted) */
export function Markdown({ text, streaming, citations, class: className }: { text: string; streaming?: boolean; citations?: string[]; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hlReady, setHlReady] = useState(isHighlighterReady());

  useEffect(() => {
    if (!streaming && !hlReady && /```/.test(text)) {
      ensureHighlighter().then(() => setHlReady(true));
    }
  }, [streaming, text]);

  // While streaming: the source already rendered for good (see settledEnd) and how many child nodes it made
  const settled = useRef<{ src: string; cites: string; nodes: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!streaming) {
      settled.current = null;
      // Do not highlight while streaming (expensive, and the code is incomplete)
      el.replaceChildren(renderMarkdown(text, { highlight: hlReady, citations }));
      return;
    }
    const cites = citations?.join('|') ?? '';
    let s = settled.current;
    if (!s || s.cites !== cites || !text.startsWith(s.src)) {
      el.textContent = '';
      s = settled.current = { src: '', cites, nodes: 0 };
    }
    const render = (src: string) => renderMarkdown(src, { highlight: false, citations });
    while (el.childNodes.length > s.nodes) el.lastChild!.remove();
    const end = settledEnd(text, s.src.length);
    if (end > s.src.length) {
      el.append(render(text.slice(s.src.length, end)));
      s.src = text.slice(0, end);
      s.nodes = el.childNodes.length;
    }
    el.append(render(text.slice(end)));
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
