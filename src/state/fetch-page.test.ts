import { describe, expect, it } from 'vitest';
import { fetchFromWeb, fetchRequest, type Fetched } from './fetch-page';

describe('fetching through the fetch page', () => {
  it('shows one request at a time and resolves with what the page returns', async () => {
    const p = fetchFromWeb('https://a.example/x', 'read');
    expect(fetchRequest.value).toMatchObject({ url: 'https://a.example/x', mode: 'read' });
    const got: Fetched = { name: 'x', mime: 'text/html', data: new ArrayBuffer(1), url: 'https://a.example/x', via: 'direct' };
    fetchRequest.value!.done(got);
    expect(await p).toBe(got);
    expect(fetchRequest.value).toBeNull();
  });

  it('cancels a request that is still open when a new one starts', async () => {
    const first = fetchFromWeb('https://a.example/1', 'read');
    const second = fetchFromWeb('https://a.example/2', 'save');
    expect(await first).toBeNull();
    expect(fetchRequest.value?.url).toBe('https://a.example/2');
    fetchRequest.value!.done(null);
    expect(await second).toBeNull();
  });
});
