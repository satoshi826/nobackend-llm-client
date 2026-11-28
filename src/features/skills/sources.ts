// Files the user picks or drops, at their paths: a folder's files under its name ('my-skill/scripts/a.js')
import type { ImportSource } from '../../lib/skills/package';

/** Entries read from a dropped folder at most (a skill has far fewer; lib/skills/package.ts refuses more) */
const MAX_WALK = 2000;

/** Files from a file or folder picker (a folder picker gives each file its path inside the folder) */
export const pickedSources = (files: FileList | File[]): ImportSource[] => [...files].map((file) => ({ path: file.webkitRelativePath || file.name, file }));

/** Files and folders dropped, read through their entries (must be called while the drop event is handled) */
export function droppedSources(dt: DataTransfer): Promise<ImportSource[]> {
  // The entries must be taken before anything is awaited: the drop's data is gone after the event
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return Promise.resolve(pickedSources(dt.files));
  return walk(entries);
}

async function walk(entries: FileSystemEntry[]): Promise<ImportSource[]> {
  const out: ImportSource[] = [];
  const queue = [...entries];
  while (queue.length && out.length < MAX_WALK) {
    const e = queue.shift()!;
    if (e.isFile) {
      const file = await new Promise<File>((resolve, reject) => (e as FileSystemFileEntry).file(resolve, reject));
      out.push({ path: e.fullPath.replace(/^\//, ''), file });
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      // A folder's entries come a batch at a time, until an empty one
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        queue.push(...batch);
      }
    }
  }
  return out;
}
