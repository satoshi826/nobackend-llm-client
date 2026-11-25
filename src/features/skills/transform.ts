// Skills the user picked are put before that message's text
import { joinedText } from '../../lib/chat/request';
import type { MessageRecord } from '../../lib/db/schema';
import type { Part } from '../../lib/providers/types';
import { withAttachedSkills } from '../../lib/skills/skill';

export function skillsTransform(m: MessageRecord, parts: Part[]): Part[] {
  return m.role === 'user' && m.skills?.length ? [{ type: 'text', text: withAttachedSkills(joinedText(parts), m.skills) }] : parts;
}
