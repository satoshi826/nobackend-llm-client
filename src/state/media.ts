// Stored images and videos (lib/db/images), whatever made them: an image or video answer, the generate_image tool, a
// chat model's own image output, or the user. Here: storing a reply's images, what the viewer shows, deleting.
import { signal } from '@preact/signals';
import type { Conversation } from '../lib/db/schema';
import type { Part } from '../lib/providers/types';
import { deleteImageRecords, getImage, getImageMeta, getImageThumb, putImage } from '../lib/db/images';
import { catalogImage } from '../lib/db/catalog';
import { baseName, folderOf } from '../lib/paths';
import * as repo from '../lib/db/repo';
import { base64ToBlob } from '../lib/base64';
import { conversations, currentId, messages, openConversation, saveMessage, startNewChat } from './conversations';

type FilePart = Extract<Part, { type: 'file' }>;

/** An image's pixel size (empty when it cannot be decoded) */
async function imageSizeOf(blob: Blob): Promise<{ width?: number; height?: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const r = { width: bmp.width, height: bmp.height };
    bmp.close();
    return r;
  } catch {
    return {};
  }
}

/**
 * Store images made for a message, in the chat's working folder (the top without one), at `paths` in it when given
 * (a taken one gets a number), else named by the time they are saved
 */
export async function storeImages(conv: Conversation, messageId: string, blobs: Blob[], paths?: string[]): Promise<FilePart[]> {
  const parts: FilePart[] = [];
  for (const [i, blob] of blobs.entries()) {
    const blobId = repo.newId();
    const mime = blob.type || 'image/png';
    const at = paths?.[i];
    const named = at ? { folder: (conv.workDir ?? '') + folderOf(at), name: baseName(at) } : { folder: conv.workDir };
    const path = await putImage({ id: blobId, conversationId: conv.id, messageId, mime, ...named }, blob, !!conv.temporary);
    parts.push({ type: 'file', blobId, name: baseName(path), mimeType: mime, ...(await imageSizeOf(blob)) });
  }
  return parts;
}

/** Store one image from a chat reply (native image output; base64 or a data: URL) and return the file part for the message */
export async function saveReplyImage(conv: Conversation, messageId: string, data: string, mimeType: string): Promise<FilePart | null> {
  const mime = /^image\/(png|jpeg|webp|gif)$/.test(mimeType) ? mimeType : 'image/png';
  const blob = base64ToBlob(data.replace(/^data:[^,]*,/, ''), mime);
  if (!blob.size) return null;
  return (await storeImages(conv, messageId, [blob]))[0];
}

/** An image or a video in the viewer; one brought in by the user belongs to no conversation */
export interface MediaItem {
  blobId: string;
  conversationId?: string;
  messageId?: string;
  /** Its path in the Files tab, when the caller knows it */
  name?: string;
  /** A video (stored with the images): played, and offered nothing to make from it */
  video?: boolean;
}

/** The viewer over the chat: the items it steps through and the one shown */
export const lightbox = signal<{ items: MediaItem[]; index: number } | null>(null);

/** Open the viewer on one of the images of a message */
export function openLightbox(parts: { blobId: string }[], index: number, owner: { conversationId: string; messageId: string }) {
  lightbox.value = { items: parts.map((p) => ({ blobId: p.blobId, ...owner })), index };
}

/** An item's bytes: the whole, or the small copy grids show (null when not stored in this browser) */
export const loadMedia = (id: string, size: 'full' | 'thumb' = 'full'): Promise<Blob | null> => (size === 'thumb' ? getImageThumb(id) : getImage(id));

/** Where an item is saved in the Files tab */
export const savedPathOf = (id: string): string | undefined => catalogImage(id)?.path;

/** The prompt an item was made from ('' when it was not made from one here) */
export function promptOf(item: MediaItem): string {
  const m = messages.value.find((x) => x.id === item.messageId);
  return m?.image?.params.prompt || m?.video?.params.prompt || '';
}

/** The conversation an item was made in, while it exists */
function chatOf(item: MediaItem): string | undefined {
  const id = item.conversationId;
  return id && (currentId.value === id || conversations.value.some((c) => c.id === id)) ? id : undefined;
}

/** Go where work on an item runs: its chat (saved items outlive theirs, and brought-in ones have none: a new chat then) */
export async function openChatOf(item: MediaItem) {
  const chat = chatOf(item);
  if (chat && currentId.value === chat) return;
  if (chat) await openConversation(chat);
  else startNewChat();
}

/**
 * Delete images and videos: the bytes are removed and the answers that showed them keep an empty slot ("deleted"), so
 * the conversation still reads correctly
 */
export async function deleteMedia(ids: string[]) {
  const gone = new Set(ids);
  const byConv = new Map<string, Set<string>>();
  for (const id of ids) {
    const meta = await getImageMeta(id);
    // Brought-in images belong to no answer
    if (!meta?.conversationId || !meta.messageId) continue;
    const g = byConv.get(meta.conversationId) ?? new Set<string>();
    g.add(meta.messageId);
    byConv.set(meta.conversationId, g);
  }
  for (const [convId, g] of byConv) {
    const list = convId === currentId.value ? messages.value : await repo.listMessages(convId);
    for (const m of list) {
      if (!g.has(m.id)) continue;
      const parts = m.parts
        .filter((p) => !(p.type === 'file' && gone.has(p.blobId)))
        .map((p) => {
          if (p.type !== 'tool' || !p.uiDetails || !Array.isArray((p.uiDetails as { blobIds?: unknown }).blobIds)) return p;
          const d = p.uiDetails as { blobIds: string[] };
          return { ...p, uiDetails: { ...d, blobIds: d.blobIds.filter((b) => !gone.has(b)), deleted: true } };
        });
      await saveMessage({ ...m, parts });
    }
  }
  await deleteImageRecords(ids);
}
