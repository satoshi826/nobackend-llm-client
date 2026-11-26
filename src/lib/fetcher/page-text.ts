// A fetched page (fetch/ page, read mode) as plain Markdown-like text for a model to read. HTML is parsed inert by
// DOMPurify (nothing runs, nothing loads) and walked into headings, paragraphs, lists, tables, code and links.
import DOMPurify from 'dompurify';

export interface PageText {
  title: string;
  text: string;
}

/** Most characters of a page handed on (the model that reads it gets this much at most) */
export const MAX_PAGE_CHARS = 60_000;

const DROP = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'svg', 'math', 'canvas', 'video', 'audio', 'form', 'button', 'select', 'textarea', 'input', 'nav', 'aside', 'footer']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'figure', 'figcaption', 'dl', 'dt', 'dd', 'address', 'details', 'summary']);
/** Elements that start a block of their own */
const BLOCKISH = /^(p|div|section|article|main|header|figure|figcaption|dl|dt|dd|address|details|summary|h[1-6]|ul|ol|li|table|pre|blockquote|hr|body|html)$/i;
const hasBlocks = (e: Element) => [...e.children].some((c) => BLOCKISH.test(c.tagName) && !DROP.has(c.tagName.toLowerCase()));

/** Text in the page's own encoding (a meta charset near the top), else UTF-8 */
function decode(data: ArrayBuffer, html: boolean): string {
  const head = html ? new TextDecoder('latin1').decode(data.slice(0, 4096)) : '';
  const label = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  try {
    return new TextDecoder(label || 'utf-8').decode(data);
  } catch {
    return new TextDecoder('utf-8').decode(data);
  }
}

const squash = (s: string) => s.replace(/\s+/g, ' ');

/** Inline text with links as [text](url) (http(s) only, made absolute) */
function inline(node: Node, base: string): string {
  if (node.nodeType === Node.TEXT_NODE) return squash(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROP.has(tag)) return '';
  if (tag === 'br') return '\n';
  if (tag === 'img') {
    const alt = el.getAttribute('alt')?.trim();
    return alt ? `[image: ${squash(alt)}]` : '';
  }
  const inner = [...el.childNodes].map((c) => inline(c, base)).join('');
  if (tag === 'a') {
    try {
      const href = new URL(el.getAttribute('href') ?? '', base);
      if (/^https?:$/.test(href.protocol) && inner.trim()) return `[${inner.trim()}](${href.href})`;
    } catch {
      /* not a link */
    }
  }
  if (tag === 'code') return `\`${inner}\``;
  if (tag === 'strong' || tag === 'b') return inner.trim() ? `**${inner.trim()}**` : '';
  return inner;
}

/** Block-level text, one entry per paragraph, heading, list item, row or code block */
function blocks(el: Element, base: string, out: string[], depth = 0) {
  for (const c of el.childNodes) {
    if (c.nodeType === Node.TEXT_NODE) {
      const t = squash(c.textContent ?? '').trim();
      if (t) out.push(t);
      continue;
    }
    if (c.nodeType !== Node.ELEMENT_NODE) continue;
    const e = c as Element;
    const tag = e.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    const h = /^h([1-6])$/.exec(tag);
    if (h) out.push(`${'#'.repeat(Number(h[1]))} ${inline(e, base).trim()}`);
    else if (tag === 'pre') out.push('```\n' + (e.textContent ?? '').replace(/\n+$/, '') + '\n```');
    else if (tag === 'ul' || tag === 'ol') list(e, base, out, depth);
    else if (tag === 'table') {
      const rows = [...e.querySelectorAll('tr')].map((tr) => [...tr.children].map((cell) => inline(cell, base).trim().replace(/\|/g, '\\|')));
      if (rows.length) {
        out.push(`| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |${rows.slice(1).map((r) => `\n| ${r.join(' | ')} |`).join('')}`);
      }
    } else if (tag === 'blockquote') {
      const inner: string[] = [];
      blocks(e, base, inner, depth);
      out.push(inner.map((l) => `> ${l}`).join('\n'));
    } else if (tag === 'hr') out.push('---');
    else if (BLOCK.has(tag) || tag === 'body' || tag === 'html' || tag === 'li') {
      // A block holding only inline content is one paragraph
      if (hasBlocks(e)) blocks(e, base, out, depth);
      else {
        const t = inline(e, base).trim();
        if (t) out.push(t);
      }
    }
    else {
      const t = inline(e, base).trim();
      if (t) out.push(t);
    }
  }
}

/** A list, one line per item, nested lists indented */
function list(e: Element, base: string, out: string[], depth: number) {
  const ordered = e.tagName.toLowerCase() === 'ol';
  [...e.children].forEach((li, i) => {
    if (li.tagName.toLowerCase() !== 'li') return;
    const nested = [...li.children].filter((x) => /^(ul|ol)$/i.test(x.tagName));
    const own = [...li.childNodes].filter((x) => !nested.includes(x as Element)).map((x) => inline(x, base)).join('').trim();
    out.push(`${'  '.repeat(depth)}${ordered ? `${i + 1}.` : '-'} ${own}`);
    for (const n of nested) list(n, base, out, depth + 1);
  });
}

/** HTML as text: the main / article part when there is one, else the body */
export function htmlToText(html: string, base: string): PageText {
  const title = squash(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim();
  const dom = DOMPurify.sanitize(html, { WHOLE_DOCUMENT: true, RETURN_DOM: true, FORBID_TAGS: [...DROP], KEEP_CONTENT: false }) as HTMLElement;
  const root = dom.querySelector('main, article, [role="main"]') ?? dom.querySelector('body') ?? dom;
  const out: string[] = [];
  blocks(root, base, out);
  const text = out.filter((l) => l.trim()).join('\n\n').replace(/\n{3,}/g, '\n\n');
  return { title: decodeEntities(title), text };
}

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[k as string] ?? m);
}

/**
 * A fetched file as text to read. pdfText reads a PDF (the files feature's extractor, passed in). Kinds that are not
 * text (images, archives, ...) are refused: those are for saving (fetch_file), not reading
 */
export async function pageText(f: { name: string; mime: string; data: ArrayBuffer; url: string }, pdfText: (file: File) => Promise<string>): Promise<PageText> {
  const mime = f.mime.toLowerCase();
  let page: PageText;
  if (mime === 'text/html' || mime === 'application/xhtml+xml') page = htmlToText(decode(f.data, true), f.url);
  else if (mime === 'application/pdf') page = { title: f.name, text: await pdfText(new File([f.data], f.name, { type: mime })) };
  else if (mime.startsWith('text/') || /json|xml|javascript|csv/.test(mime)) {
    const text = decode(f.data, false);
    // Markdown (Jina Reader's answer too) names itself in its first heading
    page = { title: mime === 'text/markdown' ? (/^# (.+)$/m.exec(text)?.[1].trim() ?? '') : '', text };
  }
  else throw new Error(`This is ${mime || 'binary data'}, not text: save it with fetch_file instead of reading it.`);
  const text = page.text.length > MAX_PAGE_CHARS ? `${page.text.slice(0, MAX_PAGE_CHARS)}\n\n[Cut: the first ${MAX_PAGE_CHARS} of ${page.text.length} characters.]` : page.text;
  return { title: page.title, text };
}
