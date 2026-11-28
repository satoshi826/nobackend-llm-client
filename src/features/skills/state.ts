// Skill list, editing (with the skill's files), import/export, the skills attached to the next send, and what skills
// contribute to a reply (load_skill, the catalog in the system prompt, read_skill_file once a skill with files is
// loaded, save_skill once unlocked)
import { computed, signal } from '@preact/signals';
import * as repo from '../../lib/db/repo';
import { deleteSkill, listSkillFiles, listSkills, putSkill, readSkillFileData, type SkillFileEntry, type SkillFileWrite } from '../../lib/db/skills';
import type { MessageRecord, Skill } from '../../lib/db/schema';
import { loadedSkills, serializeSkillMd, skillCatalog, unlockedTools, validateSkill, type SkillDraft } from '../../lib/skills/skill';
import { cleanSkillPath, isTextMime, SKILL_MD, type SkillFile } from '../../lib/skills/files';
import type { SkillPackage } from '../../lib/skills/package';
import { pathKey } from '../../lib/paths';
import { zip } from '../../lib/zip';
import { BUILTIN_NAMES, BUILTIN_SKILLS } from '../../lib/skills/builtin';
import { defineFeatureSettings } from '../../state/feature-settings';
import { registerDataLoader } from '../../state/lifecycle';
import { registerToolProvider } from '../../state/tool-registry';
import { makeReadSkillFileTool, makeSaveSkillTool, makeSkillTool } from './tools';
import { t } from './messages';
import { TranslatedError } from '../../lib/i18n';

/** Skills created by the user (and the model) */
export const skills = signal<Skill[]>([]);
/** Each user skill's files, by skill id (built-in skills have none): what the tools offer depends on them */
const filesBySkill = signal<Record<string, SkillFile[]>>({});
const filesOf = (id: string): SkillFile[] => filesBySkill.value[id] ?? [];
/** Built-in skills (including ones turned off) */
export const builtinSkills: Skill[] = BUILTIN_SKILLS.map((b) => ({
  id: `builtin:${b.name}`,
  name: b.name,
  // Getters: the text follows the current language
  get description() {
    return b.description;
  },
  get body() {
    return b.body;
  },
  modelInvocable: true,
  createdAt: 0,
  updatedAt: 0,
  builtin: true,
  allowedTools: b.allowedTools
}));
/** Built-in skills that are turned off */
export const skillSettings = defineFeatureSettings('skills', { disabledBuiltinSkills: [] as string[] }, {
  legacy: (old) => (Array.isArray(old.disabledBuiltinSkills) ? { disabledBuiltinSkills: old.disabledBuiltinSkills.filter((x): x is string => typeof x === 'string') } : {})
});
/** Usable skills (enabled built-ins + user skills) */
export const allSkills = computed(() => [...builtinSkills.filter((s) => !skillSettings.value.value.disabledBuiltinSkills.includes(s.name)), ...skills.value]);
/** Skills the model can choose from the list */
export const modelSkills = computed(() => allSkills.value.filter((s) => s.modelInvocable));
/** Skills attached to the next send (IDs) */
export const attachedSkillIds = signal<string[]>([]);
export const attachedSkills = computed(() => attachedSkillIds.value.map((id) => allSkills.value.find((s) => s.id === id)).filter((s): s is Skill => !!s));

export async function setBuiltinEnabled(name: string, on: boolean) {
  const cur = skillSettings.value.value.disabledBuiltinSkills.filter((n) => n !== name);
  await skillSettings.save({ disabledBuiltinSkills: on ? cur : [...cur, name] });
}

export async function loadSkills() {
  const list = await listSkills();
  filesBySkill.value = Object.fromEntries(await Promise.all(list.map(async (s) => [s.id, await skillFileList(s.id)] as const)));
  skills.value = list;
}

const byName = (a: Skill, b: Skill) => a.name.localeCompare(b.name);

/**
 * Create (no id) or update. Throws on a duplicate name or invalid content.
 * by: 'model' when created from save_skill (marked only when new).
 * files: they become the skill's files (left out: its files stay as they are).
 * draft.frontmatter left out keeps the skill's own
 */
export async function saveSkill(draft: SkillDraft, id?: string, by?: 'model', files?: SkillFileWrite[]): Promise<Skill> {
  const d: SkillDraft = { name: draft.name.trim(), description: draft.description.trim(), body: draft.body, modelInvocable: draft.modelInvocable };
  if (validateSkill(d)) throw new TranslatedError(() => validateSkill(d)!);
  if (BUILTIN_NAMES.has(d.name)) throw new TranslatedError(() => t('state.builtinName', { name: d.name }));
  if (skills.value.some((s) => s.name === d.name && s.id !== id)) throw new TranslatedError(() => t('state.duplicate', { name: d.name }));
  const prev = id ? skills.value.find((s) => s.id === id) : undefined;
  const now = Date.now();
  const createdBy = prev ? prev.createdBy : by;
  const frontmatter = draft.frontmatter ?? prev?.frontmatter;
  const s: Skill = { id: prev?.id ?? repo.newId(), createdAt: prev?.createdAt ?? now, updatedAt: now, ...d, ...(createdBy ? { createdBy } : {}), ...(frontmatter ? { frontmatter } : {}) };
  await putSkill(s, files);
  if (files) filesBySkill.value = { ...filesBySkill.value, [s.id]: await skillFileList(s.id) };
  skills.value = [...skills.value.filter((x) => x.id !== s.id), s].sort(byName);
  return s;
}

export async function setModelInvocable(id: string, on: boolean) {
  const s = skills.value.find((x) => x.id === id);
  if (s) await saveSkill({ ...s, modelInvocable: on }, id);
}

export async function removeSkill(id: string) {
  await deleteSkill(id);
  const { [id]: _, ...rest } = filesBySkill.value;
  filesBySkill.value = rest;
  skills.value = skills.value.filter((s) => s.id !== id);
  attachedSkillIds.value = attachedSkillIds.value.filter((x) => x !== id);
}

// ---- A skill's files ----

/** A skill's files: their paths inside its folder, types and sizes */
export async function skillFileList(skillId: string): Promise<SkillFile[]> {
  return (await listSkillFiles(skillId)).map(({ path, mime, bytes }) => ({ path, mime, bytes }));
}

/**
 * A file of a skill by its path inside the skill's folder (compared as paths are: lib/paths.ts): its text for a text
 * file (isTextMime), else its bytes; undefined when the skill has no such file. Throws on a path that leaves the folder
 */
export async function readSkillFile(skillId: string, path: string): Promise<string | Blob | undefined> {
  const key = pathKey(cleanSkillPath(path));
  const f = (await listSkillFiles(skillId)).find((x) => pathKey(x.path) === key);
  const data = f && (await readSkillFileData(f.id));
  if (!f || !data) return undefined;
  return isTextMime(f.mime) ? data.text() : data;
}

// ---- Bringing skills in ----

/** What saving a skill brought in would change: the skill of the same name, and its files added, changed or removed */
export interface ImportReview {
  existing?: Skill;
  /** By path: whether each file of the package is new, different or the same as the existing skill's */
  status: Map<string, 'added' | 'changed' | 'same'>;
  removed: SkillFileEntry[];
}

/** Compare a skill brought in with the one of the same name (its files read to tell changed from the same) */
export async function reviewImport(pkg: SkillPackage): Promise<ImportReview> {
  const existing = skills.value.find((s) => s.name === pkg.draft.name);
  const had = existing ? await listSkillFiles(existing.id) : [];
  const byKey = new Map(had.map((f) => [pathKey(f.path), f]));
  const status = new Map<string, 'added' | 'changed' | 'same'>();
  for (const f of pkg.files) {
    const old = byKey.get(pathKey(f.path));
    byKey.delete(pathKey(f.path));
    if (!old) status.set(f.path, 'added');
    else status.set(f.path, old.bytes === f.bytes && (await sameBytes(await readSkillFileData(old.id), f.data)) ? 'same' : 'changed');
  }
  return { existing, status, removed: [...byKey.values()] };
}

async function sameBytes(a: Blob | undefined, b: Blob): Promise<boolean> {
  if (!a || a.size !== b.size) return false;
  const [x, y] = [new Uint8Array(await a.arrayBuffer()), new Uint8Array(await b.arrayBuffer())];
  return x.every((v, i) => v === y[i]);
}

/** Save a skill brought in: a new one, or the one of the same name replaced whole (its files too) */
export async function saveImported(pkg: SkillPackage): Promise<Skill> {
  const existing = skills.value.find((s) => s.name === pkg.draft.name);
  return saveSkill({ ...pkg.draft, frontmatter: pkg.draft.frontmatter ?? '' }, existing?.id, undefined, pkg.files.map(({ path, mime, data }) => ({ path, mime, data })));
}

/** Download a skill: its SKILL.md alone, or with files a zip of its folder (named after it, as Claude's skills are) */
export async function downloadSkill(s: Skill) {
  const files = await listSkillFiles(s.id);
  const md = new Blob([serializeSkillMd(s)], { type: 'application/octet-stream' });
  const blob = files.length
    ? await zip([{ name: `${s.name}/${SKILL_MD}`, data: md }, ...(await Promise.all(files.map(async (f) => ({ name: `${s.name}/${f.path}`, data: (await readSkillFileData(f.id))! }))))])
    : md;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = files.length ? `${s.name}.zip` : `${s.name}.SKILL.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function toggleAttachedSkill(id: string) {
  const cur = attachedSkillIds.value;
  attachedSkillIds.value = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
}

registerDataLoader(loadSkills);

/** Skills attached in the input box, as sent with the message (body saved as of sending) */
export function takeAttachedSkills(): { name: string; body: string }[] {
  const list = attachedSkills.value.map((s) => ({ name: s.name, body: s.body }));
  attachedSkillIds.value = [];
  return list;
}

const fileList = async (id: string) => filesOf(id);

/** read_skill_file, over the skills loaded in the conversation that have files (none: not offered) */
function skillFileTools(messages: MessageRecord[]) {
  const loaded = loadedSkills(messages);
  const withFiles = allSkills.value.filter((s) => loaded.has(s.name) && filesOf(s.id).length);
  if (!withFiles.length) return [];
  return [makeReadSkillFileTool({ skills: withFiles, files: fileList, read: readSkillFile })];
}

registerToolProvider({
  id: 'skills',
  label: () => t('tabLabel'),
  tools: () => (modelSkills.value.length ? [makeSkillTool(modelSkills.value, fileList)] : []),
  // A loaded skill with files brings the tools for its files, from the step after it was loaded; skill-creator unlocks
  // save_skill (and load_skill over every skill) in the conversation that loaded it
  dynamicTools: ({ history }, turn) => {
    const messages = [...history, turn];
    const unlocked = unlockedTools(messages, allSkills.value);
    return [
      ...skillFileTools(messages),
      ...(unlocked.has('save_skill')
        ? [
            makeSkillTool(allSkills.value, fileList),
            makeSaveSkillTool({
              find: (name) => allSkills.value.find((s) => s.name === name),
              save: (draft, id) => saveSkill(draft, id, 'model')
            })
          ]
        : [])
    ];
  },
  systemNote: ({ model }) => (model?.capabilities.tools ? skillCatalog(modelSkills.value) || undefined : undefined)
});
