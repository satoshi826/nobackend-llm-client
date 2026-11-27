// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
// The file as the build puts it into the sandbox page's script: a plain script that declares makeStorage
import source from '../../../sandbox/storage.js?raw';
import { cleanStorage, STORAGE_LIMIT } from './client';

type Items = Record<string, string>;
const { makeStorage, installStorage } = new Function(`${source}\nreturn { makeStorage, installStorage };`)() as {
  makeStorage(initial?: Items | null, onChange?: ((items: Items) => void) | null): Storage & Record<string, unknown>;
  installStorage(local: Storage, session: Storage): void;
};

describe('sandbox storage', () => {
  it('works like Storage, through its methods and as properties, and tells each change', () => {
    const seen: Items[] = [];
    const s = makeStorage({ a: '1', bad: 2 as unknown as string }, (items) => seen.push(items));
    expect(s.getItem('a')).toBe('1');
    expect(s.getItem('bad')).toBeNull();
    s.setItem('n', 5 as unknown as string);
    expect(s.getItem('n')).toBe('5');
    s.theme = 'dark';
    expect(s.getItem('theme')).toBe('dark');
    expect(s.theme).toBe('dark');
    expect(s.length).toBe(3);
    expect(Object.keys(s).sort()).toEqual(['a', 'n', 'theme']);
    expect(JSON.parse(JSON.stringify(s))).toEqual({ a: '1', n: '5', theme: 'dark' });
    delete s.a;
    expect('a' in s).toBe(false);
    // Setting the same value again changes nothing, and is not told
    const before = seen.length;
    s.setItem('n', '5');
    expect(seen.length).toBe(before);
    s.clear();
    expect(s.length).toBe(0);
    expect(seen.at(-1)).toEqual({});
    // As in browsers, an item may have a method's name; the method stays a method
    s.getItem = 'x' as never;
    expect(typeof s.getItem).toBe('function');
    expect(s.getItem('getItem')).toBe('x');
  });

  it('stands in for the window’s storage', () => {
    const local = makeStorage({ k: 'v' });
    installStorage(local, makeStorage());
    expect(window.localStorage.getItem('k')).toBe('v');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('keeps only what storage can hold, as the page sent it', () => {
    expect(cleanStorage({ a: '1' })).toEqual({ a: '1' });
    expect(cleanStorage({ a: 1 })).toBeNull();
    expect(cleanStorage(['a'])).toBeNull();
    expect(cleanStorage('x')).toBeNull();
    expect(cleanStorage({ big: 'x'.repeat(STORAGE_LIMIT) })).toBeNull();
  });
});
