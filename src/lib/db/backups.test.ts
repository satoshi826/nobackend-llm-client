// Every backup version the app has written stays readable: backups/v<N>.json holds one of each, made by that version's
// export, and each is imported into an empty app here
import 'fake-indexeddb/auto';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import * as repo from './repo';
import { listFiles, readText } from './files';
import { getImage, listImages } from './images';
import { EXPORT_VERSION, importAll } from './export';
import { db } from './schema';

const dir = new URL('./backups/', import.meta.url);
const versions = readdirSync(dir).map((f) => /^v(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number);

describe('backups of every released version', () => {
  beforeEach(async () => {
    await Promise.all(db().tables.map((t) => t.clear()));
  });

  it('has a backup of the version the app writes now', () => {
    expect(versions).toContain(EXPORT_VERSION);
  });

  it.each(versions)('reads a version %i backup whole', async (v) => {
    const r = await importAll(JSON.parse(readFileSync(new URL(`v${v}.json`, dir), 'utf8')));
    expect(r).toMatchObject({ conversations: 1, messages: 7, prompts: 1, skills: 1, skipped: 0, tables: { files: 1, images: 1 } });
    expect(await repo.getConversation('conv-1')).toMatchObject({ title: 'Trip plan', pinned: 1, tags: ['travel'], workDir: 'trip/', currentLeafId: 'm-7' });
    const byId = new Map((await repo.listMessages('conv-1')).map((m) => [m.id, m]));
    expect(byId.get('m-1')).toMatchObject({ skills: [{ name: 'planner' }], attachments: [{ fileId: 'file-1', name: 'trip/notes.md' }] });
    expect(byId.get('m-2')?.parts.map((p) => p.type)).toEqual(['reasoning', 'text']);
    expect(byId.get('m-3')?.compaction).toMatchObject({ coversUntilId: 'm-2', count: 2 });
    expect(byId.get('m-4')?.imageRequest).toMatchObject({ op: 'generate', prompt: 'A temple at dusk', seed: 42 });
    expect(byId.get('m-5')?.parts[0]).toMatchObject({ type: 'file', blobId: 'img-1', mimeType: 'image/png' });
    expect(byId.get('m-7')?.video).toMatchObject({ params: { model: 'wan', duration: 5 }, costUsd: 0.25 });
    expect(await db().skills.get('s-1')).toMatchObject({ name: 'planner', createdBy: 'model' });
    const [file] = await listFiles();
    expect(file.name).toBe('trip/notes.md');
    expect(await readText(file.id)).toBe('# Notes\nTemples');
    expect((await listImages()).map((im) => im.path)).toEqual(['trip/temple.png']);
    expect((await getImage('img-1'))?.size).toBeGreaterThan(0);
  });
});
