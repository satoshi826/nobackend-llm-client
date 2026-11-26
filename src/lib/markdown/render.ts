// Markdown → sanitized DOM nodes.
// - raw HTML is never rendered (shown escaped)
// - external images are not loaded but replaced with links (prevents data exfiltration via image URLs)
// - links open in a new tab + noopener noreferrer
// - DOMPurify sanitizes once and hands back DOM nodes, so no HTML string is ever parsed into the page
//   (no innerHTML, and no second parse that could change what was sanitized)
import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { t } from './messages';

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
        const label = escapeHtml(token.text || token.title || t('image.alt'));
        const href = token.href ?? '';
        if (!/^https?:\/\//i.test(href)) return `<span class="md-img-blocked">${t('image.blocked', { label })}</span>`;
        return `<a href="${escapeHtml(href)}" class="md-img-link" title="${escapeHtml(t('image.externalTitle'))}">🖼 ${label}</a>`;
      },
      code(token: Tokens.Code) {
        const lang = (token.lang ?? '').trim().split(/\s+/)[0].toLowerCase();
        const raw = token.text;
        let body: string | null = null;
        if (highlight && highlighter) body = highlighter(raw, lang);
        const codeHtml = body ?? escapeHtml(raw);
        const langLabel = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '<span class="code-lang">text</span>';
        return `<div class="code-block"><div class="code-head">${langLabel}<button type="button" class="code-copy" data-copy>${escapeHtml(t('code.copy'))}</button></div><pre><code class="hljs">${codeHtml}</code></pre></div>`;
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

/** Markdown → sanitized nodes ready to insert. Never throws: if anything fails, the source is shown as plain text */
export function renderMarkdown(src: string, opts: { highlight: boolean; citations?: string[] }): DocumentFragment {
  const asText = () => {
    const f = document.createDocumentFragment();
    f.textContent = src;
    return f;
  };
  // Where DOMPurify is unavailable it returns the input untouched, so show the text in that case
  if (!DOMPurify.isSupported) return asText();
  try {
    setupPurify();
    const linked = opts.citations?.length ? linkCitations(src, opts.citations) : src;
    const html = (opts.highlight ? markedHl : markedPlain).parse(linked, { async: false }) as string;
    const nodes = DOMPurify.sanitize(html, { ...PURIFY_CONFIG, RETURN_DOM_FRAGMENT: true });
    // DOMPurify gives nothing back when its own parsing fails
    return nodes.hasChildNodes() || !src.trim() ? nodes : asText();
  } catch (e) {
    console.error('[markdown] Could not render; showing plain text', e);
    return asText();
  }
}

// ---- Streaming ----
const LIST_OR_INDENT = /^(\s|[-*+](\s|$)|\d{1,9}([.)](\s|$)|$))/;

/**
 * While a reply streams in, where the part that later text can no longer change ends: after the last blank line
 * outside a code fence that is followed by the start of a new top-level block (not an indented line or a list item,
 * which could still belong to the block above). `from` is an earlier result, so each call scans only the new text.
 * Rendering the settled part once and only the rest on every update keeps long replies cheap; the finished reply
 * is rendered whole again.
 */
export function settledEnd(src: string, from = 0): number {
  let end = from;
  let fence: RegExp | null = null;
  let blank = -1;
  for (let pos = from; pos < src.length; ) {
    const nl = src.indexOf('\n', pos);
    const line = src.slice(pos, nl < 0 ? src.length : nl);
    if (fence) {
      if (fence.test(line)) fence = null;
    } else if (!line.trim()) {
      if (nl >= 0) blank = nl + 1;
    } else {
      if (blank >= 0 && !LIST_OR_INDENT.test(line)) end = blank;
      blank = -1;
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f) fence = new RegExp(`^ {0,3}${f[1][0] === '`' ? '`' : '~'}{${f[1].length},}\\s*$`);
    }
    if (nl < 0) break;
    pos = nl + 1;
  }
  return end;
}
