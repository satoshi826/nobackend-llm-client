import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { MAX_SKILL_FILE_BYTES, MAX_SKILL_FILES } from './files';
import { readSkillSources } from './package';
import { zip } from '../zip';

// Messages are matched in English
beforeAll(() => setLang('en'));
afterAll(() => setLang('ja'));

const md = (name: string, body = 'Do it.') => `---\nname: ${name}\ndescription: Does ${name}.\n---\n${body}\n`;
const blob = (s: string | Uint8Array) => new Blob([s as BlobPart]);

describe('skills brought in', () => {
  it('reads a zip with the skill in a folder, nested paths kept, junk left out', async () => {
    const z = await zip([
      { name: 'pdf/SKILL.md', data: blob(md('pdf')) },
      { name: 'pdf/reference/forms.md', data: blob('# Forms') },
      { name: 'pdf/scripts/fill.js', data: blob('fill()') },
      { name: 'pdf/scripts/', data: blob('') },
      { name: '__MACOSX/pdf/._SKILL.md', data: blob('x') },
      { name: 'pdf/.DS_Store', data: blob('x') }
    ]);
    const r = await readSkillSources([{ path: 'pdf.zip', file: z }]);
    expect(r.errors).toEqual([]);
    expect(r.packages).toHaveLength(1);
    const [p] = r.packages;
    expect(p.draft).toMatchObject({ name: 'pdf', description: 'Does pdf.', body: 'Do it.' });
    expect(p.skillMd).toBe(md('pdf'));
    expect(p.files.map((f) => [f.path, f.mime, f.bytes])).toEqual([
      ['reference/forms.md', 'text/markdown', 7],
      ['scripts/fill.js', 'text/javascript', 6]
    ]);
    expect(await p.files[1].data.text()).toBe('fill()');
  });

  it('reads a zip with SKILL.md at the top, and one holding several skills', async () => {
    const top = await zip([{ name: 'SKILL.md', data: blob(md('top')) }, { name: 'a.txt', data: blob('a') }]);
    const two = await zip([
      { name: 'one/SKILL.md', data: blob(md('one')) },
      { name: 'two/SKILL.md', data: blob(md('two')) },
      { name: 'two/sub/SKILL.md', data: blob('not a skill of its own') },
      { name: 'README.md', data: blob('outside any skill') }
    ]);
    const r = await readSkillSources([{ path: 'top.zip', file: top }, { path: 'two.zip', file: two }]);
    expect(r.errors).toEqual([]);
    expect(r.packages.map((p) => [p.draft.name, p.files.map((f) => f.path)])).toEqual([
      ['top', ['a.txt']],
      ['one', []],
      ['two', ['sub/SKILL.md']]
    ]);
  });

  it('reads a folder (picked or dropped) and a SKILL.md alone', async () => {
    const r = await readSkillSources([
      { path: 'forms/SKILL.md', file: blob(md('forms')) },
      { path: 'forms/reference/a.md', file: blob('# A') },
      { path: 'forms/scripts/b.js', file: blob('b()') },
      { path: 'other.SKILL.md', file: blob(md('other', 'Alone.')) }
    ]);
    expect(r.errors).toEqual([]);
    expect(r.packages.map((p) => [p.draft.name, p.files.map((f) => f.path)])).toEqual([
      ['other', []],
      ['forms', ['reference/a.md', 'scripts/b.js']]
    ]);
  });

  it('refuses a skill whose paths escape, files too large or too many, a SKILL.md not valid, and a zip it cannot read', async () => {
    const r = await readSkillSources([
      { path: 'escape.zip', file: await zip([{ name: 'SKILL.md', data: blob(md('escape')) }, { name: '../../evil.sh', data: blob('rm -rf') }]) },
      { path: 'big.zip', file: await zip([{ name: 'SKILL.md', data: blob(md('big')) }, { name: 'big.bin', data: new Blob([new Uint8Array(MAX_SKILL_FILE_BYTES + 1)]) }]) },
      { path: 'many.zip', file: await zip([{ name: 'SKILL.md', data: blob(md('many')) }, ...Array.from({ length: MAX_SKILL_FILES + 1 }, (_, i) => ({ name: `${i}.md`, data: blob('x') }))]) },
      { path: 'none.zip', file: await zip([{ name: 'README.md', data: blob('x') }]) },
      { path: 'bad.md', file: blob('---\nname: Bad Name\ndescription: x\n---\nx') },
      { path: 'broken.zip', file: blob('PK not really') }
    ]);
    expect(r.packages).toEqual([]);
    expect(r.errors).toHaveLength(6);
    expect(r.errors[0]).toMatch(/^escape\.zip: .*outside/);
    expect(r.errors[1]).toMatch(/^big\.zip: .*big\.bin.*too large/);
    expect(r.errors[2]).toMatch(/^many\.zip: Too many/);
    expect(r.errors[3]).toMatch(/^none\.zip: There is no SKILL\.md/);
    expect(r.errors[4]).toMatch(/^bad\.md: .*lowercase/);
    expect(r.errors[5]).toMatch(/^broken\.zip: .*zip/);
  });
});
