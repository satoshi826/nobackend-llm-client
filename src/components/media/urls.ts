// Object URLs of stored images and videos (decrypted on demand)
import { useEffect, useState } from 'preact/hooks';
import { loadMedia } from '../../state/media';

/**
 * Image URLs per item and size. Each is counted while on screen; ones no longer shown are kept for a while (going
 * back to them is instant) and then freed, oldest first
 */
type UrlEntry = { url: Promise<string | null>; users: number };
const urls = new Map<string, UrlEntry>();
const KEEP_UNUSED = 60;

function acquireUrl(key: string, load: () => Promise<Blob | null>): Promise<string | null> {
  let e = urls.get(key);
  if (!e) e = { url: load().then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null), users: 0 };
  // Map order is recency: the most recently used come last
  urls.delete(key);
  urls.set(key, e);
  e.users++;
  return e.url;
}

function releaseUrl(key: string) {
  const e = urls.get(key);
  if (!e) return;
  e.users--;
  let unused = [...urls.values()].filter((x) => x.users <= 0).length;
  for (const [k, x] of urls) {
    if (unused <= KEEP_UNUSED) break;
    if (x.users > 0) continue;
    urls.delete(k);
    unused--;
    void x.url.then((u) => u && URL.revokeObjectURL(u));
  }
}

/** Forget (and free) the URLs of deleted items */
export function releaseMediaUrls(ids: string[]) {
  for (const id of ids)
    for (const key of [`full:${id}`, `thumb:${id}`]) {
      const e = urls.get(key);
      urls.delete(key);
      void e?.url.then((u) => u && URL.revokeObjectURL(u));
    }
}

/** The URL of an image: the whole, or its thumbnail. Loads only once `enabled` (e.g. near the screen) */
export function useImageUrl(blobId: string | undefined, size: 'full' | 'thumb' = 'full', enabled = true): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setUrl(undefined);
    if (!blobId || !enabled) return;
    let alive = true;
    const key = `${size}:${blobId}`;
    void acquireUrl(key, () => loadMedia(blobId, size)).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
      releaseUrl(key);
    };
  }, [blobId, size, enabled]);
  return url;
}

/**
 * The URL of stored bytes (the whole, or the small copy), made when blobId is set and freed when it changes or the
 * component goes: for videos, too large to keep in the image cache
 */
export function useBlobUrl(blobId: string | undefined, size: 'full' | 'thumb' = 'full'): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setUrl(undefined);
    if (!blobId) return;
    let made: string | null = null;
    let alive = true;
    void loadMedia(blobId, size)
      .then((b) => {
        made = b ? URL.createObjectURL(b) : null;
        if (alive) setUrl(made);
        else if (made) URL.revokeObjectURL(made);
      })
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [blobId, size]);
  return url;
}
