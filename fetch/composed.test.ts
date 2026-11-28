import { describe, expect, it } from 'vitest';
import { markedPieces, skipsQuestion } from './composed';

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
