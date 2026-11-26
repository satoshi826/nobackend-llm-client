// Images that come back inside a chat reply (native image output).
// They are stored like generated images (lib/db/images), so the gallery, backups and deletion handle them.
import { signal } from '@preact/signals';
import type { Conversation } from '../lib/db/schema';
import type { Part } from '../lib/providers/types';
import { putImage } from '../lib/db/images';
import * as repo from '../lib/db/repo';

/** Bumped when a reply stored an image (the images feature refreshes its lists) */
export const replyImagesVersion = signal(0);

const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' };

function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
  const bin = atob(data.replace(/^data:[^,]*,/, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sizeOf(blob: Blob): Promise<{ width?: number; height?: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const r = { width: bmp.width, height: bmp.height };
    bmp.close();
    return r;
  } catch {
    return {};
  }
}

/** Store one image from a reply (base64 or a data: URL) and return the file part for the message */
export async function saveReplyImage(conv: Conversation, messageId: string, data: string, mimeType: string, index: number): Promise<Extract<Part, { type: 'file' }> | null> {
  const mime = /^image\/(png|jpeg|webp|gif)$/.test(mimeType) ? mimeType : 'image/png';
  const blob = new Blob([decodeBase64(data)], { type: mime });
  if (!blob.size) return null;
  const blobId = repo.newId();
  await putImage({ id: blobId, conversationId: conv.id, messageId, mime }, blob, !!conv.temporary);
  replyImagesVersion.value++;
  return { type: 'file', blobId, name: `image-${index}.${EXT[mime] ?? 'png'}`, mimeType: mime, ...(await sizeOf(blob)) };
}
