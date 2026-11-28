// Bumped when stored files change, wherever the change came from; lists that show them reload on it. Changes are
// gathered for a frame and announced once: saving many files one after another (a model, an upload) reloads the
// lists once a frame, not once a file
import { signal } from '@preact/signals';
import { onFilesChange } from '../lib/db/changes';

export const filesVersion = signal(0);

let pending = false;
const nextFrame = (f: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : setTimeout(f, 16));

onFilesChange(() => {
  if (pending) return;
  pending = true;
  nextFrame(() => {
    pending = false;
    filesVersion.value++;
  });
});
