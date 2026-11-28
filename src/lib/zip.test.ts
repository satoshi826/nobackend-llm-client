import { describe, expect, it } from 'vitest';
import { crc32, isZip, unzip, zip, ZipError } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('zip (stored)', () => {
  it('computes the standard CRC-32, also a part at a time', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('6789'), crc32(bytes('12345')))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('reads back what it writes: names in UTF-8, empty entries, bytes as they were', async () => {
    const z = await zip([
      { name: 'backup.json', data: new Blob(['{"a":1}']) },
      { name: 'media/旅行.png', data: new Blob([new Uint8Array([0, 255, 1, 254])]) },
      { name: 'empty', data: new Blob([]) }
    ]);
    expect(z.type).toBe('application/zip');
    expect(await isZip(z)).toBe(true);
    expect(await isZip(new Blob(['{"format":1}']))).toBe(false);
    const files = await unzip(z);
    expect([...files.keys()]).toEqual(['backup.json', 'media/旅行.png', 'empty']);
    expect(await files.get('backup.json')!.text()).toBe('{"a":1}');
    expect([...new Uint8Array(await files.get('media/旅行.png')!.arrayBuffer())]).toEqual([0, 255, 1, 254]);
    expect(files.get('empty')!.size).toBe(0);
  });

  it('writes and reads ZIP64 end records past 65,535 entries', { timeout: 20_000 }, async () => {
    const n = 0x10000 + 2;
    const data = new Blob(['x']);
    const z = await zip(Array.from({ length: n }, (_, i) => ({ name: `f${i}`, data })));
    // Read as a file is (one part: slicing a Blob of 130,000 parts is slow)
    const files = await unzip(new Blob([await z.arrayBuffer()]));
    expect(files.size).toBe(n);
    expect(await files.get(`f${n - 1}`)!.text()).toBe('x');
  });

  it('refuses a damaged zip and compressed entries', async () => {
    const z = await zip([{ name: 'a', data: new Blob(['abc']) }]);
    await expect(unzip(z.slice(0, z.size - 30))).rejects.toBeInstanceOf(ZipError);
    const buf = new Uint8Array(await z.arrayBuffer());
    // The central record's method: deflate
    const cd = buf.findIndex((_, i) => buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 1 && buf[i + 3] === 2);
    buf[cd + 10] = 8;
    await expect(unzip(new Blob([buf]))).rejects.toThrow(/compressed/);
  });
});
