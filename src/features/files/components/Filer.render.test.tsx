// @vitest-environment jsdom
// How much the file manager draws when one thing changes, counted as the perf runs count it (src/lib/perf/counter.ts):
// picking an entry draws that entry again, not the others.
import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { startPerfCounting } from '../../../lib/perf/counter';
import { createFile, newFile } from '../../../lib/db/files';
import { filerView, refreshFiles, refreshImages } from '../state';
import { Filer } from './Filer';

// jsdom has no IntersectionObserver (the list draws in batches with one)
class NoObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
const drawn = (name: string) => window.__perfCounts!.byName[name] ?? 0;
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

beforeAll(() => {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = NoObserver;
  startPerfCounting();
});

describe('the file manager draws only what changed', () => {
  it('draws one card again when one entry is picked, and none of the others', async () => {
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
    render(null, box);
  });
});
