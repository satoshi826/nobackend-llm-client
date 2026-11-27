// Images that come back inside a chat reply (native image output).
// They are stored like generated images (lib/db/images), so the gallery, backups and deletion handle them.
import type { Conversation } from '../lib/db/schema';
import type { Part } from '../lib/providers/types';
import { putImage } from '../lib/db/images';
import { baseName } from '../lib/paths';
import * as repo from '../lib/db/repo';


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
export async function saveReplyImage(conv: Conversation, messageId: string, data: string, mimeType: string): Promise<Extract<Part, { type: 'file' }> | null> {
  const mime = /^image\/(png|jpeg|webp|gif)$/.test(mimeType) ? mimeType : 'image/png';
  const blob = new Blob([decodeBase64(data)], { type: mime });
  if (!blob.size) return null;
  const blobId = repo.newId();
  // In the chat's working folder (the top without one), named by the time it is saved
  const path = await putImage({ id: blobId, conversationId: conv.id, messageId, mime, folder: conv.workDir }, blob, !!conv.temporary);
  return { type: 'file', blobId, name: baseName(path), mimeType: mime, ...(await sizeOf(blob)) };
}
