// The working folder: the one folder a conversation's model reads and writes, its file tools, and loading the data
import { effect } from '@preact/signals';
import * as fdb from '../../../lib/db/files';
import { moveIntoWorkDirs, renumberTakenPaths } from '../../../lib/db/paths';
import { atPath, catalogImage, ensureCatalog, withTakenPaths, type ImageEntry } from '../../../lib/db/catalog';
import { cleanFileName, cleanFolderName, extOf, folderNameFor, freeFolder, isInside, mimeFromName, pathFree, pathKey } from '../../../lib/paths';
import { newId } from '../../../lib/db/repo';
import { listImages, renameImages } from '../../../lib/db/images';
import type { Conversation, FileRecord, MessageRecord } from '../../../lib/db/schema';
import { conversations, currentConv, updateConversation } from '../../../state/conversations';
import { registerDataLoader } from '../../../state/lifecycle';
import { defineFeatureSettings, pickLegacy } from '../../../state/feature-settings';
import { registerToolProvider } from '../../../state/tool-registry';
import { filesNote, makeFileTools, MAX_MATCHES, type Match } from '../tools';
import { t } from '../messages';
import { fetchFromWeb } from '../../../state/fetch-page';
import type { Fetched } from '../../../lib/fetcher/protocol';
import { inspectPage, runJavaScript } from '../../../lib/sandbox/client';
import { importImage, importOne } from './imports';
import { fileList, imageList, refreshFiles, refreshImages } from './lists';
import { deleteFiles } from './manage';
import { pageOf } from './pages';
import { TranslatedError } from '../../../lib/i18n';
import { parseInSandbox, syntaxProblem } from '../syntax';

/** Let chat models work on the files of their working folder (the file tools) */
export const fileSettings = defineFeatureSettings('files', { fileTools: true }, { legacy: (old) => pickLegacy(old, { fileTools: true }) });

/** Keep what was fetched in the conversation's working folder (so its tools can read it): a file, or an image */
async function saveFetched(r: Fetched, conv: Conversation): Promise<{ kind: 'file'; file: FileRecord } | { kind: 'image'; name: string } | null> {
  const file = new File([r.data], r.name, { type: r.mime });
  const id = newId();
  const dir = await ensureWorkDir(conv.id, r.name);
  if (r.mime.startsWith('image/')) {
    const path = await importImage(file, id, { kind: 'web', url: r.url }, conv, dir);
    return path ? { kind: 'image', name: path.slice(dir.length) } : null;
  }
  const rec = await importOne(file, id, !!conv.temporary, r.url, conv.id, dir);
  return rec ? { kind: 'file', file: rec } : null;
}

/** The conversation's working folder as it is now ('todo-app/'; '' before its first file) */
export function workDirOf(convId: string): string {
  return conversations.value.find((x) => x.id === convId)?.workDir ?? '';
}

/**
 * The conversation's working folder, made now if it has none: named `name` (the model's choice, one level), else
 * after the file that makes it (`firstFile`). Not one that another chat works in, even while it is empty
 */
async function ensureWorkDir(convId: string, firstFile: string, name = ''): Promise<string> {
  return (
    workDirOf(convId) ||
    withTakenPaths(async (space) => {
      // Another call may have made it while this one waited its turn
      const made = workDirOf(convId);
      if (made) return made;
      const others = conversations.value.flatMap((c) => (c.id !== convId && c.workDir ? [pathKey(c.workDir)] : []));
      const used = (k: string) => others.some((o) => o.startsWith(k) || k.startsWith(o));
      const dir = freeFolder(cleanFolderName(name.replace(/[\\/]/g, '-')) || folderNameFor(firstFile, Date.now()), space, used);
      await updateConversation({ workDir: dir }, convId);
      return dir;
    })
  );
}

/** Files attached to the conversation's messages: the model may read them, wherever they are */
function attachedIds(history: MessageRecord[]): Set<string> {
  return new Set(history.flatMap((m) => (m.attachments ?? []).map((a) => a.fileId)));
}

/** A file the model of a conversation may read: by id, or by path in its working folder (else undefined) */
async function readableFile(convId: string, history: MessageRecord[], ref: string): Promise<FileRecord | undefined> {
  const dir = workDirOf(convId);
  const byId = await fdb.getFile(ref);
  if (byId) return (dir && isInside(byId.name, dir)) || attachedIds(history).has(byId.id) ? byId : undefined;
  if (!dir) return undefined;
  await fdb.listFiles();
  const at = atPath(dir + cleanFileName(ref, extOf(ref) || 'md'));
  return at?.kind === 'file' ? at.file : undefined;
}

/** An image in the conversation's working folder, by its id or its path there (else undefined) */
async function folderImage(convId: string, ref: string): Promise<ImageEntry | undefined> {
  const dir = workDirOf(convId);
  if (!dir) return undefined;
  await ensureCatalog();
  const at = atPath(dir + cleanFileName(ref, extOf(ref) || 'png'));
  const im = catalogImage(ref) ?? (at?.kind === 'image' ? at.image : undefined);
  return im && isInside(im.path, dir) ? im : undefined;
}

/** A file this conversation's model may read (in its working folder, or attached): its path and text, for other features' tools */
export async function conversationFile(conv: Conversation, history: MessageRecord[], ref: string): Promise<{ name: string; text: string } | undefined> {
  const f = await readableFile(conv.id, history, ref);
  return f && { name: relativeTo(workDirOf(conv.id), f.name), text: await fdb.readText(f.id) };
}

/** A path as the model sees it: relative to the working folder (whole when outside it) */
const relativeTo = (dir: string, path: string) => (dir && isInside(path, dir) ? path.slice(dir.length) : path);

/**
 * Lines of the working folder's files that match a pattern from the model. It runs in a sandbox worker, stopped
 * after RUN_TIMEOUT_MS: a pattern that backtracks without end must not freeze the app
 */
async function searchFolder(dir: string, pattern: string, ignoreCase: boolean, only: string | null): Promise<Match[]> {
  if (!dir) return [];
  const pick = only ? new RegExp(only, 'i') : null;
  const inDir = (await fdb.listFiles()).filter((f) => isInside(f.name, dir) && (!pick || pick.test(f.name.slice(dir.length))));
  const texts = await fdb.readTexts(inDir.map((f) => f.id));
  const files: Record<string, string> = {};
  for (const f of inDir) files[f.name.slice(dir.length)] = texts.get(f.id) ?? '';
  const code = `const re = new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify(ignoreCase ? 'i' : '')});
const out = [];
for (const [path, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
  const lines = text.split('\\n');
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    out.push({ path, line: i + 1, text: lines[i].slice(0, 2000) });
    if (out.length > ${MAX_MATCHES}) return out;
  }
}
return out;`;
  const r = await runJavaScript(code, { files });
  if (r.error || r.result === undefined) throw new TranslatedError(() => t('tool.searchFailed', { message: r.error ?? '' }));
  return JSON.parse(r.result) as Match[];
}

function fileTools(conv: Conversation, history: MessageRecord[]) {
  const dir = () => workDirOf(conv.id);
  /** A file the model may change: one in the working folder (one attached from outside is only read) */
  const inFolder = async (id: string) => {
    const f = await fdb.getFile(id);
    if (!f) throw new TranslatedError(() => t('tool.notFound'));
    if (!dir() || !isInside(f.name, dir())) throw new TranslatedError(() => t('tool.readOnly', { name: f.name }));
    return f;
  };
  return makeFileTools(
    {
      async fetch(url, signal) {
        const r = await fetchFromWeb(url, 'save', signal);
        return r && (await saveFetched(r, conv));
      },
      async create(path, text, folder) {
        const d = await ensureWorkDir(conv.id, path, folder);
        return withTakenPaths(async (space) => {
          const full = d + path;
          const at = atPath(full);
          // One file per path: writing to a path the folder has replaces that file's text
          if (at?.kind === 'file') return { file: await fdb.setText(at.file.id, text, 'model'), replaced: true };
          if (!pathFree(full, space)) throw new TranslatedError(() => t('tool.pathTaken', { name: path }));
          const f = fdb.newFile({ id: newId(), name: full, origin: { kind: 'made' }, text, by: 'model', conversationId: conv.id });
          return { file: await fdb.createFile(f, text, !!conv.temporary), replaced: false };
        });
      },
      get: (ref) => readableFile(conv.id, history, ref),
      text: (f, previous) => fdb.readText(f.id, previous ? 'previous' : 'current'),
      async update(id, text, append) {
        return fdb.setText((await inFolder(id)).id, text, 'model', append);
      },
      async list() {
        const d = dir();
        if (!d) return [];
        const [files, images] = await Promise.all([fdb.listFiles(), listImages()]);
        return [
          ...files.filter((f) => isInside(f.name, d)).map((f) => ({ path: f.name.slice(d.length), kind: 'file' as const, bytes: f.bytes })),
          ...images.filter((im) => isInside(im.path, d)).map((im) => ({ path: im.path.slice(d.length), kind: 'image' as const, bytes: im.size }))
        ];
      },
      search: (pattern, ignoreCase, only) => searchFolder(dir(), pattern, ignoreCase, only),
      async move(id, to) {
        await inFolder(id);
        const full = dir() + to;
        return withTakenPaths(async (space) => {
          // Read inside the queue: an edit waiting before this one is kept
          const f = await inFolder(id);
          if (!pathFree(full, space, id)) throw new TranslatedError(() => t('tool.moveTaken', { name: to }));
          return fdb.putFile({ ...f, name: full, mime: mimeFromName(full) });
        });
      },
      async image(ref) {
        const im = await folderImage(conv.id, ref);
        return im && { id: im.id, path: relativeTo(dir(), im.path), mime: im.mime };
      },
      async moveImage(id, to) {
        const full = dir() + to;
        await withTakenPaths(async (space) => {
          // Checked again in the queue: a move waiting before this one may have taken it out
          if (!(await folderImage(conv.id, id))) throw new TranslatedError(() => t('tool.moveNotHere', { id }));
          if (!pathFree(full, space, id)) throw new TranslatedError(() => t('tool.moveTaken', { name: to }));
          await renameImages([{ id, path: full }]);
        });
      },
      async remove(id) {
        await inFolder(id);
        await deleteFiles([id]);
      },
      async inspect(f, o, signal) {
        // Only what lies in the working folder, even when the page's site reaches above it
        const page = await pageOf(f, dir());
        const items = page.storage?.items() ?? {};
        // Its data as the user's preview has it, but what it stores while being tried is not kept
        return inspectPage(await fdb.readText(f.id), { ...page, storage: { items: () => items, save: () => {} } }, { ...o, signal });
      },
      pathOf: (f) => relativeTo(dir(), f.name),
      syntax: (path, text) => syntaxProblem(path, text, parseInSandbox)
    },
    { hasFolder: !!dir() }
  );
}

/** Files of the working folder listed in the system prompt at most (the rest are found with list_files) */
const NOTE_FILES = 200;

registerToolProvider({
  id: 'files',
  label: () => t('files'),
  // Until the working folder exists only write_file and fetch_file; once a file made it (in this answer too) all
  tools: ({ conv, history }) => (fileSettings.value.value.fileTools ? fileTools(conv, history) : []),
  dynamicTools: ({ conv, history }) => (fileSettings.value.value.fileTools && workDirOf(conv.id) ? fileTools(conv, history) : []),
  systemNote({ conv }) {
    const dir = workDirOf(conv.id);
    if (!fileSettings.value.value.fileTools || !dir) return undefined;
    // The list is loaded with the conversation (below); while it loads, only the folder is named
    const files = fileList.value?.filter((f) => isInside(f.name, dir)).map((f) => ({ id: f.id, path: f.name.slice(dir.length), bytes: f.bytes })) ?? null;
    return filesNote(dir, files, NOTE_FILES);
  }
});

// The system note lists the working folder's files from the file list: loaded once a conversation with one is open
effect(() => {
  if (currentConv.value.workDir && !fileList.peek()) void refreshFiles();
});

// Once the data can be read (and after an import): the catalog loads (converting data in older shapes), conversations
// from before working folders get one (development only, goes before release), and paths two things share get a number
registerDataLoader(async () => {
  await fdb.listFiles();
  const moved = await moveIntoWorkDirs(conversations.value);
  if (moved.length) conversations.value = conversations.value.map((c) => moved.find((m) => m.id === c.id) ?? c);
  await renumberTakenPaths();
  if (fileList.peek()) await refreshFiles();
  if (imageList.peek()) await refreshImages();
});
