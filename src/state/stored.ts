// Bumped when stored images (and videos) or files change, wherever the change came from; lists that show them
// reload on it. Changes are gathered for a frame and announced once: saving many files one after another (a model,
// an upload) reloads the lists once a frame, not once a file
import { batch, signal } from '@preact/signals';
import { onStoreChange, type StoreName } from '../lib/db/changes';

export const imagesVersion = signal(0);
export const filesVersion = signal(0);

const pending = new Set<StoreName>();
const nextFrame = (f: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : setTimeout(f, 16));

onStoreChange((store) => {
  if (!pending.size) nextFrame(announce);
  pending.add(store);
});

function announce() {
  batch(() => {
    if (pending.has('images')) imagesVersion.value++;
    if (pending.has('files')) filesVersion.value++;
  });
  pending.clear();
}
