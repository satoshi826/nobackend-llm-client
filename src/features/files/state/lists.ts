// What lists show: files and images without their contents, from the catalog (lib/db/catalog.ts), and searching them
import { effect, signal } from '@preact/signals';
import * as fdb from '../../../lib/db/files';
import {  listImages } from '../../../lib/db/images';
import type { ImageEntry } from '../../../lib/db/catalog';
import type {  FileRecord } from '../../../lib/db/schema';
import { filesVersion, imagesVersion } from '../../../state/stored';

export const fileList = signal<FileRecord[] | null>(null);
export const imageList = signal<ImageEntry[] | null>(null);

/** Bring the lists up to date (the catalog is in memory once loaded, so this is cheap) */
export async function refreshFiles(): Promise<void> {
  fileList.value = await fdb.listFiles();
}
export async function refreshImages(): Promise<void> {
  imageList.value = await listImages();
}

// Lists already shown follow every change to the stored files and images (whoever made it)
effect(() => {
  void filesVersion.value;
  if (fileList.peek()) void refreshFiles();
});
effect(() => {
  void imagesVersion.value;
  if (imageList.peek()) void refreshImages();
});

export const getFile = fdb.getFile;

/** Lowercased texts for searching inside files, by id with the change they belong to (read the first time a search needs them) */
const searchTexts = new Map<string, { at: number; text: string }>();

/** The files whose whole text holds `query` (read only for a search: lists carry no texts) */
export async function searchContents(query: string): Promise<Set<string>> {
  const q = query.trim().toLowerCase();
  const files = await fdb.listFiles();
  const stale = files.filter((f) => searchTexts.get(f.id)?.at !== f.updatedAt);
  for (let i = 0; i < stale.length; i += 200) {
    const part = stale.slice(i, i + 200);
    const texts = await fdb.readTexts(part.map((f) => f.id));
    for (const f of part) searchTexts.set(f.id, { at: f.updatedAt, text: (texts.get(f.id) ?? '').toLowerCase() });
  }
  return new Set(files.filter((f) => searchTexts.get(f.id)?.text.includes(q)).map((f) => f.id));
}
/** A file's current text (or the one before its last change) */
export const readText = fdb.readText;

/** How many files there are, and their characters (temporary ones not counted) */
export const fileUsage = fdb.fileUsage;
