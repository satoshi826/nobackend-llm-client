// Danbooru tags for the prompt of tag models: the list, searching it, and putting a tag in the prompt.
// The list (tags/danbooru.txt, about 80,000 tags with their post counts and aliases) is one of the app's own files,
// fetched the first time a tag model's prompt is typed and then cached like the app's other files: what is typed
// never leaves the browser.
import { signal } from '@preact/signals';
import listUrl from './tags/danbooru.txt?url';

export type TagCategory = 'general' | 'artist' | 'copyright' | 'character' | 'meta';
const CATEGORIES: Record<string, TagCategory> = { 0: 'general', 1: 'artist', 3: 'copyright', 4: 'character', 5: 'meta' };

/** Tags in Danbooru's form (underscores), most posts first */
export interface TagList {
  names: string[];
  categories: TagCategory[];
  counts: number[];
  aliases: string[][];
}

/** A suggestion; alias: the alias that was typed, when the tag was found by it */
export interface TagMatch {
  name: string;
  category: TagCategory;
  count: number;
  alias?: string;
}

/**
 * The list file: lines of name, category, post count and comma-separated aliases, separated by tabs. Lines without a
 * tab are its header (a tag may start with #, as #compass does)
 */
export function parseTags(text: string): TagList {
  const list: TagList = { names: [], categories: [], counts: [], aliases: [] };
  for (const line of text.split('\n')) {
    if (!line.includes('\t')) continue;
    const [name, category, count, aliases] = line.split('\t');
    list.names.push(name);
    list.categories.push(CATEGORIES[category] ?? 'general');
    list.counts.push(Number(count) || 0);
    list.aliases.push(aliases ? aliases.split(',') : []);
  }
  return list;
}

export const tagList = signal<TagList | null>(null);
let requested = false;

/** Fetch the list once (on failure there are no suggestions until the app is opened again) */
export function loadTags() {
  if (requested) return;
  requested = true;
  void fetch(listUrl)
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
    .then((text) => (tagList.value = parseTags(text)))
    .catch(() => {});
}

/** How a typed query is compared with the list: lower case, underscores for spaces, no escapes */
const keyOf = (query: string) => query.trim().toLowerCase().replace(/\\/g, '').replace(/\s+/g, '_');

/**
 * Tags for what is being typed: the tag or alias it is exactly, then, most posts first, tags that start with it, have
 * a word that does ("miku" finds hatsune_miku), or have an alias that does (shown with the tag it stands for)
 */
export function searchTags(list: TagList, query: string, limit = 8): TagMatch[] {
  const key = keyOf(query);
  if (!key) return [];
  let exact: TagMatch | undefined;
  const starts: TagMatch[] = [];
  const byAlias: TagMatch[] = [];
  const words: TagMatch[] = [];
  const match = (i: number, alias?: string): TagMatch => ({ name: list.names[i], category: list.categories[i], count: list.counts[i], ...(alias ? { alias } : {}) });
  for (let i = 0; i < list.names.length && starts.length < limit; i++) {
    const name = list.names[i];
    if (!exact && (name === key || list.aliases[i].includes(key))) exact = match(i, name === key ? undefined : key);
    if (name.startsWith(key)) starts.push(match(i));
    else if (words.length < limit && (name.includes('_' + key) || name.includes('(' + key))) words.push(match(i));
    else if (byAlias.length < limit) {
      const alias = list.aliases[i].find((a) => a.startsWith(key));
      if (alias) byAlias.push(match(i, alias));
    }
  }
  const found = [...starts, ...byAlias, ...words].sort((a, b) => b.count - a.count).filter((m) => m.name !== exact?.name);
  return (exact ? [exact, ...found] : found).slice(0, limit);
}

/** A tag as people read it: spaces for underscores, which emoticons such as ^_^ keep */
export const tagLabel = (name: string) => (/[a-z0-9]{2}/i.test(name) ? name.replace(/_/g, ' ') : name);

/** A tag as it is written in a prompt: as people read it, with parentheses escaped (they weight words otherwise) */
export const tagText = (name: string) => tagLabel(name).replace(/[()]/g, '\\$&');

/** The tag being typed: what follows the last comma or line break, after any spaces and opening brackets */
function lastTag(text: string): { start: number; lead: string; query: string } {
  const start = Math.max(text.lastIndexOf(','), text.lastIndexOf('\n')) + 1;
  const lead = /^\s*[([{]*/.exec(text.slice(start))![0];
  return { start, lead, query: text.slice(start + lead.length) };
}

export const tagQuery = (text: string) => lastTag(text).query;

/** The text with the tag being typed replaced by a tag, ready for the next one */
export function completeTag(text: string, name: string): string {
  const { start, lead } = lastTag(text);
  const space = start > 0 && text[start - 1] === ',' && !/^\s/.test(lead) ? ' ' : '';
  return `${text.slice(0, start)}${space}${lead}${tagText(name)}, `;
}
