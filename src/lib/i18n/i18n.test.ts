import { afterEach, describe, expect, it } from 'vitest';
import { defineMessages, detectLang, getLang, interpolate, setLang } from './index';

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
});
