// Copying to the clipboard: says it worked, or that it did not (the browser may refuse)
import { showToast } from '../state/ui';
import { t } from './messages';

export async function copyText(text: string, done = t('msg.copied')) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(done);
  } catch {
    showToast(t('msg.copyFailed'), 'error');
  }
}
