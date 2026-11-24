import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ensureHighlighter, isHighlighterReady, renderMarkdown, setSafeHTML } from '../lib/markdown/render';
import { cx } from './ui';

/** Markdown を描画する。DOM への HTML 挿入はこのコンポーネント（setSafeHTML）だけが行う。 */
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
    // ストリーミング中はハイライトしない（重い・コードが未完成）
    setSafeHTML(ref.current, renderMarkdown(text, { highlight: !streaming && hlReady, citations }));
  }, [text, streaming, hlReady, citations?.join('|')]);

  const onClick = async (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('[data-copy]') as HTMLElement | null;
    if (!btn) return;
    const code = btn.closest('.code-block')?.querySelector('code')?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = 'コピーしました';
      setTimeout(() => (btn.textContent = 'コピー'), 1500);
    } catch {
      btn.textContent = 'コピーできません';
    }
  };

  return <div ref={ref} class={cx('md', streaming && 'streaming-caret', className)} onClick={onClick} />;
}
