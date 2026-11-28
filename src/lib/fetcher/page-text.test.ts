// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fileLinks, htmlToText, MAX_PAGE_CHARS, pageText } from './page-text';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('page text', () => {
  it('reads the main part of a page as Markdown-like text, without scripts or navigation', () => {
    const html = `<html><head><title>Shop &amp; Co</title><script>steal()</script></head><body>
      <nav><a href="/">Home</a></nav>
      <main><h1>Opening hours</h1><p>Open <strong>9–17</strong>, see <a href="/map">the map</a>.</p>
      <ul><li>Mon</li><li>Tue<ul><li>late</li></ul></li></ul>
      <table><tr><th>Item</th><th>Price</th></tr><tr><td>Tea</td><td>3</td></tr></table>
      <pre>code  here</pre></main><footer>© 2026</footer></body></html>`;
    const p = htmlToText(html, 'https://shop.example/about');
    expect(p.title).toBe('Shop & Co');
    expect(p.text).toContain('# Opening hours');
    expect(p.text).toContain('Open **9–17**, see [the map](https://shop.example/map).');
    expect(p.text).toContain('- Mon\n\n- Tue\n\n  - late');
    expect(p.text).toContain('| Item | Price |\n| --- | --- |\n| Tea | 3 |');
    expect(p.text).toContain('```\ncode  here\n```');
    expect(p.text).not.toMatch(/steal|Home|© 2026/);
  });
  it('keeps the links of the whole page, absolute against where it came from, http(s) only, each once', () => {
    const html = `<html><body><nav><a href="/">Home</a> <a href="/docs/">Docs</a></nav>
      <main><p><a href="setup#install">Setup</a> <a href="setup">again</a> <a href="mailto:a@b.example">mail</a> <a href="javascript:x()">js</a></p>
      <p style="display:none"><a href="https://other.example/x?y=1">hidden</a></p><img src="/img.png"></main><footer><a href="http://old.example/">old</a></footer></body></html>`;
    expect(htmlToText(html, 'https://shop.example/guide/').links).toEqual([
      'https://shop.example/',
      'https://shop.example/docs/',
      'https://shop.example/guide/setup',
      'https://other.example/x?y=1',
      'http://old.example/'
    ]);
  });
  it('takes the addresses written in a text as its links, for reading and for saving', async () => {
    const md = bytes('# Mock\n\nSee [the guide](https://a.example/guide) and https://b.example/p.');
    expect((await pageText({ name: 'm.md', mime: 'text/markdown', data: md, url: 'https://x/' }, async () => '')).links).toEqual(['https://a.example/guide', 'https://b.example/p']);
    expect(fileLinks({ name: 'm.md', mime: 'text/markdown', data: md, url: 'https://x/' })).toEqual(['https://a.example/guide', 'https://b.example/p']);
    expect(fileLinks({ name: 'i.html', mime: 'text/html', data: bytes('<a href="/n">n</a>'), url: 'https://x.example/a/' })).toEqual(['https://x.example/n']);
    expect(fileLinks({ name: 'a.png', mime: 'image/png', data: bytes('https://a.example/'), url: 'https://x/a.png' })).toEqual([]);
  });
  it('reads text as is, refuses what is not text, and caps the length', async () => {
    const pdf = async () => 'pdf text';
    expect((await pageText({ name: 'a.txt', mime: 'text/plain', data: bytes('hello'), url: 'https://x/a.txt' }, pdf)).text).toBe('hello');
    expect((await pageText({ name: 'm.md', mime: 'text/markdown', data: bytes('# Mock title\n\nbody'), url: 'https://x/' }, pdf)).title).toBe('Mock title');
    expect((await pageText({ name: 'a.pdf', mime: 'application/pdf', data: bytes('%PDF'), url: 'https://x/a.pdf' }, pdf)).text).toBe('pdf text');
    await expect(pageText({ name: 'a.png', mime: 'image/png', data: bytes('x'), url: 'https://x/a.png' }, pdf)).rejects.toThrow(/fetch_file/);
    const long = await pageText({ name: 'b.txt', mime: 'text/plain', data: bytes('x'.repeat(MAX_PAGE_CHARS + 10)), url: 'https://x/b.txt' }, pdf);
    expect(long.text).toMatch(/\[Cut: the first/);
  });

  it('reads a crafted page in one pass (no backtracking on unclosed tags)', () => {
    const t0 = Date.now();
    const page = htmlToText('<title'.repeat(300_000), 'https://a.example/');
    expect(page.title).toBe('');
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
