// Experimental (VITE_EXPERIMENTAL_PAGE_API): what a page the user shows from the sandbox may ask the app for. Its
// site's files (nbl.files), a model's answer (nbl.chat), and with a relay, GETs of the web through the fetch page
// (fetch). Pages a model tries (preview_page) get none of it.
import * as fdb from '../../../lib/db/files';
import { newId } from '../../../lib/db/repo';
import { getImage, listImages } from '../../../lib/db/images';
import type { FileRecord } from '../../../lib/db/schema';
import { isInside, pathKey } from '../../../lib/paths';
import { getPreset } from '../../../lib/providers/registry';
import { completeText } from '../../../lib/chat/extract';
import { PAGE_WEB } from '../../../lib/fetcher/config';
import type { PageApi } from '../../../lib/sandbox/client';
import { vaultTransport as transport } from '../../../lib/vault/client';
import { authFor } from '../../../state/keys';
import { accountInUse, defaultModel, providerById } from '../../../state/models';
import { providerOptionsFor, recordUsage } from '../../../state/request-helpers';
import { fetchForPage } from '../../../state/fetch-page';

/** A page's model calls in a minute at most: a loop in a page must not run up a bill */
const CHAT_PER_MINUTE = 20;

/**
 * A path the page names, as a path of its site: relative to the site's top ('/' at the start is the top too), with
 * no empty, '.' or '..' parts. Its localStorage file is left to localStorage
 */
function sitePath(site: string, raw: string): string {
  const parts = raw.replace(/^\/+/, '').split('/');
  if (!raw.trim() || parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\'))) throw new Error(`Not a path in the site: ${raw}`);
  const path = site + parts.join('/');
  if (pathKey(path) === pathKey(`${site}localStorage.json`)) throw new Error('localStorage.json is kept through localStorage.');
  return path;
}

/** write: a text file of the site written as its pages do (false: the path is taken by an image or a folder) */
export function pageApi(page: FileRecord, site: string, write: (path: string, text: string) => Promise<boolean>): PageApi {
  const chats: number[] = [];
  return {
    ...(PAGE_WEB
      ? {
          fetch: async (url, signal) => {
            const r = await fetchForPage(url, signal);
            if ('error' in r) throw new Error(r.error);
            return { url: r.url, mime: r.mime, data: r.data };
          }
        }
      : {}),
    files: {
      list: async () => {
        const [files, images] = await Promise.all([fdb.listFiles(), listImages()]);
        return [...files.map((f) => f.name), ...images.map((im) => im.path)].filter((p) => isInside(p, site)).map((p) => p.slice(site.length)).sort();
      },
      read: async (raw) => {
        const key = pathKey(sitePath(site, raw));
        const file = (await fdb.listFiles()).find((f) => pathKey(f.name) === key);
        if (file) return fdb.readText(file.id);
        const image = (await listImages()).find((im) => pathKey(im.path) === key);
        return image ? getImage(image.id) : null;
      },
      write: async (raw, text) => {
        const path = sitePath(site, raw);
        if (text.length > fdb.MAX_FILE_CHARS) throw new Error(`Too long for a file (${fdb.MAX_FILE_CHARS} characters at most).`);
        if (!(await write(path, text))) throw new Error(`An image or a folder is already at ${raw}.`);
      }
    },
    // The model of the next new chat, as the app would choose it
    chat: async (prompt, system, signal) => {
      const now = Date.now();
      while (chats.length && now - chats[0] > 60_000) chats.shift();
      if (chats.length >= CHAT_PER_MINUTE) throw new Error(`A page may ask the model ${CHAT_PER_MINUTE} times a minute at most.`);
      chats.push(now);
      const { providerId, modelId } = defaultModel();
      const cfg = providerById(providerId);
      if (!cfg || !modelId || !accountInUse(cfg.id)) throw new Error('No model is available (none is set up, or the app is locked).');
      return completeText(
        [...(system ? [{ id: 's', role: 'system' as const, parts: [{ type: 'text' as const, text: system }] }] : []), { id: 'u', role: 'user', parts: [{ type: 'text', text: prompt }] }],
        {},
        {
          provider: cfg,
          preset: getPreset(cfg.preset),
          auth: authFor(cfg.id),
          transport,
          model: modelId,
          providerOptions: providerOptionsFor(cfg.id, 'summary'),
          signal,
          onUsage: (usage, costUsd) =>
            recordUsage({ id: newId(), conversationId: page.conversationId, providerId: cfg.id, model: modelId, kind: 'chat', usage, costUsd, temporary: fdb.isTemporaryFile(page.id) })
        }
      );
    }
  };
}
