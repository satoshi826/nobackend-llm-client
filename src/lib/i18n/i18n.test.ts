import { afterEach, describe, expect, it } from 'vitest';
import { defineMessages, detectLang, formatBytes, formatDate, formatList, formatUsd, getLang, inEnglish, interpolate, setLang, TranslatedError } from './index';

afterEach(() => setLang('ja'));

describe('i18n', () => {
  const t = defineMessages({ hi: 'こんにちは {name}', n: '{count} 件' }, { en: { hi: 'Hello {name}', n: '{count} items' }, zh: { hi: '你好 {name}', n: '{count} 条' } });

  it('translates with placeholders and follows the current language', () => {
    expect(getLang()).toBe('ja');
    expect(t('hi', { name: 'A' })).toBe('こんにちは A');
    setLang('en');
    expect(t('n', { count: 3 })).toBe('3 items');
    setLang('zh');
    expect(t('hi', { name: 'B' })).toBe('你好 B');
  });
  it('picks the language from browser preferences', () => {
    expect(detectLang(['ja-JP', 'en'])).toBe('ja');
    expect(detectLang(['zh-TW'])).toBe('zh');
    expect(detectLang(['fr-FR', 'en-GB'])).toBe('en');
    expect(detectLang(['de'])).toBe('en');
  });
  it('leaves unknown placeholders alone', () => {
    expect(interpolate('{a} {b}', { a: 1 })).toBe('1 {b}');
  });
  it('writes amounts in dollars one way: cents from $1, two significant digits below', () => {
    setLang('en');
    expect([0, 12.345, 1, 0.5, 0.0123, 0.00042].map(formatUsd)).toEqual(['$0', '$12.35', '$1.00', '$0.50', '$0.012', '$0.00042']);
  });
  it('writes sizes in B, whole KB, and MB / GB with one decimal', () => {
    setLang('en');
    expect([0, 1023, 1024, 1536, 1.25 * 1024 ** 2, 2.5 * 1024 ** 3].map(formatBytes)).toEqual(['0 B', '1,023 B', '1 KB', '2 KB', '1.3 MB', '2.5 GB']);
    // Just under a unit is shown in that unit
    expect([1024 ** 2 - 1, 1024 ** 3 - 1].map(formatBytes)).toEqual(['1.0 MB', '1.0 GB']);
  });
  it('formats lists and dates in the language in use, also after it changes', () => {
    const day = Date.UTC(2026, 0, 5, 12);
    setLang('en');
    expect([formatList(['A', 'B', 'C']), formatDate(day)]).toEqual(['A, B, & C', 'Jan 5, 2026']);
    setLang('ja');
    expect([formatList(['A', 'B', 'C']), formatDate(day)]).toEqual(['A、B、C', '2026/01/05']);
    setLang('zh');
    expect([formatList(['A', 'B', 'C']), formatDate(day)]).toEqual(['A、B和C', '2026年1月5日']);
  });
  it('makes text for a model in English and goes back to the UI language, also when making it fails', () => {
    expect(inEnglish(() => t('n', { count: 2 }))).toBe('2 items');
    expect(getLang()).toBe('ja');
    expect(() => inEnglish(() => {
      throw new Error('x');
    })).toThrow('x');
    expect(getLang()).toBe('ja');
  });
  it('gives a tool error to the user in the UI language and to the model in English', () => {
    const e = new TranslatedError(() => t('hi', { name: 'A' }));
    expect(e.message).toBe('こんにちは A');
    expect(e.english).toBe('Hello A');
    expect(getLang()).toBe('ja');
  });
});
