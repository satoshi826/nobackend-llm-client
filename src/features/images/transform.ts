// What chat models see for image answers: a short note instead of the image data (for the model only: English, like
// the tool descriptions)
import type { MessageRecord } from '../../lib/db/schema';
import type { Part } from '../../lib/providers/types';

export function imageNote(m: MessageRecord, parts: Part[]): Part[] {
  if (m.role !== 'assistant') return parts;
  if (!m.image) {
    // Images a chat model put in its reply: a note after the text (video answers have their own note)
    const n = m.parts.filter((p) => p.type === 'file' && p.mimeType.startsWith('image/')).length;
    return n ? [...parts, { type: 'text', text: `\n[Included ${n === 1 ? 'an image' : `${n} images`} in this reply]` }] : parts;
  }
  if (m.status !== 'done') return [];
  const n = m.parts.filter((p) => p.type === 'file').length;
  const p = m.image.params;
  const prompt = p.prompt.slice(0, 200);
  if (n === 0 && p.op === 'generate') return [{ type: 'text', text: `[The generated image was deleted: ${prompt}]` }];
  const done =
    p.op === 'generate' ? `Generated ${n === 1 ? 'an image' : `${n} images`}` : p.op === 'upscale' ? 'Upscaled the image' : p.op === 'edit' ? 'Edited the image' : 'Removed the image background';
  return [{ type: 'text', text: `[${done}: ${prompt}]` }];
}
