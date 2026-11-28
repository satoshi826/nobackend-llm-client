// @vitest-environment jsdom
// How much the file manager draws when one thing changes, counted as the perf runs count it (src/lib/perf/counter.ts):
// picking an entry draws that entry again, and a new file draws its own card, not the others.
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { startPerfCounting } from '../../../perf/counter';
import { createFile, newFile } from '../../../lib/db/files';
import { filerView, refreshFiles, refreshImages } from '../state';
import { Filer } from './Filer';

// jsdom has no IntersectionObserver (the list draws in batches with one) or ResizeObserver (a selected row's highlight)
class NoObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
const drawn = (name: string) => window.__perfCounts!.byName[name] ?? 0;
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

beforeAll(() => {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = NoObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoObserver;
  startPerfCounting();
});

describe('the file manager draws only what changed', () => {
  it('draws only the card that changed: one picked, one saved', async () => {
    for (let i = 0; i < 40; i++) await createFile(newFile({ id: `f${i}`, name: `notes-${i}.md`, origin: { kind: 'made' }, text: `text ${i}`, by: 'model' }), `text ${i}`);
    await refreshFiles();
    await refreshImages();
    filerView.value = 'text';
    const box = document.createElement('div');
    document.body.append(box);
    await act(() => render(<Filer />, box));
    await settle();
    expect(box.querySelectorAll('[data-entry]')).toHaveLength(40);

    const checks = () => box.querySelectorAll<HTMLInputElement>('[data-entry] input[type="checkbox"]');
    for (const i of [0, 1, 2]) {
      const before = drawn('Card');
      await act(() => checks()[i].click());
      await settle();
      expect(drawn('Card') - before).toBe(1);
    }
    expect([...checks()].filter((c) => c.checked)).toHaveLength(3);

    // A file saved while the list is open (each save makes the list anew)
    const before = drawn('Card');
    await createFile(newFile({ id: 'new', name: 'notes-new.md', origin: { kind: 'made' }, text: 'new', by: 'model' }), 'new');
    await settle();
    expect(box.querySelectorAll('[data-entry]')).toHaveLength(41);
    expect(drawn('Card') - before).toBe(1);
    render(null, box);
  });
});
