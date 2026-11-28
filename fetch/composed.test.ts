import { describe, expect, it } from 'vitest';
import { markedPieces, offersRemember, readable, skipsQuestion } from './composed';

describe('a put-together address', () => {
  it('is asked about even on a site not asked about; one from the conversation is not', () => {
    const remembered = ['trusted.example'];
    expect(skipsQuestion('trusted.example', remembered, { check: null })).toBe(true);
    expect(skipsQuestion('trusted.example', remembered, { check: { composed: [[34, 42]] } })).toBe(false);
    expect(skipsQuestion('trusted.example', remembered, { check: { composed: [] } })).toBe(false);
    expect(skipsQuestion('trusted.example', remembered, { check: null, blind: true })).toBe(false);
    expect(skipsQuestion('other.example', remembered, { check: null })).toBe(false);
  });
  it('shows its put-together parts marked', () => {
    const href = 'https://trusted.example/collect?d=secret';
    expect(markedPieces(href, [[24, 31], [32, 40]])).toEqual([
      { text: 'https://trusted.example/', marked: false },
      { text: 'collect', marked: true },
      { text: '?', marked: false },
      { text: 'd=secret', marked: true }
    ]);
    expect(markedPieces(href, [])).toEqual([{ text: href, marked: false }]);
  });
});

describe('the address as shown', () => {
  it('decodes escapes for reading, marks kept on the same parts', () => {
    const href = new URL('https://trusted.example/collect?d=' + encodeURIComponent('モックで作ったレポートです。')).href;
    const start = 'https://trusted.example/'.length;
    expect(markedPieces(href, [[start, start + 7], [start + 8, href.length]])).toEqual([
      { text: 'https://trusted.example/', marked: false },
      { text: 'collect', marked: true },
      { text: '?', marked: false },
      { text: 'd=モックで作ったレポートです。', marked: true }
    ]);
  });
  it('keeps escaped what would hide or blur what is sent', () => {
    expect(readable('a%20b%2Fc%3Fd%26e%3Df%2Bg%25h')).toBe('a b%2Fc%3Fd%26e%3Df%2Bg%25h');
    // Controls, line ends, tabs, zero-width and direction-changing characters
    expect(readable('x%00%0A%09%E2%80%8B%E2%80%AEy')).toBe('x%00%0A%09%E2%80%8B%E2%80%AEy');
    // Not UTF-8: as it is
    expect(readable('%E3%81%ZZ%FF')).toBe('%E3%81%ZZ%FF');
    expect(readable('caf%C3%A9')).toBe('café');
  });
  it('offers not to ask again only for an address from the conversation', () => {
    expect(offersRemember({ check: null })).toBe(true);
    expect(offersRemember({ check: { composed: [] } })).toBe(false);
    expect(offersRemember({ check: null, blind: true })).toBe(false);
  });
});
