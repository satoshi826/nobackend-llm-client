import { describe, expect, it } from 'vitest';
import type { SkillFile } from '../../lib/skills/files';
import { makeSkillTool } from './tools';

const ctx = { signal: new AbortController().signal } as any;
const file = (path: string, mime = 'text/markdown', bytes = 3): SkillFile => ({ path, mime, bytes });

describe('load_skill', () => {
  it('lists the files of the skill after its body, capped, and nothing for a skill without files', async () => {
    const files: Record<string, SkillFile[]> = {
      s1: [file('assets/x.png', 'image/png', 9), file('reference/a.md'), file('scripts/b.js', 'text/javascript', 12)],
      s2: Array.from({ length: 53 }, (_, i) => file(`r/${String(i).padStart(2, '0')}.md`))
    };
    const tool = makeSkillTool(
      [
        { id: 's1', name: 'forms', body: 'Run scripts/b.js.' },
        { id: 's2', name: 'many', body: 'Many.' },
        { id: 's3', name: 'plain', body: 'Plain.' }
      ],
      async (id) => files[id] ?? []
    );
    expect((await tool.execute({ name: 'forms' }, ctx)).content).toBe(
      '<skill name="forms">\nRun scripts/b.js.\n</skill>\n\nFiles in this skill\'s folder (3; paths inside it):\n- assets/x.png (binary: image/png, 9 bytes)\n- reference/a.md (3 bytes)\n- scripts/b.js (12 bytes)'
    );
    const many = (await tool.execute({ name: 'many' }, ctx)).content;
    expect(many).toContain('(53; paths inside it)');
    expect(many).toContain('- r/49.md (3 bytes)\n[3 more not listed]');
    expect(many).not.toContain('r/50.md');
    expect((await tool.execute({ name: 'plain' }, ctx)).content).toBe('<skill name="plain">\nPlain.\n</skill>');
  });
});
