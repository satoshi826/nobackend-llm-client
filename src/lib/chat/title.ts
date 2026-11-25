// Conversation title (derived from the first message)
import { t as tc } from './messages';

export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 40 ? t.slice(0, 40) + '…' : t || tc('title.new');
}
