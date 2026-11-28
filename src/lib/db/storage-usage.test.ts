import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { approxBytes, storageBreakdown } from './storage-usage';
import { db } from './schema';

describe('storage breakdown', () => {
  it('counts binary data as is and characters by the bytes they take', () => {
    expect(approxBytes('abc')).toBe(3);
    expect(approxBytes('あい')).toBe(4);
    expect(approxBytes(new Uint8Array(10))).toBe(10);
    expect(approxBytes({ a: 'xy', b: [1] })).toBe(1 + 2 + 1 + 1 + 8);
  });

  it('adds up each kind of data from its tables', async () => {
    await db().conversations.put({ id: 'c', title: 'c', createdAt: 1, updatedAt: 1, currentLeafId: null, providerId: 'p', modelId: 'm', systemPrompt: '', webSearch: 'off', pinned: 0, tags: [] });
    await db().messages.put({ id: 'm', conversationId: 'c', parentId: null, role: 'user', parts: [{ type: 'text', text: 'x'.repeat(1000) }], createdAt: 1, status: 'done' });
    // A file's text lives in fileData (the record itself holds only a preview)
    await db().fileData.put({ id: 'f:current', fileId: 'f', text: 'y'.repeat(500) } as never);
    const b = await storageBreakdown();
    expect(b.conversations.count).toBe(1);
    expect(b.conversations.bytes).toBeGreaterThan(1000);
    expect(b.files).toMatchObject({ count: 0 });
    expect(b.files.bytes).toBeGreaterThan(500);
    expect(b.images).toEqual({ count: 0, bytes: 0 });
    expect(b.videos).toEqual({ count: 0, bytes: 0 });
  });
});
