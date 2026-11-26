// HTML shown in the sandbox (sandbox/sandbox.html): its scripts run there, with no origin of its own and no network
import { useLayoutEffect, useRef } from 'preact/hooks';
import { renderInFrame, SANDBOX_FLAGS, SANDBOX_URL } from '../lib/sandbox/client';
import { cx } from './ui';

/** An SVG as a page that centers it on white */
export const svgPage = (svg: string) =>
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#fff}body{display:grid;place-items:center}svg{max-width:100%;max-height:100vh}</style>${svg}`;

export function SandboxFrame({ html, title, class: className }: { html: string; title: string; class?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  // The frame reloads for new html (the page replaces itself with what it is given)
  useLayoutEffect(() => (ref.current ? renderInFrame(ref.current, html) : undefined), [html]);
  return <iframe key={html} ref={ref} sandbox={SANDBOX_FLAGS} src={SANDBOX_URL} title={title} referrerpolicy="no-referrer" class={cx('block w-full rounded-xl border border-line bg-white', className)} />;
}
