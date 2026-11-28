import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLang } from '../i18n';
import { cleanSkillPath, freeSkillPath, isTextMime, MAX_SKILL_FILE_BYTES, MAX_SKILL_FILES, skillFileMime, skillFilesProblem } from './files';

// Messages are matched in English
beforeAll(() => setLang('en'));
afterAll(() => setLang('ja'));

const blob = (s: string | Uint8Array) => new Blob([s as BlobPart]);

describe('paths inside a skill', () => {
  it('cleans separators, NFC, empty and dot parts', () => {
    expect(cleanSkillPath('scripts\\fill.js')).toBe('scripts/fill.js');
    expect(cleanSkillPath('./reference//forms.md')).toBe('reference/forms.md');
    expect(cleanSkillPath('Ka\u0301/x.md')).toBe('Ká/x.md');
    expect(cleanSkillPath('Makefile')).toBe('Makefile');
  });

  it('refuses paths that leave the folder, are empty, or are too deep or long', () => {
    for (const p of ['../x.md', 'a/../../x', '/etc/passwd', '\\\\server\\x', 'C:/x', 'a/C:/x']) expect(() => cleanSkillPath(p)).toThrow(/outside/);
    expect(() => cleanSkillPath('./')).toThrow(/no path/);
    expect(() => cleanSkillPath('a/b/c/d/e/f/g/h/i.md')).toThrow(/too deep/);
    expect(() => cleanSkillPath(`${'x'.repeat(201)}.md`)).toThrow(/too deep/);
  });

  it('numbers a path in use', () => {
    expect(freeSkillPath('a.js', new Set(['a.js', 'a (2).js']))).toBe('a (3).js');
    expect(freeSkillPath('B.md', new Set())).toBe('B.md');
  });

  it('tells what keeps files from being one skill\'s', () => {
    const f = (path: string, bytes = 1) => ({ path, bytes });
    expect(skillFilesProblem([f('a.md'), f('scripts/b.js')])).toBeNull();
    expect(skillFilesProblem([f('a.md'), f('A.md')])).toMatch(/two files/);
    expect(skillFilesProblem([f('skill.md')])).toMatch(/SKILL\.md/);
    expect(skillFilesProblem([f('sub/SKILL.md')])).toBeNull();
    expect(skillFilesProblem([f('a'), f('a/b.md')])).toMatch(/is a file/);
    expect(skillFilesProblem([f('a.bin', MAX_SKILL_FILE_BYTES + 1)])).toMatch(/too large/);
    expect(skillFilesProblem(Array.from({ length: 5 }, (_, i) => f(`${i}.bin`, MAX_SKILL_FILE_BYTES)))).toMatch(/together/);
    expect(skillFilesProblem(Array.from({ length: MAX_SKILL_FILES + 1 }, (_, i) => f(`${i}.md`)))).toMatch(/Too many/);
  });

  it('tells text from binary by the bytes, and types text by its extension', async () => {
    expect(await skillFileMime('scripts/fill.js', blob('console.log(1)'))).toBe('text/javascript');
    expect(await skillFileMime('reference/a.md', blob('# A'))).toBe('text/markdown');
    expect(await skillFileMime('LICENSE', blob('MIT'))).toBe('text/plain');
    expect(await skillFileMime('notes.pdf', blob('plain words'))).toBe('text/plain');
    expect(await skillFileMime('assets/logo.png', blob(new Uint8Array([0x89, 0x50, 0, 1])))).toBe('image/png');
    expect(await skillFileMime('data.md', blob(new Uint8Array([0xff, 0xfe, 0x41])))).toBe('application/octet-stream');
    expect(isTextMime('image/svg+xml') && isTextMime('application/json') && !isTextMime('image/png')).toBe(true);
  });
});
