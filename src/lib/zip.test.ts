import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, isZip, listZip, unzip, zip, ZipError } from './zip';

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

  it('refuses a damaged zip and entries compressed other than by deflate', async () => {
    const z = await zip([{ name: 'a', data: new Blob(['abc']) }]);
    await expect(unzip(z.slice(0, z.size - 30))).rejects.toBeInstanceOf(ZipError);
    const buf = new Uint8Array(await z.arrayBuffer());
    const cd = buf.findIndex((_, i) => buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 1 && buf[i + 3] === 2);
    // The central record's method: bzip2
    buf[cd + 10] = 12;
    await expect(unzip(new Blob([buf]))).rejects.toThrow(/compressed/);
    // Deflate, but the bytes are not deflated
    buf[cd + 10] = 8;
    await expect(unzip(new Blob([buf]))).rejects.toBeInstanceOf(ZipError);
  });
});

/** A zip whose entries are deflated, as other tools write them; size overrides the size it gives for one */
function deflatedZip(entries: { name: string; text: string; size?: number }[]): Blob {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = bytes(e.name);
    const plain = bytes(e.text);
    const packed = new Uint8Array(deflateRawSync(plain));
    const local = new DataView(new ArrayBuffer(30 + name.length));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, 8, true);
    local.setUint16(26, name.length, true);
    new Uint8Array(local.buffer).set(name, 30);
    const c = new DataView(new ArrayBuffer(46 + name.length));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(10, 8, true);
    c.setUint32(16, crc32(plain), true);
    c.setUint32(20, packed.length, true);
    c.setUint32(24, e.size ?? plain.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    new Uint8Array(c.buffer).set(name, 46);
    parts.push(new Uint8Array(local.buffer), packed);
    central.push(new Uint8Array(c.buffer));
    offset += 30 + name.length + packed.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[]);
}

describe('zip (deflated, made by other tools)', () => {
  it('lists the entries with their sizes and inflates one only when it is opened', async () => {
    const text = 'Fill the form.\n'.repeat(100);
    const items = await listZip(deflatedZip([{ name: 'my-skill/SKILL.md', text }, { name: 'my-skill/reference/a.md', text: '# A' }]));
    expect(items.map((i) => [i.name, i.size])).toEqual([['my-skill/SKILL.md', text.length], ['my-skill/reference/a.md', 3]]);
    expect(await (await items[0].open()).text()).toBe(text);
    expect(await (await unzip(deflatedZip([{ name: 'a', text: 'abc' }]))).get('a')!.text()).toBe('abc');
  });

  it('stops an entry that inflates past the size it gives', async () => {
    const [item] = await listZip(deflatedZip([{ name: 'bomb', text: 'x'.repeat(100_000), size: 10 }]));
    expect(item.size).toBe(10);
    await expect(item.open()).rejects.toThrow(/larger than it says/);
  });
});
