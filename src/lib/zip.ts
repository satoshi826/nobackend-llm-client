// Zip files. Writing stores the entries without compression (backups with images and videos, whose bytes are
// compressed already): a zip is a Blob made of its headers and the entries' own Blobs. Reading hands out slices of the
// file for stored entries, and inflates deflated ones (zips made by other tools, such as a skill's) only when one is
// opened. ZIP64 records are written only when a zip needs them (65,535 entries or more, or past 4 GiB)
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END64 = 0x06064b50;
const LOCATOR64 = 0x07064b50;
/** Bytes read at a time to work out a checksum */
const READ_SIZE = 1 << 22;

/** The file is not a zip this app can read (damaged, or compressed other than by deflate) */
export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  data: Blob;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of the bytes, continued from crc (the CRC of what came before them) */
export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

async function crcOf(blob: Blob): Promise<number> {
  let crc = 0;
  for (let at = 0; at < blob.size; at += READ_SIZE) crc = crc32(new Uint8Array(await blob.slice(at, at + READ_SIZE).arrayBuffer()), crc);
  return crc;
}

/** MS-DOS time and date, as zip headers keep them */
function dosTime(d: Date): [number, number] {
  return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()];
}

const enc = new TextEncoder();

/** A zip of the entries (each under 4 GiB), stored as they are */
export async function zip(entries: ZipEntry[], date = new Date()): Promise<Blob> {
  const [time, day] = dosTime(date);
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const e of entries) {
    if (e.data.size >= MAX32) throw new RangeError(`${e.name} is too large for a zip entry`);
    const name = enc.encode(e.name);
    const crc = await crcOf(e.data);
    const local = new DataView(new ArrayBuffer(30 + name.length));
    local.setUint32(0, LOCAL, true);
    local.setUint16(4, 20, true);
    // Names in UTF-8
    local.setUint16(6, 0x0800, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, e.data.size, true);
    local.setUint32(22, e.data.size, true);
    local.setUint16(26, name.length, true);
    new Uint8Array(local.buffer).set(name, 30);
    parts.push(local.buffer, e.data);
    // An offset past 4 GiB goes in a ZIP64 extra field
    const far = offset >= MAX32;
    const c = new DataView(new ArrayBuffer(46 + name.length + (far ? 12 : 0)));
    c.setUint32(0, CENTRAL, true);
    c.setUint16(4, 45, true);
    c.setUint16(6, far ? 45 : 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, time, true);
    c.setUint16(14, day, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, e.data.size, true);
    c.setUint32(24, e.data.size, true);
    c.setUint16(28, name.length, true);
    c.setUint16(30, far ? 12 : 0, true);
    c.setUint32(42, far ? MAX32 : offset, true);
    new Uint8Array(c.buffer).set(name, 46);
    if (far) {
      c.setUint16(46 + name.length, 1, true);
      c.setUint16(48 + name.length, 8, true);
      c.setBigUint64(50 + name.length, BigInt(offset), true);
    }
    central.push(new Uint8Array(c.buffer));
    offset += local.byteLength + e.data.size;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const tail: BlobPart[] = [...central];
  if (entries.length >= MAX16 || offset >= MAX32 || cdSize >= MAX32) {
    const z = new DataView(new ArrayBuffer(56 + 20));
    z.setUint32(0, END64, true);
    z.setBigUint64(4, 44n, true);
    z.setUint16(12, 45, true);
    z.setUint16(14, 45, true);
    z.setBigUint64(24, BigInt(entries.length), true);
    z.setBigUint64(32, BigInt(entries.length), true);
    z.setBigUint64(40, BigInt(cdSize), true);
    z.setBigUint64(48, BigInt(offset), true);
    z.setUint32(56, LOCATOR64, true);
    z.setBigUint64(64, BigInt(offset + cdSize), true);
    z.setUint32(72, 1, true);
    tail.push(z.buffer);
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END, true);
  end.setUint16(8, Math.min(entries.length, MAX16), true);
  end.setUint16(10, Math.min(entries.length, MAX16), true);
  end.setUint32(12, Math.min(cdSize, MAX32), true);
  end.setUint32(16, Math.min(offset, MAX32), true);
  tail.push(end.buffer);
  return new Blob([...parts, ...tail], { type: 'application/zip' });
}

/** Whether the file starts as a zip does */
export async function isZip(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head.length === 4 && new DataView(head.buffer).getUint32(0, true) === LOCAL;
}

const view = async (file: Blob, start: number, end: number) => new DataView(await file.slice(start, end).arrayBuffer());

/** An entry of a zip being read: its name, its size once opened, and its bytes */
export interface ZipItem {
  name: string;
  /** The size the zip gives for the opened bytes (an entry that inflates past it fails to open) */
  size: number;
  open(): Promise<Blob>;
}

/** The entries of a zip, in its order, without reading their bytes */
export async function listZip(file: Blob): Promise<ZipItem[]> {
  // The end record is in the last 22 bytes, unless a comment (up to 64 KiB) follows it
  const tailStart = Math.max(0, file.size - 22 - MAX16 - 20);
  const tail = await view(file, tailStart, file.size);
  let at = tail.byteLength - 22;
  while (at >= 0 && tail.getUint32(at, true) !== END) at--;
  if (at < 0) throw new ZipError('no end record');
  let count = tail.getUint16(at + 10, true);
  let cdSize = tail.getUint32(at + 12, true);
  let cdStart = tail.getUint32(at + 16, true);
  if ((count === MAX16 || cdSize === MAX32 || cdStart === MAX32) && at >= 20 && tail.getUint32(at - 20, true) === LOCATOR64) {
    const z64At = Number(tail.getBigUint64(at - 12, true));
    const z = await view(file, z64At, z64At + 56);
    if (z.byteLength < 56 || z.getUint32(0, true) !== END64) throw new ZipError('no ZIP64 end record');
    count = Number(z.getBigUint64(32, true));
    cdSize = Number(z.getBigUint64(40, true));
    cdStart = Number(z.getBigUint64(48, true));
  }
  const cd = await view(file, cdStart, cdStart + cdSize);
  const dec = new TextDecoder();
  const out: ZipItem[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== CENTRAL) throw new ZipError('damaged central directory');
    const method = cd.getUint16(p + 10, true);
    if (method !== 0 && method !== 8) throw new ZipError('compressed entry');
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let packed = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    let offset = cd.getUint32(p + 42, true);
    // A ZIP64 extra field holds, in this order, the values that did not fit: original size, stored size, offset
    for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen; e += 4 + cd.getUint16(e + 2, true)) {
      if (cd.getUint16(e, true) !== 1) continue;
      let q = e + 4;
      if (size === MAX32) {
        size = Number(cd.getBigUint64(q, true));
        q += 8;
      }
      if (packed === MAX32) {
        packed = Number(cd.getBigUint64(q, true));
        q += 8;
      }
      if (offset === MAX32) offset = Number(cd.getBigUint64(q, true));
    }
    const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
    out.push({ name, size, open: () => openEntry(file, offset, packed, size, method === 8) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** An entry's bytes: they start after its local header, whose name and extra field may differ in length from the central record's */
async function openEntry(file: Blob, offset: number, packed: number, size: number, deflated: boolean): Promise<Blob> {
  const h = await view(file, offset, offset + 30);
  if (h.byteLength < 30 || h.getUint32(0, true) !== LOCAL) throw new ZipError('damaged entry');
  const start = offset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  if (start + packed > file.size) throw new ZipError('cut off');
  const raw = file.slice(start, start + packed);
  if (!deflated) return raw;
  const parts: Uint8Array[] = [];
  let got = 0;
  try {
    const reader = raw.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      // An entry that says it is small and inflates to much more (a zip bomb) stops here
      if (got > size) {
        await reader.cancel();
        throw new ZipError('larger than it says');
      }
      parts.push(value);
    }
  } catch (e) {
    throw e instanceof ZipError ? e : new ZipError('damaged entry');
  }
  if (got !== size) throw new ZipError('damaged entry');
  return new Blob(parts as BlobPart[]);
}

/** Every entry of a zip, by name: slices of the file for stored entries (read only when used), inflated ones in memory */
export async function unzip(file: Blob): Promise<Map<string, Blob>> {
  return new Map(await Promise.all((await listZip(file)).map(async (e) => [e.name, await e.open()] as const)));
}
