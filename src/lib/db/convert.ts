// Stored data in shapes from before, converted to today's as the catalog loads them (they are encrypted, so this
// cannot run in a database upgrade). Each record is written back at once, so a stop halfway leaves the rest for the
// next load. Development only: this goes before the first release, when nothing in these shapes exists anywhere.
import { db, PREVIEW_CHARS, textBytes, type BlobRecord, type FileRecord, type ImageInfo, type Origin, type TextStamp } from './schema';
import { currentDataKey, seal, unseal } from './sealed';
import { sealJSON } from '../crypto/data';
import { extOfMime, freePath, timeName, type PathSpace } from '../paths';

/** A file record in a shape from before: texts inside it, versions, a history, kind / source / url, a size in characters */
export const isOldFile = (r: object): boolean => !('origin' in r) || 'versions' in r || 'history' in r || !('bytes' in r);

type Old = Record<string, any>;
const stamp = (v: Old): TextStamp => ({ at: Number(v?.at) || Date.now(), by: v?.by === 'user' || v?.by === 'upload' ? v.by : 'model' });

/** Convert an opened file record and write it back: its record without texts, and its texts in fileTexts */
export async function convertFile(r: Old): Promise<FileRecord> {
  const key = currentDataKey();
  // Today's shape but sized in characters: only the size changes (its text is in fileTexts already)
  if ('origin' in r && !('versions' in r) && !('history' in r)) {
    const row = await db().fileTexts.get(`${r.id}:current`);
    const { size: _size, ...rest } = r;
    const record = { ...rest, bytes: textBytes(row ? (await unseal(row, key)).text : '') } as FileRecord;
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
    name: r.name,
    mime: r.mime,
    origin,
    ...(typeof r.source === 'string' && r.source.startsWith('PDF') ? { fromPdf: true } : {}),
    ...(r.conversationId ? { conversationId: r.conversationId } : {}),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    bytes: textBytes(text),
    preview: text.slice(0, PREVIEW_CHARS),
    current: stamp(current),
    ...(previousText !== undefined ? { previous: stamp(previous ?? {}) } : {})
  };
  const rec = await seal('files', record, key);
  const texts = await Promise.all([
    seal('fileTexts', { id: `${r.id}:current`, fileId: r.id, text }, key),
    ...(previousText !== undefined ? [seal('fileTexts', { id: `${r.id}:previous`, fileId: r.id, text: previousText }, key)] : [])
  ]);
  await db().transaction('rw', db().files, db().fileTexts, db().fileVersions, async () => {
    await db().fileVersions.where('fileId').equals(r.id).delete();
    await db().fileTexts.bulkPut(texts);
    await db().files.put(rec);
  });
  return record;
}

/** An image's info in the shape from before ({ name, source }) */
/** An image's info in a shape from before: none (made in a chat), { name, source }, or without a path */
export const isOldImageInfo = (info: object | undefined): boolean => !info || 'name' in info || 'source' in info || !('path' in info);

/**
 * Convert an image's info to { path, origin } and write it back: one made in a chat, which had none, is named by the
 * time it was saved (at the top), as images made now are
 */
export async function convertImageInfo(rec: BlobRecord, old: Old | undefined, space: PathSpace): Promise<ImageInfo> {
  const s = old?.source ?? old?.origin ?? {};
  const name = typeof old?.path === 'string' ? old.path : typeof old?.name === 'string' ? old.name : undefined;
  const info: ImageInfo = {
    path: name ?? freePath(timeName(rec.createdAt, extOfMime(rec.mime)), space),
    origin: s.kind === 'web' && typeof s.url === 'string' ? { kind: 'web', url: s.url } : s.kind === 'upload' ? { kind: 'upload' } : { kind: 'made' }
  };
  const key = currentDataKey();
  await db().blobs.update(rec.id, key ? { info: undefined, infoEnc: await sealJSON(key, info) } : { info, infoEnc: undefined });
  return info;
}
