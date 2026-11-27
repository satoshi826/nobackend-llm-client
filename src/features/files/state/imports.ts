// Bringing files in: from the device into a folder, and as attachments of the next message
import {  signal } from '@preact/signals';
import * as fdb from '../../../lib/db/files';
import {  withTakenPaths } from '../../../lib/db/catalog';
import {  cleanFileName, freePath } from '../../../lib/paths';
import {  newId } from '../../../lib/db/repo';
import {  putImage } from '../../../lib/db/images';
import type { Attachment, Conversation, FileRecord, Origin } from '../../../lib/db/schema';
import {  currentConv, showChat, updateConversation } from '../../../state/conversations';
import {  showToast } from '../../../state/ui';
import { extractText } from '../extract';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

/** Characters of an attached file put directly into the message; the rest is read with read_file */
export const ATTACH_INLINE_CHARS = 60_000;

export interface PendingAttachment {
  fileId: string;
  name: string;
  bytes?: number;
  /** Longer than is sent whole (the rest is read with read_file) */
  long?: boolean;
  reading?: boolean;
}

export const pendingAttachments = signal<PendingAttachment[]>([]);

const setPending = (id: string, patch: Partial<PendingAttachment> | null) => {
  pendingAttachments.value = patch === null ? pendingAttachments.value.filter((a) => a.fileId !== id) : pendingAttachments.value.map((a) => (a.fileId === id ? { ...a, ...patch } : a));
};

/** Files being read from the device (shown as placeholders in the file manager) */
export const importing = signal<{ id: string; name: string }[]>([]);

/** Read one file from the user's device (or the web) into `folder` ('' or 'a/'); returns the record, or null (after a toast) */
export async function importOne(file: File, id: string, temporary: boolean, url?: string, conversationId?: string, folder = ''): Promise<FileRecord | null> {
  try {
    const ex = await extractText(file);
    const rec = await withTakenPaths(async (space) => {
      // A name already in use gets a number: 'notes (2).md'
      const name = freePath(cleanFileName(folder + file.name, 'txt'), space);
      const rec = fdb.newFile({ id, name, origin: url ? { kind: 'web', url } : { kind: 'upload' }, text: ex.text, by: 'upload', fromPdf: ex.fromPdf, conversationId });
      // A pdf's text is stored as text; keep the original extension visible but treat it as plain text
      if (rec.mime === 'application/pdf') rec.mime = 'text/plain';
      return fdb.createFile(rec, ex.text, temporary);
    });
    if (ex.truncated) showToast(t('import.truncated', { name: file.name, n: formatNumber(fdb.MAX_FILE_CHARS) }), 'error');
    return rec;
  } catch (e) {
    showToast((e as Error).message, 'error');
    return null;
  }
}

/** Images kept as they are; SVG is refused, since it can carry scripts */
const IMAGE_MIME = /^image\/(png|jpeg|webp|gif|avif)$/;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function importImage(file: File, id: string, origin: Origin, conv?: Conversation, folder = ''): Promise<string | null> {
  if (!IMAGE_MIME.test(file.type)) {
    showToast(t(file.type === 'image/svg+xml' ? 'import.svg' : 'extract.unsupported', { name: file.name }), 'error');
    return null;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showToast(t('extract.tooBig', { max: formatNumber(MAX_IMAGE_BYTES / 1024 / 1024) }), 'error');
    return null;
  }
  return putImage({ id, mime: file.type, conversationId: conv?.id, origin, folder, name: file.name }, file, !!conv?.temporary);
}

/** Upload from the file manager into `folder` ('' is the top; not attached to anything): images as images, the rest as text (PDFs too) */
export async function importFromDevice(files: File[], folder = '') {
  const jobs = files.map((f) => ({ id: newId(), file: f }));
  importing.value = [...importing.value, ...jobs.map((j) => ({ id: j.id, name: j.file.name }))];
  const done = await Promise.all(
    jobs.map(async (j) => {
      const r = j.file.type.startsWith('image/') ? !!(await importImage(j.file, j.id, { kind: 'upload' }, undefined, folder)) : !!(await importOne(j.file, j.id, false, undefined, undefined, folder));
      importing.value = importing.value.filter((x) => x.id !== j.id);
      return r;
    })
  );
  const n = done.filter(Boolean).length;
  if (n) showToast(n === 1 ? t('import.doneOne') : t('import.done', { n: formatNumber(n) }));
}

/** An attachment's size as the input box shows it: bytes, and whether only its beginning goes with the message (counted in characters) */
async function sizeOf(f: FileRecord): Promise<Pick<PendingAttachment, 'bytes' | 'long'>> {
  return { bytes: f.bytes, long: (await fdb.readText(f.id)).length > ATTACH_INLINE_CHARS };
}

/** Read files from the user's device, keep them in the Files tab, and attach them to the next message */
export async function uploadFiles(files: File[], conv: Conversation) {
  await Promise.all(
    files.map(async (file) => {
      const id = newId();
      pendingAttachments.value = [...pendingAttachments.value, { fileId: id, name: file.name, reading: true }];
      const rec = await importOne(file, id, !!conv.temporary);
      if (rec) setPending(id, { reading: false, ...(await sizeOf(rec)) });
      else setPending(id, null);
    })
  );
}

/** Attach several saved files and go back to the chat */
export async function attachToChat(ids: string[]) {
  for (const id of ids) await attachExisting(id);
  showChat();
}

/** Attach a file that is already in the Files tab */
export async function attachExisting(id: string) {
  // Image and video prompts take no files: back to chat, where the attachment shows and is sent
  const conv = currentConv.value;
  if (conv.imageMode || conv.videoMode) await updateConversation({ imageMode: false, videoMode: false });
  if (pendingAttachments.value.some((a) => a.fileId === id)) return;
  const f = await fdb.getFile(id);
  if (f) pendingAttachments.value = [...pendingAttachments.value, { fileId: f.id, name: f.name, ...(await sizeOf(f)) }];
}

export function detach(id: string) {
  setPending(id, null);
}

/** Snapshot the attached files for the message being sent, and clear the input box's list */
export async function takeAttachments(): Promise<Attachment[]> {
  const ready = pendingAttachments.value.filter((a) => !a.reading);
  if (!ready.length) return [];
  pendingAttachments.value = pendingAttachments.value.filter((a) => a.reading);
  const out: Attachment[] = [];
  for (const a of ready) {
    const f = await fdb.getFile(a.fileId);
    if (!f) continue;
    const text = await fdb.readText(f.id);
    // A long one is cut after a whole line, so the model can go on with read_file from the next line
    const cut = text.length > ATTACH_INLINE_CHARS ? text.slice(0, text.lastIndexOf('\n', ATTACH_INLINE_CHARS) + 1 || ATTACH_INLINE_CHARS) : text;
    out.push({ fileId: f.id, name: f.name, mime: f.mime, text: cut, totalChars: text.length });
  }
  return out;
}
