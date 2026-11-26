import { describe, expect, it } from 'vitest';
import { generateDataKey, importDataKey, openBytes, openJSON, sealBytes, sealJSON } from './data';

describe('data key', () => {
  it('round-trips JSON and bytes, with a fresh IV every time', async () => {
    const k = await generateDataKey();
    const value = { title: '秘密', n: 3, list: [1, 'two'] };
    const a = await sealJSON(k, value);
    const b = await sealJSON(k, value);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(a.ct).not.toContain('秘密');
    expect(await openJSON(k, a)).toEqual(value);

    const bytes = new Uint8Array([0, 1, 2, 250, 255]).buffer;
    const s = await sealBytes(k, bytes);
    expect(new Uint8Array(await openBytes(k, s))).toEqual(new Uint8Array(bytes));
  });

  it('opens data again after the key is restored from its raw form', async () => {
    const k = await generateDataKey();
    const s = await sealJSON(k, 'hello');
    const again = await importDataKey(k.raw);
    expect(again.raw).toBe(k.raw);
    expect(await openJSON(again, s)).toBe('hello');
  });

  it('refuses keys that are not 32 bytes, and data sealed with another key or altered', async () => {
    await expect(importDataKey(btoa('short'))).rejects.toThrow();
    const k = await generateDataKey();
    const other = await generateDataKey();
    const s = await sealJSON(k, { a: 1 });
    await expect(openJSON(other, s)).rejects.toThrow();
    const flipped = atob(s.ct);
    const tampered = { iv: s.iv, ct: btoa(String.fromCharCode(flipped.charCodeAt(0) ^ 1) + flipped.slice(1)) };
    await expect(openJSON(k, tampered)).rejects.toThrow();
  });
});
