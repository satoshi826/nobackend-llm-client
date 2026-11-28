import { describe, expect, it } from 'vitest';
import { checkAddress, composedParts, isLibraryFile, keptLinks, MAX_LINKS, normalizeUrl, seenFrom, urlsIn } from './provenance';
import { parseCheck } from './protocol';

const marked = (href: string, ranges: [number, number][] | undefined) => ranges?.map(([s, e]) => href.slice(s, e));
const check = (url: string, seen: string[]) => checkAddress(new URL(url), seenFrom(seen));

describe('addresses as compared', () => {
  it('lowercases scheme and host, drops the default port and the fragment, keeps path and query', () => {
    expect(normalizeUrl('HTTPS://Example.COM:443/A/b?Q=1#top')).toBe('https://example.com/A/b?Q=1');
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeUrl('https://example.com:8443/x')).toBe('https://example.com:8443/x');
  });
  it('decodes escapes of unreserved characters and writes the others in upper case', () => {
    expect(normalizeUrl('https://a.example/%7euser/%41b?x=%2f%e6%9d%b1')).toBe('https://a.example/~user/Ab?x=%2F%E6%9D%B1');
    expect(normalizeUrl('https://a.example/東京')).toBe(normalizeUrl('https://a.example/%e6%9d%b1%e4%ba%ac'));
  });
  it('takes only http(s) addresses without credentials', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('https://u:p@a.example/')).toBeNull();
    expect(normalizeUrl('not an address')).toBeNull();
  });
  it('finds addresses in running text, without the punctuation after them', () => {
    expect(urlsIn('See https://a.example/x, and (https://b.example/wiki/Foo_(bar)). Also https://c.example/y.')).toEqual([
      'https://a.example/x',
      'https://b.example/wiki/Foo_(bar)',
      'https://c.example/y'
    ]);
    expect(urlsIn('[docs](https://d.example/guide) と https://e.example/page を読んで')).toEqual(['https://d.example/guide', 'https://e.example/page']);
    // Running into Japanese without a space: both ways
    expect(urlsIn('https://f.example/aを読んで')).toEqual([normalizeUrl('https://f.example/aを読んで'), 'https://f.example/a']);
  });
  it('keeps at most MAX_LINKS of a page, each once', () => {
    const many = Array.from({ length: MAX_LINKS + 10 }, (_, i) => `https://a.example/p/${i}#x`);
    const kept = keptLinks([...many, ...many]);
    expect(kept).toHaveLength(MAX_LINKS);
    expect(kept[0]).toBe('https://a.example/p/0');
  });
});

describe('where an address came from', () => {
  const seen = ['https://docs.example/guide/intro?lang=en', 'https://news.example/a'];
  it('lets an address seen in the conversation through as it is, however it is written', () => {
    expect(check('https://DOCS.example:443/guide/intro?lang=en#part', seen)).toBeUndefined();
    expect(check('https://docs.example/guide/%69ntro?lang=en', seen)).toBeUndefined();
  });
  it('marks the parts of a put-together address that no address of its site had', () => {
    const href = 'https://docs.example/guide/setup?lang=en&d=secret';
    const c = check(href, seen);
    expect(marked(href, c?.composed)).toEqual(['setup', 'd=secret']);
    // A site nothing came from: its host too
    const other = 'https://evil.example/collect?d=x';
    expect(marked(other, check(other, seen)?.composed)).toEqual(['evil.example', 'collect', 'd=x']);
  });
  it('asks about a put-together address even when every part was seen somewhere', () => {
    expect(check('https://docs.example/intro/guide', seen)?.composed).toEqual([]);
  });
  it('lets library files on the CDNs through only at an exact version, with no query', () => {
    expect(isLibraryFile(new URL('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js'))).toBe(true);
    expect(isLibraryFile(new URL('https://cdn.jsdelivr.net/npm/@scope/lib@1.2.3-beta.1/dist/x.js'))).toBe(true);
    expect(isLibraryFile(new URL('https://unpkg.com/chart.js@4.4.1/dist/chart.umd.js'))).toBe(true);
    expect(isLibraryFile(new URL('https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js'))).toBe(true);
    expect(isLibraryFile(new URL('https://cdn.jsdelivr.net/npm/three@latest/build/three.module.js'))).toBe(false);
    expect(isLibraryFile(new URL('https://unpkg.com/three'))).toBe(false);
    expect(isLibraryFile(new URL('https://unpkg.com/three@0.170.0/x.js?d=secret'))).toBe(false);
    expect(isLibraryFile(new URL('https://cdn.jsdelivr.example/npm/three@0.170.0/x.js'))).toBe(false);
  });
  it('treats a link as seen only exactly: not a sibling page on the same site', () => {
    const s = seenFrom(['https://shop.example/items/1']);
    expect(composedParts(new URL('https://shop.example/items/1'), s)).toBeNull();
    expect(composedParts(new URL('https://shop.example/items/2'), s)?.map((p) => p.kind)).toEqual(['path']);
  });
});

describe('the check as the fetch page takes it', () => {
  const href = 'https://evil.example/collect?d=x';
  it('takes ranges in order inside the address', () => {
    expect(parseCheck(JSON.stringify({ composed: [[8, 20], [21, 28]] }), href)).toEqual({ composed: [[8, 20], [21, 28]] });
    expect(parseCheck(JSON.stringify({ composed: [] }), href)).toEqual({ composed: [] });
  });
  it('has none without the parameter, and takes one in another shape as a put-together address with nothing marked', () => {
    expect(parseCheck(null, href)).toBeNull();
    for (const bad of ['{', 'null', JSON.stringify({ composed: [[20, 8]] }), JSON.stringify({ composed: [[8, 999]] }), JSON.stringify({ composed: [[10, 20], [8, 9]] })]) expect(parseCheck(bad, href)).toEqual({ composed: [] });
  });
});
