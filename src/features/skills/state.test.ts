import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../lib/db/schema';
import { readSkillSources } from '../../lib/skills/package';
import { zip } from '../../lib/zip';
import { loadSkills, readSkillFile, reviewImport, saveImported, saveSkill, skillFileList, skills } from './state';
import { contributedDynamicTools } from '../../state/tool-registry';
import type { Conversation, MessageRecord } from '../../lib/db/schema';
import type { ModelInfo } from '../../lib/providers/types';

const md = (body: string, extra = '') => `---\nname: forms\ndescription: Fills forms.\n${extra}---\n${body}\n`;
const blob = (s: string | Uint8Array) => new Blob([s as BlobPart]);

async function pkgOf(entries: Record<string, string | Uint8Array>) {
  const file = await zip(Object.entries(entries).map(([name, data]) => ({ name: `forms/${name}`, data: blob(data) })));
  const { packages, errors } = await readSkillSources([{ path: 'forms.zip', file }]);
  expect(errors).toEqual([]);
  return packages[0];
}

beforeEach(async () => {
  await Promise.all(db().tables.map((t) => t.clear()));
  await loadSkills();
});

describe('skills brought in, and their files for the tools', () => {
  it('saves a new skill with its files; lists them and reads text as text, the rest as bytes', async () => {
    const pkg = await pkgOf({ 'SKILL.md': md('Use scripts/b.js.', 'license: MIT\n'), 'reference/a.md': '# A', 'scripts/b.js': 'b()', 'assets/x.png': new Uint8Array([137, 80, 0]) });
    const review = await reviewImport(pkg);
    expect(review.existing).toBeUndefined();
    expect([...review.status.values()]).toEqual(['added', 'added', 'added']);
    const s = await saveImported(pkg);
    expect(s).toMatchObject({ name: 'forms', body: 'Use scripts/b.js.', frontmatter: 'license: MIT' });
    expect(await skillFileList(s.id)).toEqual([
      { path: 'assets/x.png', mime: 'image/png', bytes: 3 },
      { path: 'reference/a.md', mime: 'text/markdown', bytes: 3 },
      { path: 'scripts/b.js', mime: 'text/javascript', bytes: 3 }
    ]);
    expect(await readSkillFile(s.id, 'reference/a.md')).toBe('# A');
    expect(await readSkillFile(s.id, './Scripts\\B.js')).toBe('b()');
    const png = await readSkillFile(s.id, 'assets/x.png');
    expect(png).toBeInstanceOf(Blob);
    expect((png as Blob).type).toBe('image/png');
    expect(await readSkillFile(s.id, 'nope.md')).toBeUndefined();
    await expect(readSkillFile(s.id, '../x')).rejects.toThrow();
    expect(await skillFileList('builtin:skill-creator')).toEqual([]);
  });

  it('reviews an update: the existing skill, files added, changed, the same and removed; saving replaces them all', async () => {
    const first = await saveImported(await pkgOf({ 'SKILL.md': md('Old steps.', 'license: MIT\n'), 'a.md': 'A', 'b.md': 'B', 'c.md': 'C' }));
    const pkg = await pkgOf({ 'SKILL.md': md('New steps.'), 'a.md': 'A', 'b.md': 'B!', 'd.md': 'D' });
    const review = await reviewImport(pkg);
    expect(review.existing?.id).toBe(first.id);
    expect(review.existing?.body).toBe('Old steps.');
    expect(Object.fromEntries(review.status)).toEqual({ 'a.md': 'same', 'b.md': 'changed', 'd.md': 'added' });
    expect(review.removed.map((f) => f.path)).toEqual(['c.md']);
    const s = await saveImported(pkg);
    expect(s.id).toBe(first.id);
    expect(s.body).toBe('New steps.');
    // The new SKILL.md has no other keys: none are kept from the old one
    expect(s.frontmatter).toBeUndefined();
    expect((await skillFileList(s.id)).map((f) => f.path)).toEqual(['a.md', 'b.md', 'd.md']);
    expect(await readSkillFile(s.id, 'b.md')).toBe('B!');
    expect(skills.value).toHaveLength(1);
  });

  it('keeps a skill\'s files and other front matter keys when it is saved without them (editing, save_skill)', async () => {
    const s = await saveImported(await pkgOf({ 'SKILL.md': md('Steps.', 'license: MIT\n'), 'a.md': 'A' }));
    const saved = await saveSkill({ name: 'forms', description: 'Fills forms.', body: 'Better steps.', modelInvocable: true }, s.id, 'model');
    expect(saved.frontmatter).toBe('license: MIT');
    expect((await skillFileList(s.id)).map((f) => f.path)).toEqual(['a.md']);
  });

  it('offers read_skill_file once a skill with files is loaded in the conversation, over those skills only', async () => {
    await saveImported(await pkgOf({ 'SKILL.md': md('Steps.'), 'a.md': 'A' }));
    await saveSkill({ name: 'plain', description: 'Plain.', body: 'Plain steps.', modelInvocable: true });
    const ctx = { conv: { id: 'c' } as Conversation, messageId: 'm', model: { capabilities: { tools: true } } as ModelInfo, history: [] as MessageRecord[] };
    const msg = (o: Partial<MessageRecord>): MessageRecord => ({ id: 'x', conversationId: 'c', parentId: null, role: 'user', parts: [], createdAt: 1, status: 'done', ...o });
    const loaded = (name: string) => msg({ role: 'assistant', parts: [{ type: 'tool', toolCallId: 't', name: 'load_skill', argsText: '', input: { name }, state: 'output-available' }] });
    const names = (turn: MessageRecord, history: MessageRecord[] = []) => contributedDynamicTools({ ...ctx, history }, turn).map((x) => x.name);
    expect(names(msg({ role: 'assistant' }))).toEqual([]);
    expect(names(loaded('plain'))).toEqual([]);
    expect(names(loaded('forms'))).toEqual(['read_skill_file']);
    // Picked in the input box of an earlier message
    const tool = contributedDynamicTools({ ...ctx, history: [msg({ skills: [{ name: 'forms', body: 'Steps.' }] })] }, msg({ role: 'assistant' }))[0];
    expect((tool.parameters as any).properties.skill.enum).toEqual(['forms']);
    expect((await tool.execute(tool.prepare({ skill: 'forms', path: 'a.md' }), { signal: new AbortController().signal } as any)).content).toContain('     1\tA');
  });
});
