import { describe, expect, it } from 'vitest';
import { newFile } from '../../../lib/db/files';
import { conversationsWithItems, filterItems, previewText, sortItems, toItems } from './items';
import { entryOf, type FileEntry } from '../../../lib/db/catalog';

const now = Date.UTC(2026, 10, 25, 12);
const day = 86400_000;
const file = (id: string, path: string, kind: 'document' | 'upload', text: string, updatedAt: number, conversationId?: string) =>
  entryOf({ ...newFile({ id, path, origin: kind === 'upload' ? { kind: 'upload' } : { kind: 'made' }, text, by: kind === 'upload' ? 'upload' : 'model', conversationId }), updatedAt });
const img = (id: string, path: string, at: number, conversationId: string, bytes = 2048): FileEntry =>
  entryOf({ id, path, conversationId, messageId: 'm', createdAt: at, updatedAt: at, mime: 'image/png', bytes, origin: { kind: 'made' }, current: { at, by: 'model' } });

const items = toItems([
  file('a', 'report.md', 'document', '# Market\nApples are up', now - day, 'c1'),
  file('b', 'scores.csv', 'upload', 'name,score\nsato,80', now - 10 * day),
  file('c', 'notes.txt', 'document', 'zzz', now - 2 * day, 'c2'),
  img('i1', 'fruit-20261127-160816.png', now - 3 * day, 'c1'),
  img('i2', 'misc.png', now - 20 * day, 'c2', 10)
]);

describe('file manager items', () => {
  it('lists an image by its path', () => {
    expect(items.find((i) => i.id === 'i1')!.name).toBe('fruit-20261127-160816.png');
  });
  it('filters by view, conversation and query (contents too)', () => {
    const f = (o: Partial<Parameters<typeof filterItems>[1]>) => filterItems(items, { view: 'all', conversationId: null, query: '', ...o }).map((i) => i.id);
    expect(f({ view: 'document' })).toEqual(['a', 'c', 'i1', 'i2']);
    expect(f({ view: 'upload' })).toEqual(['b']);
    expect(f({ view: 'image' })).toEqual(['i1', 'i2']);
    expect(f({ view: 'text' })).toEqual(['a', 'b', 'c']);
    expect(f({ conversationId: 'c1' })).toEqual(['a', 'i1']);
    expect(f({ query: 'apples' })).toEqual(['a']);
    expect(f({ query: 'fruit' })).toEqual(['i1']);
  });
  it('sorts by date, name, type and size', () => {
    expect(sortItems(items, 'updated').map((i) => i.id)).toEqual(['a', 'c', 'i1', 'b', 'i2']);
    expect(sortItems(items, 'name')[0].id).toBe('i1');
    expect(sortItems(items, 'type').map((i) => i.ext)).toEqual(['csv', 'md', 'png', 'png', 'txt']);
    // Files and images by one measure, bytes, largest first
    expect(sortItems(items, 'size').map((i) => i.id)).toEqual(['i1', 'a', 'b', 'i2', 'c']);
  });
  it('sorts either way', () => {
    expect(sortItems(items, 'updated', 'asc').map((i) => i.id)).toEqual(['i2', 'b', 'i1', 'c', 'a']);
    expect(sortItems(items, 'size', 'asc').map((i) => i.id)).toEqual(['c', 'i2', 'b', 'a', 'i1']);
  });
  it('groups items by conversation, most recent first', () => {
    expect(conversationsWithItems(items)).toEqual([
      { id: 'c1', count: 2, latest: now - day },
      { id: 'c2', count: 2, latest: now - 2 * day }
    ]);
  });
  it('previews the first lines of text without Markdown marks', () => {
    expect(previewText('# Title\n\n**bold** text\n', 'md')).toBe('Title\nbold text');
    expect(previewText('- one\n2. two\n', 'md')).toBe('one\ntwo');
  });
});
