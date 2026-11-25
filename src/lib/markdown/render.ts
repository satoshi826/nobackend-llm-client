// Markdown → sanitized HTML (TrustedHTML).
// - raw HTML is never rendered (shown escaped)
// - external images are not loaded but replaced with links (prevents data exfiltration via image URLs)
// - links open in a new tab + noopener noreferrer
// - only this module's setSafeHTML() puts HTML into the DOM (Trusted Types policy app-md)
import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';

type Highlighter = (code: string, lang: string) => string | null;
let highlighter: Highlighter | null = null;
let loading: Promise<void> | null = null;

/** Load highlight.js only when needed */
export function ensureHighlighter(): Promise<void> {
  if (highlighter) return Promise.resolve();
  if (!loading) {
    loading = import('./highlight').then((m) => {
      highlighter = m.highlight;
    });
  }
  return loading;
}

export function isHighlighterReady(): boolean {
  return highlighter !== null;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function makeMarked(highlight: boolean): Marked {
  const m = new Marked({ gfm: true, breaks: true });
  m.use({
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag) {
        return escapeHtml(token.text);
      },
      link(this: any, token: Tokens.Link) {
        // Besides the DOMPurify hook, drop anything but safe schemes here too (defence in depth)
        const inner = this.parser.parseInline(token.tokens);
        const href = token.href ?? '';
        if (!/^(https?:|mailto:|#)/i.test(href)) return `<span>${inner}</span>`;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        return `<a href="${escapeHtml(href)}"${title}>${inner}</a>`;
      },
      image(token: Tokens.Image) {
        const label = escapeHtml(token.text || token.title || '画像');
        const href = token.href ?? '';
        if (!/^https?:\/\//i.test(href)) return `<span class="md-img-blocked">[画像: ${label}]</span>`;
        return `<a href="${escapeHtml(href)}" class="md-img-link" title="外部画像は自動で読み込みません">🖼 ${label}</a>`;
      },
      code(token: Tokens.Code) {
        const lang = (token.lang ?? '').trim().split(/\s+/)[0].toLowerCase();
        const raw = token.text;
        let body: string | null = null;
        if (highlight && highlighter) body = highlighter(raw, lang);
        const codeHtml = body ?? escapeHtml(raw);
        const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '<span class="code-lang">text</span>';
        return `<div class="code-block"><div class="code-head">${langLabel}<button type="button" class="code-copy" data-copy>コピー</button></div><pre><code class="hljs">${codeHtml}</code></pre></div>`;
      }
    }
  });
  return m;
}

const markedPlain = makeMarked(false);
const markedHl = makeMarked(true);

// DOMPurify config: make links safe
let hooked = false;
function setupPurify() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') ?? '';
      if (!/^(https?:|mailto:|#)/i.test(href)) node.removeAttribute('href');
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
  });
}

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'a', 'b', 'blockquote', 'br', 'button', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'input',
    'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'
  ],
  ALLOWED_ATTR: ['href', 'title', 'class', 'type', 'checked', 'disabled', 'data-copy', 'align', 'start'],
  ALLOW_DATA_ATTR: false,
  FORBID_ATTR: ['style', 'id', 'name']
};

/** Convert Venice citation markers ^1^ / ^1,2^ into links to the sources */
export function linkCitations(src: string, citations: string[]): string {
  if (!citations.length) return src;
  return src.replace(/\^(\d{1,2}(?:\s*,\s*\d{1,2})*)\^/g, (_m, nums: string) =>
    nums
      .split(',')
      .map((n) => {
        const i = Number(n.trim());
        const url = citations[i - 1];
        if (!url || !/^https?:\/\//i.test(url)) return `[${i}]`;
        // encodeURIComponent does not encode parentheses, so replace them explicitly
        const safe = url.replace(/[()\s<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
        return `[\\[${i}\\]](${safe})`;
      })
      .join('')
  );
}

export function renderMarkdown(src: string, opts: { highlight: boolean; citations?: string[] }): string {
  setupPurify();
  if (opts.citations?.length) src = linkCitations(src, opts.citations);
  // Where DOMPurify is unavailable it returns the input untouched, so escape everything in that case
  if (!DOMPurify.isSupported) return `<pre class="md-fallback">${escapeHtml(src)}</pre>`;
  const html = (opts.highlight ? markedHl : markedPlain).parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string;
}

// ---- Trusted Types ----
type TTPolicy = { createHTML(s: string): any };
let policy: TTPolicy | null | undefined;

function getPolicy(): TTPolicy | null {
  if (policy !== undefined) return policy;
  const tt = (globalThis as any).trustedTypes;
  if (tt?.createPolicy) {
    // Only strings already passed through renderMarkdown reach the policy, but sanitize again here just in case
    policy = tt.createPolicy('app-md', {
      createHTML: (s: string) => DOMPurify.sanitize(s, PURIFY_CONFIG) as unknown as string
    });
  } else {
    policy = null;
  }
  return policy ?? null;
}

/** The only function in the app allowed to use innerHTML */
export function setSafeHTML(el: HTMLElement, sanitizedHtml: string): void {
  try {
    const p = getPolicy();
    (el as any).innerHTML = p ? p.createHTML(sanitizedHtml) : DOMPurify.sanitize(sanitizedHtml, PURIFY_CONFIG);
    // DOMPurify returns an empty string when its internal parsing fails, so fall back to plain text if the result is empty despite having content
    if (!el.innerHTML && el.dataset.raw) throw new Error('sanitized output was empty');
  } catch (e) {
    // Even if insertion fails (e.g. a Trusted Types misconfiguration), always show the content as text
    console.error('[markdown] Could not insert HTML; falling back to plain text', e);
    el.textContent = el.dataset.raw ?? '';
  }
}
