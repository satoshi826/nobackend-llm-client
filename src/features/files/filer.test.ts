import { describe, expect, it } from 'vitest';
import { newFile } from '../../lib/db/files';
import { conversationsWithItems, filterItems, previewText, sortItems, toItems, type ImageMeta } from './filer';

const now = Date.UTC(2026, 10, 25, 12);
const day = 86400_000;
const file = (id: string, name: string, kind: 'document' | 'upload', text: string, updatedAt: number, conversationId?: string) => ({
  ...newFile({ id, name, kind, text, by: kind === 'upload' ? 'upload' : 'model', conversationId }),
  updatedAt
});
const img = (id: string, createdAt: number, conversationId: string, size = 2048): ImageMeta => ({ id, conversationId, messageId: 'm', createdAt, mime: 'image/png', size });

const items = toItems(
  [file('a', 'report.md', 'document', '# Market\nApples are up', now - day, 'c1'), file('b', 'scores.csv', 'upload', 'name,score\nsato,80', now - 10 * day), file('c', 'notes.txt', 'document', 'zzz', now - 2 * day, 'c2')],
  [img('i1', now - 3 * day, 'c1'), img('i2', now - 20 * day, 'c2', 10)],
  (id) => ({ c1: 'Fruit', c2: 'Misc' })[id]
);

describe('file manager items', () => {
  it('names images after their conversation', () => {
    expect(items.find((i) => i.id === 'i1')!.name).toMatch(/^Fruit \d{8}-\d{6}\.png$/);
  });
  it('filters by view, conversation and query (contents too)', () => {
    const f = (o: Partial<Parameters<typeof filterItems>[1]>) => filterItems(items, { view: 'all', conversationId: null, query: '', ...o }, now).map((i) => i.id);
    expect(f({ view: 'document' })).toEqual(['a', 'c']);
    expect(f({ view: 'upload' })).toEqual(['b']);
    expect(f({ view: 'image' })).toEqual(['i1', 'i2']);
    expect(f({ view: 'recent' })).toEqual(['a', 'c', 'i1']);
    expect(f({ conversationId: 'c1' })).toEqual(['a', 'i1']);
    expect(f({ query: 'apples' })).toEqual(['a']);
    expect(f({ query: 'fruit' })).toEqual(['i1']);
  });
  it('sorts by date, name, type and size', () => {
    expect(sortItems(items, 'updated').map((i) => i.id)).toEqual(['a', 'c', 'i1', 'b', 'i2']);
    expect(sortItems(items, 'name')[0].id).toBe('i1');
    expect(sortItems(items, 'type').map((i) => i.ext)).toEqual(['csv', 'md', 'png', 'png', 'txt']);
    // Files (characters) before images (bytes), each largest first
    expect(sortItems(items, 'size').map((i) => i.id)).toEqual(['a', 'b', 'c', 'i1', 'i2']);
  });
  it('groups items by conversation, most recent first', () => {
    expect(conversationsWithItems(items)).toEqual([
      { id: 'c1', count: 2, latest: now - day },
      { id: 'c2', count: 2, latest: now - 2 * day }
    ]);
  });
  it('previews the first lines of text without Markdown marks', () => {
    expect(previewText('# Title\n\n**bold** text\n', 'md')).toBe('Title\nbold text');
  });
});
