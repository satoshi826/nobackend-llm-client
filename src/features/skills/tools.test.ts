import { describe, expect, it } from 'vitest';
import type { SkillFile } from '../../lib/skills/files';
import { makeReadSkillFileTool, makeSkillTool, type SkillFilesDeps } from './tools';

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
      '<skill name="forms">\nRun scripts/b.js.\n</skill>\n\nFiles in this skill\'s folder (3; paths inside it; read them with read_skill_file):\n- assets/x.png (binary: image/png, 9 bytes)\n- reference/a.md (3 bytes)\n- scripts/b.js (12 bytes)'
    );
    const many = (await tool.execute({ name: 'many' }, ctx)).content;
    expect(many).toContain('(53; paths inside it; ');
    expect(many).toContain('- r/49.md (3 bytes)\n[3 more; read_skill_file with the path "." lists them all]');
    expect(many).not.toContain('r/50.md');
    expect((await tool.execute({ name: 'plain' }, ctx)).content).toBe('<skill name="plain">\nPlain.\n</skill>');
  });
});

describe('read_skill_file', () => {
  const texts: Record<string, string> = { 'reference/a.md': '# A\nline 2\nline 3', 'scripts/b.js': 'b()' };
  const deps: SkillFilesDeps = {
    skills: [{ id: 's1', name: 'forms' }],
    files: async () => [file('assets/x.png', 'image/png', 9), file('reference/a.md', 'text/markdown', 19), file('scripts/b.js', 'text/javascript', 3)],
    read: async (_id, path) => texts[path] ?? new Blob(['x'])
  };
  const tool = makeReadSkillFileTool(deps);
  const run = async (raw: unknown) => tool.execute(tool.prepare(raw), ctx);

  it('reads a text file with line numbers, a page at a time, as read_file does', async () => {
    expect((tool.parameters as any).properties.skill.enum).toEqual(['forms']);
    expect(tool.defaultPermission).toBe('allow');
    expect((await run({ skill: 'forms', path: './Reference\\A.md' })).content).toBe(
      '<skill_file skill="forms" path="reference/a.md">\n     1\t# A\n     2\tline 2\n     3\tline 3\n</skill_file>\n[end of file; 3 lines]'
    );
    const page = (await run({ skill: 'forms', path: 'reference/a.md', offset: 2, limit: 1 })).content;
    expect(page).toBe('<skill_file skill="forms" path="reference/a.md">\n     2\tline 2\n</skill_file>\n[lines 2-2 of 3; continue with offset=3]');
    expect((await run({ skill: 'forms', path: 'reference/a.md', offset: 9 })).content).toBe('offset=9 is past the end of "reference/a.md", which has 3 lines.');
  });

  it('lists a folder, or the whole skill for "."', async () => {
    expect((await run({ skill: 'forms', path: 'scripts/' })).content).toBe('Files in "scripts/" of the skill "forms" (1):\n- scripts/b.js (3 bytes)');
    expect((await run({ skill: 'forms', path: '.' })).content).toContain('Files in the folder of the skill "forms" (3):\n- assets/x.png (binary: image/png, 9 bytes)');
  });

  it('refuses binary files, missing files, paths outside the skill and skills not loaded', async () => {
    await expect(run({ skill: 'forms', path: 'assets/x.png' })).rejects.toMatchObject({ english: '"assets/x.png" is not a text file, so it can\'t be read (image/png, 9 B).' });
    await expect(run({ skill: 'forms', path: 'nope.md' })).rejects.toMatchObject({ english: 'The skill "forms" has no file "nope.md". Use a path listed in load_skill\'s result.' });
    expect(() => tool.prepare({ skill: 'forms', path: '../other/SKILL.md' })).toThrow();
    expect(() => tool.prepare({ skill: 'forms', path: '/etc/passwd' })).toThrow();
    expect(() => tool.prepare({ skill: 'forms' })).toThrow();
    await expect(run({ skill: 'other', path: 'a.md' })).rejects.toMatchObject({ english: 'There is no skill "other". Available skills: forms' });
  });
});
