// Attached files are sent before the message text
import { joinedText } from '../../lib/chat/request';
import type { Attachment, MessageRecord } from '../../lib/db/schema';
import type { Part } from '../../lib/providers/types';

/** The text sent for a user message with attached files */
export function withAttachments(text: string, atts: Attachment[]): string {
  const blocks = atts.map((a) => {
    const partial = a.text.length < a.totalChars;
    const note = partial ? `\n[Only the first ${a.text.length} of ${a.totalChars} characters are included. Use read_file with file_id="${a.fileId}" and offset=${a.text.length} to read more.]` : '';
    return `<file name="${a.name.replace(/"/g, "'")}" id="${a.fileId}" version="${a.version}">\n${a.text}\n</file>${note}`;
  });
  return [...blocks, text].filter(Boolean).join('\n\n');
}

export function attachmentsTransform(m: MessageRecord, parts: Part[]): Part[] {
  if (m.role !== 'user' || !m.attachments?.length) return parts;
  return [{ type: 'text', text: withAttachments(joinedText(parts), m.attachments) }];
}
