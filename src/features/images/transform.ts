// What chat models see for image answers: a short note instead of the image data
import type { MessageRecord } from '../../lib/db/schema';
import type { Part } from '../../lib/providers/types';
import { t } from './messages';

export function imageNote(m: MessageRecord, parts: Part[]): Part[] {
  if (m.role !== 'assistant' || !m.image) return parts;
  if (m.status !== 'done') return [];
  const n = m.parts.filter((p) => p.type === 'file').length;
  const p = m.image.params;
  const prompt = p.prompt.slice(0, 200);
  if (n === 0 && p.op === 'generate') return [{ type: 'text', text: t('note.deleted', { prompt }) }];
  const text =
    p.op === 'generate'
      ? t(n === 1 ? 'note.generatedOne' : 'note.generatedMany', { n, prompt })
      : p.op === 'upscale'
        ? t('note.upscaled', { prompt })
        : p.op === 'edit'
          ? t('note.edited', { prompt })
          : t('note.removedBg', { prompt });
  return [{ type: 'text', text }];
}
