// Development only, goes before the first release: stored data in shapes from before, converted to today's as the
// catalog loads them (they are encrypted, so this cannot run in a database upgrade). Each record is written back at
// once, so a stop halfway leaves the rest for the next load. Also the old names of message fields (renameFields),
// read as today's wherever messages are read.
import { db, PREVIEW_CHARS, textBytes, type BlobRecord, type FileData, type FileRecord, type MessageRecord, type Origin, type Stamp } from './schema';
import { currentDataKey, DataLockedError, seal, unseal } from './sealed';
import { openJSON } from '../crypto/data';
import { cleanFileName, extOfMime, freePath, timeName, type PathSpace } from '../paths';

/** A file record in a shape from before: named (not given a path), texts inside it, versions, a history, kind / source / url */
export const isOldFile = (r: object): boolean => !('path' in r) || !('origin' in r) || 'versions' in r || 'history' in r || !('bytes' in r);

type Old = Record<string, any>;
const stamp = (v: Old): Stamp => ({ at: Number(v?.at) || Date.now(), by: v?.by === 'user' || v?.by === 'upload' ? v.by : 'model' });
const textRow = (fileId: string, which: 'current' | 'previous', text: string): FileData => ({ id: `${fileId}:${which}`, fileId, text });

/** Convert an opened file record and write it back: its record without texts, and its texts in fileData */
export async function convertFile(r: Old): Promise<FileRecord> {
  const key = currentDataKey();
  const { name, fromPdf: _p, size: _s, ...rest } = r;
  // The shape before every file had a path: only the name changes (sized in characters before that: its size too)
  if ('origin' in r && !('versions' in r) && !('history' in r)) {
    let bytes = r.bytes;
    if (typeof bytes !== 'number') {
      const row = await db().fileData.get(`${r.id}:current`);
      const opened = row && (await unseal(row, key));
      bytes = textBytes(opened && 'text' in opened ? opened.text : '');
    }
    const record = { ...rest, path: r.path ?? name, bytes } as FileRecord;
    await db().files.put(await seal('files', record, key));
    return record;
  }
  let current: Old;
  let previous: Old | undefined;
  let previousText: string | undefined;
  if (Array.isArray(r.versions)) {
    // Before v9: every version inside
    current = r.versions[r.versions.length - 1] ?? { text: '' };
    previous = r.versions[r.versions.length - 2];
    previousText = previous?.text;
  } else {
    current = r.current ?? { text: '' };
    // v9: a list of earlier versions, their texts in rows '<id>:<v>'; then one previous text in a row '<id>'
    const last = Array.isArray(r.history) ? r.history[r.history.length - 1] : r.previous;
    const row = last && (await db().fileVersions.get(Array.isArray(r.history) ? `${r.id}:${last.v}` : r.id));
    if (row) {
      previous = last;
      previousText = (await unseal(row, key)).text;
    }
  }
  const text = typeof current.text === 'string' ? current.text : '';
  const origin: Origin = typeof r.url === 'string' ? { kind: 'web', url: r.url } : r.kind === 'upload' ? { kind: 'upload' } : { kind: 'made' };
  const record: FileRecord = {
    id: r.id,
    path: name,
    mime: r.mime,
    origin,
    ...(r.conversationId ? { conversationId: r.conversationId } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    bytes: textBytes(text),
    preview: text.slice(0, PREVIEW_CHARS),
    current: stamp(current),
    ...(previousText !== undefined ? { previous: stamp(previous ?? {}) } : {})
  };
  const rec = await seal('files', record, key);
  const texts = await Promise.all([textRow(r.id, 'current', text), ...(previousText !== undefined ? [textRow(r.id, 'previous', previousText)] : [])].map((t) => seal('fileData', t, key)));
  await db().transaction('rw', db().files, db().fileData, db().fileVersions, async () => {
    await db().fileVersions.where('fileId').equals(r.id).delete();
    await db().fileData.bulkPut(texts);
    await db().files.put(rec);
  });
  return record;
}

/**
 * Move an image or a video from the table before files held every file (blobs) into files, and return its record
 * (undefined when it is gone). Its bytes and thumbnail move as they are (encrypted or not), without their type, which
 * is in the record now. One made before images had paths is named by the time it was saved (at the top), as images
 * made now are
 */
export async function convertImage(id: string, space: PathSpace): Promise<FileRecord | undefined> {
  const rec: BlobRecord | undefined = await db().blobs.get(id);
  if (!rec) return undefined;
  const key = currentDataKey();
  let info: Old | undefined = rec.info;
  if (rec.infoEnc) {
    if (!key) throw new DataLockedError();
    info = await openJSON<Old>(key, rec.infoEnc);
  }
  const s = info?.origin ?? info?.source ?? {};
  const origin: Origin = s.kind === 'web' && typeof s.url === 'string' ? { kind: 'web', url: s.url } : s.kind === 'upload' ? { kind: 'upload' } : { kind: 'made' };
  const named = typeof info?.path === 'string' ? info.path : typeof info?.name === 'string' ? cleanFileName(info.name, extOfMime(rec.mime)) : undefined;
  const record: FileRecord = {
    id: rec.id,
    path: named ?? freePath(timeName(rec.createdAt, extOfMime(rec.mime)), space),
    mime: rec.mime,
    origin,
    ...(rec.conversationId ? { conversationId: rec.conversationId } : {}),
    ...(rec.messageId ? { messageId: rec.messageId } : {}),
    createdAt: rec.createdAt,
    updatedAt: rec.createdAt,
    bytes: rec.size,
    current: { at: rec.createdAt, by: origin.kind === 'made' ? 'model' : 'upload' }
  };
  const untyped = <T extends Blob | { iv: Uint8Array<ArrayBuffer>; data: Blob }>(d: T) => (d instanceof Blob ? new Blob([d]) : { iv: d.iv, data: new Blob([d.data]) });
  const bytes = rec.blob ?? rec.enc;
  const rows: FileData[] = [
    ...(bytes ? [{ id: `${id}:current`, fileId: id, data: untyped(bytes) }] : []),
    ...(rec.thumb ? [{ id: `${id}:thumb`, fileId: id, data: untyped(rec.thumb) }] : [])
  ];
  const sealed = await seal('files', record, key);
  await db().transaction('rw', db().files, db().fileData, db().blobs, async () => {
    await db().fileData.bulkPut(rows);
    await db().files.put(sealed);
    await db().blobs.delete(id);
  });
  return record;
}

/** A message with the fields that named stored files by their old names (blobId, sourceBlobId, ...) renamed */
export function renameFields<T extends Partial<MessageRecord>>(m: T): T {
  const old = m as Old;
  const parts = old.parts?.map((p: Old) => {
    if (p?.type === 'file' && 'blobId' in p) {
      const { blobId, ...rest } = p;
      return { ...rest, fileId: blobId };
    }
    if (p?.type === 'tool' && Array.isArray(p.uiDetails?.blobIds)) {
      const { blobIds, ...rest } = p.uiDetails;
      return { ...p, uiDetails: { ...rest, fileIds: blobIds } };
    }
    return p;
  });
  const params = (x: Old | undefined, from: string, to: string) => {
    if (!x || !(from in x)) return x;
    const { [from]: v, ...rest } = x;
    return { ...rest, [to]: v };
  };
  const changed =
    parts?.some((p: unknown, i: number) => p !== old.parts[i]) ||
    'sourceBlobId' in (old.imageRequest ?? {}) ||
    'sourceBlobId' in (old.image?.params ?? {}) ||
    'startBlobId' in (old.videoRequest ?? {}) ||
    'startBlobId' in (old.video?.params ?? {});
  if (!changed) return m;
  return {
    ...m,
    ...(parts ? { parts } : {}),
    ...(old.imageRequest ? { imageRequest: params(old.imageRequest, 'sourceBlobId', 'sourceFileId') } : {}),
    ...(old.image ? { image: { ...old.image, params: params(old.image.params, 'sourceBlobId', 'sourceFileId') } } : {}),
    ...(old.videoRequest ? { videoRequest: params(old.videoRequest, 'startBlobId', 'startFileId') } : {}),
    ...(old.video ? { video: { ...old.video, params: params(old.video.params, 'startBlobId', 'startFileId') } } : {})
  };
}
