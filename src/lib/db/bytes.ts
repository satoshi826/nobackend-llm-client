// Bytes in storage (files' contents and thumbnails, skills' files): kept as a Blob, or with a passphrase encrypted
// apart from their record, as bytes. The encrypted Blob carries no type: a file's type is in its encrypted record.
import { openBytes, sealBytes, type DataKey } from '../crypto/data';
import type { SealedBytes } from './schema';
import { DataLockedError } from './sealed';

/** Bytes in their stored form: encrypted when a key is given */
export async function storedBytes(data: Blob, key: DataKey | null): Promise<Blob | SealedBytes> {
  if (!key) return data;
  const s = await sealBytes(key, await data.arrayBuffer());
  return { iv: s.iv, data: new Blob([s.data]) };
}

/** Stored bytes back as a Blob of type `mime` */
export async function openStored(data: Blob | SealedBytes, mime: string, key: DataKey | null): Promise<Blob> {
  if (data instanceof Blob) return data.type === mime ? data : data.slice(0, data.size, mime);
  if (!key) throw new DataLockedError();
  return new Blob([await openBytes(key, { iv: data.iv, data: await data.data.arrayBuffer() })], { type: mime });
}

/** Whether stored bytes are in the form a key asks for (encrypted with it, or plain without one) */
export const isStoredAs = (data: Blob | SealedBytes, from: DataKey | null, to: DataKey | null): boolean => (to ? !(data instanceof Blob) && from === to : data instanceof Blob);
