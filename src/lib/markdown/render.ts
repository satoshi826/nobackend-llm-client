// Markdown → サニタイズ済み HTML（TrustedHTML）。
// - 生 HTML は描画しない（エスケープして表示）
// - 外部画像は読み込まず、リンクに置き換える（画像 URL による情報持ち出し対策）
// - リンクは新しいタブ + noopener noreferrer
// - DOM に入れるのはこのモジュールの setSafeHTML() だけ（Trusted Types ポリシー app-md）
import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';

type Highlighter = (code: string, lang: string) => string | null;
let highlighter: Highlighter | null = null;
let loading: Promise<void> | null = null;

/** highlight.js を必要になったときだけ読み込む */
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
        // DOMPurify のフックに加えて、ここでも安全なスキーム以外を落とす（多層防御）
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

// DOMPurify の設定: リンクを安全化
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

/** Venice の引用マーカー ^1^ / ^1,2^ を出典へのリンクに変換する */
export function linkCitations(src: string, citations: string[]): string {
  if (!citations.length) return src;
  return src.replace(/\^(\d{1,2}(?:\s*,\s*\d{1,2})*)\^/g, (_m, nums: string) =>
    nums
      .split(',')
      .map((n) => {
        const i = Number(n.trim());
        const url = citations[i - 1];
        if (!url || !/^https?:\/\//i.test(url)) return `[${i}]`;
        // encodeURIComponent は括弧を符号化しないので明示的に置換する
        const safe = url.replace(/[()\s<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
        return `[\\[${i}\\]](${safe})`;
      })
      .join('')
  );
}

export function renderMarkdown(src: string, opts: { highlight: boolean; citations?: string[] }): string {
  setupPurify();
  if (opts.citations?.length) src = linkCitations(src, opts.citations);
  // DOMPurify が使えない環境では素通しで返されてしまうため、その場合は全部エスケープする
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
    // ポリシーに渡ってくるのは renderMarkdown 済みの文字列だけだが、念のためここでも再度サニタイズする
    policy = tt.createPolicy('app-md', {
      createHTML: (s: string) => DOMPurify.sanitize(s, PURIFY_CONFIG) as unknown as string
    });
  } else {
    policy = null;
  }
  return policy ?? null;
}

/** アプリ内で innerHTML を使ってよい唯一の関数 */
export function setSafeHTML(el: HTMLElement, sanitizedHtml: string): void {
  try {
    const p = getPolicy();
    (el as any).innerHTML = p ? p.createHTML(sanitizedHtml) : DOMPurify.sanitize(sanitizedHtml, PURIFY_CONFIG);
    // DOMPurify は内部の解析に失敗すると空文字を返すため、本文があるのに空ならテキスト表示にする
    if (!el.innerHTML && el.dataset.raw) throw new Error('sanitized output was empty');
  } catch (e) {
    // Trusted Types の設定ミス等で挿入できない場合でも、内容はテキストとして必ず表示する
    console.error('[markdown] HTML を挿入できなかったためテキスト表示に切り替えます', e);
    el.textContent = el.dataset.raw ?? '';
  }
}
