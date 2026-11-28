// A frame of a video, for its thumbnail, and its size. Needs media-src blob: in the CSP (the app's allows it)
/** null poster where the browser cannot play the video */
export async function posterOf(video: Blob): Promise<{ poster: Blob | null; width?: number; height?: number }> {
  const url = URL.createObjectURL(video);
  const v = document.createElement('video');
  try {
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    await waitFor(v, 'loadeddata');
    // A little way in: the very first frame is often black
    v.currentTime = Math.min(0.5, (v.duration || 0) / 2);
    await waitFor(v, 'seeked');
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    const poster = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
    return { poster, width: v.videoWidth || undefined, height: v.videoHeight || undefined };
  } catch {
    return { poster: null };
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

function waitFor(v: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 10_000);
    v.addEventListener(event, () => (clearTimeout(timer), resolve()), { once: true });
    v.addEventListener('error', () => (clearTimeout(timer), reject(new Error('error'))), { once: true });
  });
}
