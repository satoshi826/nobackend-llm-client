import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { generateDataKey } from '../crypto/data';
import { setDataKey } from './sealed';
import { db, type Skill } from './schema';
import * as repo from './repo';
import { deleteSkill, listSkillFiles, listSkills, putSkill, readSkillFileData } from './skills';
import { exportBackup, importBackup } from './export';
import { unzip } from '../zip';

const skill = (id: string, name = id): Skill => ({ id, name, description: 'Fills forms.', body: 'Use scripts/fill.js.', modelInvocable: true, createdAt: 1, updatedAt: 1 });
const text = (path: string, s: string, mime = 'text/markdown') => ({ path, mime, data: new Blob([s], { type: mime }) });

afterEach(async () => {
  setDataKey(null);
  await Promise.all(db().tables.map((t) => t.clear()));
});

describe('skill files', () => {
  it('saves a skill with its files, lists them by path without reading their bytes, and reads one', async () => {
    await putSkill(skill('s1'), [text('scripts/fill.js', 'fill()', 'text/javascript'), text('reference/forms.md', '# Forms')]);
    const files = await listSkillFiles('s1');
    expect(files.map((f) => [f.path, f.mime, f.bytes])).toEqual([
      ['reference/forms.md', 'text/markdown', 7],
      ['scripts/fill.js', 'text/javascript', 6]
    ]);
    expect(await (await readSkillFileData(files[1].id))!.text()).toBe('fill()');
    expect(await listSkills()).toMatchObject([{ id: 's1' }]);
  });

  it('keeps, moves and replaces files by the list it is saved with; without one, leaves them', async () => {
    await putSkill(skill('s1'), [text('a.md', 'A'), text('b.md', 'B'), text('c.md', 'C')]);
    const [a, b] = await listSkillFiles('s1');
    await putSkill(skill('s1'), [{ id: a.id, path: 'docs/a.md' }, text('b.md', 'B2'), { id: 'gone', path: 'x.md' }]);
    const after = await listSkillFiles('s1');
    expect(after.map((f) => f.path)).toEqual(['b.md', 'docs/a.md']);
    expect(after.find((f) => f.path === 'docs/a.md')!.id).toBe(a.id);
    expect(after.find((f) => f.path === 'b.md')!.id).not.toBe(b.id);
    expect(await (await readSkillFileData(after[0].id))!.text()).toBe('B2');
    await putSkill({ ...skill('s1'), body: 'Changed.' });
    expect(await listSkillFiles('s1')).toHaveLength(2);
  });

  it('refuses files that cannot be one skill\'s, and saves nothing then', async () => {
    await expect(putSkill(skill('s1'), [text('a.md', 'A'), text('A.md', 'B')])).rejects.toThrow();
    await expect(putSkill(skill('s1'), [text('../a.md', 'A')])).rejects.toThrow();
    expect(await db().skills.count()).toBe(0);
    expect(await db().skillFiles.count()).toBe(0);
  });

  it('deletes a skill\'s files with it, and only its', async () => {
    await putSkill(skill('s1'), [text('a.md', 'A')]);
    await putSkill(skill('s2'), [text('a.md', 'A')]);
    await deleteSkill('s1');
    expect(await db().skills.count()).toBe(1);
    expect((await db().skillFiles.toArray()).map((r) => r.skillId)).toEqual(['s2']);
  });

  it('with a passphrase keeps path, type and size encrypted and the bytes too; reseal round-trips', async () => {
    const key = await generateDataKey();
    setDataKey(key);
    await putSkill(skill('s1'), [text('secret/plan.md', '秘密の計画')]);
    const [row] = await db().skillFiles.toArray();
    expect(Object.keys(row).sort()).toEqual(['data', 'enc', 'id', 'skillId']);
    expect(row.data).not.toBeInstanceOf(Blob);
    expect(JSON.stringify(row)).not.toContain('plan.md');
    const [f] = await listSkillFiles('s1');
    expect(f).toMatchObject({ path: 'secret/plan.md', mime: 'text/markdown', bytes: 15 });
    expect(await (await readSkillFileData(f.id))!.text()).toBe('秘密の計画');
    // Locked: nothing can be read
    setDataKey(null);
    await expect(listSkillFiles('s1')).rejects.toThrow();
    // Removing the passphrase decrypts it, setting one again encrypts it
    await repo.resealAll(key, null);
    const plain = (await db().skillFiles.toArray())[0];
    expect(plain).toMatchObject({ path: 'secret/plan.md', bytes: 15 });
    expect(plain.data).toBeInstanceOf(Blob);
    await repo.resealAll(null, key);
    setDataKey(key);
    expect(await (await readSkillFileData(f.id))!.text()).toBe('秘密の計画');
  });

  it('goes into a backup as zip entries and comes back, also encrypted at rest; never onto another skill', async () => {
    setDataKey(await generateDataKey());
    await putSkill(skill('s1', 'forms'), [text('reference/a.md', '# A'), { path: 'assets/x.png', mime: 'image/png', data: new Blob([new Uint8Array([137, 80, 0, 1])]) }]);
    const backup = await exportBackup();
    const entries = await unzip(backup);
    const doc = JSON.parse(await entries.get('backup.json')!.text());
    expect(doc.version).toBe(8);
    // An image keeps its extension in the zip; other bytes are .bin
    expect(doc.skillFiles.map((f: { path: string; data: { file: string } }) => [f.path, f.data.file.replace(/\d+/, 'N')]).sort()).toEqual([
      ['assets/x.png', 'media/N.png'],
      ['reference/a.md', 'media/N.bin']
    ]);
    await Promise.all(db().tables.map((t) => t.clear()));
    const r = await importBackup(backup);
    expect(r).toMatchObject({ skills: 1, tables: { skillFiles: 2 } });
    const files = await listSkillFiles('s1');
    expect(files.map((f) => f.path)).toEqual(['assets/x.png', 'reference/a.md']);
    expect(await (await readSkillFileData(files[1].id))!.text()).toBe('# A');
    // Imported again: nothing is added twice
    expect(await importBackup(backup)).toMatchObject({ skills: 0, tables: { skillFiles: 0 } });
    // A local skill of the same name (another id) keeps its own files
    await Promise.all(db().tables.map((t) => t.clear()));
    await putSkill(skill('local', 'forms'), [text('mine.md', 'mine')]);
    expect(await importBackup(backup)).toMatchObject({ skills: 0, skipped: 1, tables: { skillFiles: 0 } });
    expect((await listSkillFiles('local')).map((f) => f.path)).toEqual(['mine.md']);
  });
});
