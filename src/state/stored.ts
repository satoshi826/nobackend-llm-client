// Bumped whenever stored images (and videos) or files change, wherever the change came from; lists that show them
// reload on it
import { signal } from '@preact/signals';
import { onStoreChange } from '../lib/db/changes';

export const imagesVersion = signal(0);
export const filesVersion = signal(0);

onStoreChange((store) => {
  if (store === 'images') imagesVersion.value++;
  else filesVersion.value++;
});
