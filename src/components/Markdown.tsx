import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { render as renderInto } from 'preact';
import { cx } from './ui';
import { settings } from '../state/settings';
import { CodeRun } from './CodeRun';
import { t } from './messages';

/**
 * The renderer (marked, DOMPurify) is a chunk of its own, fetched from startup on beside the first script rather than
 * in it. The app shows its first screen only once it has settled (App.tsx), so no text is ever shown before it can be
 * rendered; if it could not be loaded (offline before it was cached), texts show as they are
 */
const renderer = signal<typeof import('../lib/markdown/render') | null>(null);
export const markdownSettled = signal(false);
import('../lib/markdown/render')
  .then(
    (m) => (renderer.value = m),
    (e) => console.warn('Could not load the Markdown renderer', e)
  )
  .finally(() => (markdownSettled.value = true));

/** Show or hide the result of a code block's "run" button, right under the block */
function toggleRun(btn: HTMLElement) {
  const block = btn.closest('.code-block');
  if (!block) return;
  const open = block.nextElementSibling?.classList.contains('code-run') ? block.nextElementSibling : null;
  if (open) {
    renderInto(null, open);
    open.remove();
    btn.setAttribute('aria-pressed', 'false');
    return;
  }
  const box = document.createElement('div');
  box.className = 'code-run';
  block.after(box);
  btn.setAttribute('aria-pressed', 'true');
  renderInto(<CodeRun kind={btn.dataset.run as 'html' | 'svg' | 'js'} code={block.querySelector('code')?.textContent ?? ''} />, box);
}

/** Renders Markdown (as sanitized nodes from renderMarkdown; no HTML string is inserted) */
export function Markdown({ text, streaming, citations, class: className }: { text: string; streaming?: boolean; citations?: string[]; class?: string }) {
  const md = renderer.value;
  const ref = useRef<HTMLDivElement>(null);
  const [hlReady, setHlReady] = useState(() => !!md?.isHighlighterReady());

  useEffect(() => {
    if (md && !streaming && !hlReady && /```/.test(text)) {
      md.ensureHighlighter().then(() => setHlReady(true));
    }
  }, [md, streaming, text]);

  // While streaming: the source already rendered for good (see settledEnd) and how many child nodes it made
  const settled = useRef<{ src: string; cites: string; nodes: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!md) {
      el.textContent = text;
      return;
    }
    if (!streaming) {
      settled.current = null;
      // Do not highlight while streaming (expensive, and the code is incomplete)
      el.replaceChildren(md.renderMarkdownCached(text, { highlight: hlReady, citations }));
      return;
    }
    const cites = citations?.join('|') ?? '';
    let s = settled.current;
    if (!s || s.cites !== cites || !text.startsWith(s.src)) {
      el.textContent = '';
      s = settled.current = { src: '', cites, nodes: 0 };
    }
    const render = (src: string) => md.renderMarkdown(src, { highlight: false, citations });
    while (el.childNodes.length > s.nodes) el.lastChild!.remove();
    const end = md.settledEnd(text, s.src.length);
    if (end > s.src.length) {
      el.append(render(text.slice(s.src.length, end)));
      s.src = text.slice(0, end);
      s.nodes = el.childNodes.length;
    }
    el.append(render(text.slice(end)));
  }, [md, text, streaming, hlReady, citations?.join('|')]);

  const onClick = async (e: MouseEvent) => {
    const runBtn = (e.target as HTMLElement).closest('[data-run]') as HTMLElement | null;
    if (runBtn) return toggleRun(runBtn);
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

  return <div ref={ref} class={cx('md', !md && 'whitespace-pre-wrap', streaming && 'streaming-caret', !settings.value.codeRunButtons && 'md-no-run', className)} onClick={onClick} />;
}
