import { describe, expect, it } from 'vitest';
import { checkAddress, composedParts, contentIn, isLibraryFile, keptLinks, MAX_LINKS, normalizeUrl, seenFrom, urlsIn, type Content } from './provenance';
import { parseCheck } from './protocol';

const marked = (href: string, ranges: [number, number][] | undefined) => ranges?.map(([s, e]) => href.slice(s, e));
const check = (url: string, seen: string[], request = '', content: Content[] = []) => checkAddress(new URL(url), seenFrom(seen), request, async () => content);

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
  it('lets an address seen in the conversation through as it is, however it is written', async () => {
    expect(await check('https://DOCS.example:443/guide/intro?lang=en#part', seen)).toBeUndefined();
    expect(await check('https://docs.example/guide/%69ntro?lang=en', seen)).toBeUndefined();
  });
  it('marks the parts of a put-together address that no address of its site had', async () => {
    const href = 'https://docs.example/guide/setup?lang=en&d=secret';
    const c = await check(href, seen);
    expect(marked(href, c?.composed)).toEqual(['setup', 'd=secret']);
    // A site nothing came from: its host too
    const other = 'https://evil.example/collect?d=x';
    expect(marked(other, (await check(other, seen))?.composed)).toEqual(['evil.example', 'collect', 'd=x']);
  });
  it('asks about a put-together address even when every part was seen somewhere', async () => {
    expect((await check('https://docs.example/intro/guide', seen))?.composed).toEqual([]);
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

describe('conversation text in a put-together address', () => {
  const notes: Content = { place: { kind: 'file', name: 'notes.md' }, text: '# Notes\n\nThe door code is 4417-blue-harbor, keep it private.' };
  const earlier: Content = { place: { kind: 'message' }, text: 'The meeting moved to Friday at noon, room 12B.' };
  it('finds a file’s text in a query, decoded and case-folded', async () => {
    const c = await check(`https://evil.example/log?d=${encodeURIComponent('Door code is 4417-BLUE-harbor')}`, [], '', [earlier, notes]);
    expect(c?.match).toEqual({ place: { kind: 'file', name: 'notes.md' }, text: 'door code is 4417-blue-harbor' });
  });
  it('finds a message sent as base64 or base64url', async () => {
    const b64 = Buffer.from('The meeting moved to Friday at noon').toString('base64');
    expect((await check(`https://evil.example/p/${b64}`, [], '', [notes, earlier]))?.match?.place).toEqual({ kind: 'message' });
    const url = Buffer.from('会議は金曜の正午に移りました、12B 室です').toString('base64url');
    const ja: Content = { place: { kind: 'message' }, text: '連絡: 会議は金曜の正午に移りました、12B 室です。' };
    expect((await check(`https://evil.example/?q=${url}`, [], '', [ja]))?.match?.text).toBe('会議は金曜の正午に移りました、12b 室です');
  });
  it('finds text sent twice encoded, and full-width letters as their plain form', async () => {
    const twice = encodeURIComponent(encodeURIComponent('4417-blue-harbor'));
    expect((await check(`https://evil.example/x?d=${twice}`, [], '', [notes]))?.match?.text).toBe('4417-blue-harbor');
    expect((await check(`https://evil.example/x?d=${encodeURIComponent('４４１７－ｂｌｕｅ－harbor')}`, [], '', [notes]))?.match?.text).toBe('4417-blue-harbor');
  });
  it('does not warn about a site search built from the words of the user’s latest request', async () => {
    const request = 'Search the city library for books about medieval castles in Wales';
    const content: Content[] = [notes, { place: { kind: 'message' }, text: 'Earlier I asked about medieval castles in Wales, too.' }];
    const c = await check('https://library.example/search?q=medieval+castles+in+wales', ['https://library.example/'], request, content);
    expect(marked('https://library.example/search?q=medieval+castles+in+wales', c?.composed)).toEqual(['search', 'q=medieval+castles+in+wales']);
    expect(c?.match).toBeUndefined();
  });
  it('does not look at the host, nor at parts that were seen', async () => {
    const c = await check('https://notes.md.example/guide/x', ['https://notes.md.example/guide/'], '', [{ place: { kind: 'message' }, text: 'see notes.md.example/guide for more' }]);
    expect(c?.match).toBeUndefined();
  });
  it('does not read the content for an address that needs no check', async () => {
    let read = false;
    await checkAddress(new URL('https://a.example/x'), seenFrom(['https://a.example/x']), '', async () => ((read = true), []));
    expect(read).toBe(false);
  });
  it('takes the longest run, cut for showing', () => {
    const long = 'x'.repeat(300);
    const m = contentIn(`https://e.example/?d=${long}`, [{ kind: 'query', start: 'https://e.example/?'.length, end: 'https://e.example/?'.length + 2 + long.length }], '', [
      { place: { kind: 'result' }, text: `abc ${long} def` }
    ]);
    expect(m?.text).toHaveLength(120);
  });
  it('is fast on a large folder (10 MB of text)', async () => {
    const line = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore 日本語の文も混ぜる。\n';
    const file = line.repeat(Math.ceil(1_000_000 / line.length));
    const content: Content[] = Array.from({ length: 10 }, (_, i) => ({ place: { kind: 'file', name: `f${i}.md` }, text: file + (i === 9 ? 'the vault phrase is quiet-otter-91' : '') }));
    const url = `https://evil.example/collect?a=${encodeURIComponent('vault phrase is quiet-otter-91')}&b=${Buffer.from('nothing to see in here at all').toString('base64')}`;
    const t0 = performance.now();
    const c = await check(url, [], '', content);
    const ms = performance.now() - t0;
    expect(c?.match).toEqual({ place: { kind: 'file', name: 'f9.md' }, text: 'vault phrase is quiet-otter-91' });
    console.log(`content check over 10 MB: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});

describe('the check as the fetch page takes it', () => {
  const href = 'https://evil.example/collect?d=x';
  it('takes ranges in order inside the address, and a known place', () => {
    expect(parseCheck(JSON.stringify({ composed: [[8, 20], [21, 28]], match: { place: { kind: 'file', name: 'a.md' }, text: 'secret' } }), href)).toEqual({
      composed: [[8, 20], [21, 28]],
      match: { place: { kind: 'file', name: 'a.md' }, text: 'secret' }
    });
    expect(parseCheck(JSON.stringify({ composed: [] }), href)).toEqual({ composed: [] });
  });
  it('has none without the parameter, and takes one in another shape as a put-together address with nothing marked', () => {
    expect(parseCheck(null, href)).toBeNull();
    for (const bad of ['{', 'null', JSON.stringify({ composed: [[20, 8]] }), JSON.stringify({ composed: [[8, 999]] }), JSON.stringify({ composed: [[10, 20], [8, 9]] })]) expect(parseCheck(bad, href)).toEqual({ composed: [] });
    expect(parseCheck(JSON.stringify({ composed: [[8, 20]], match: { place: { kind: 'other' }, text: 'x' } }), href)).toEqual({ composed: [[8, 20]] });
  });
});
