// Settings > Skills: list, create, edit, import/export SKILL.md
import { useRef, useState } from 'preact/hooks';
import { showToast } from '../../../state/ui';
import type { Skill } from '../../../lib/db/schema';
import { DESCRIPTION_MAX, NAME_MAX, type SkillDraft } from '../../../lib/skills/skill';
import { askConfirm } from '../../../components/ConfirmDialog';
import { Button, Chevron, Collapse, EmptyState, Icon, IconButton, TextArea, TextField, Checkbox } from '../../../components/ui';
import { skillSettings, builtinSkills, downloadSkill, importSkillFiles, removeSkill, saveSkill, setBuiltinEnabled, setModelInvocable, skills } from '../state';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

const EMPTY: SkillDraft = { name: '', description: '', body: '', modelInvocable: true };

function SkillEditor({ skill, onDone }: { skill?: Skill; onDone(): void }) {
  const [d, setD] = useState<SkillDraft>(skill ? { name: skill.name, description: skill.description, body: skill.body, modelInvocable: skill.modelInvocable } : EMPTY);
  const [error, setError] = useState('');
  const set = (patch: Partial<SkillDraft>) => setD({ ...d, ...patch });
  const save = async () => {
    try {
      await saveSkill(d, skill?.id);
      showToast(skill ? t('tab.saved', { name: d.name }) : t('tab.created', { name: d.name }));
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div class="space-y-3 rounded-lg border border-line p-3" role="group" aria-label={skill ? t('tab.editGroup') : t('tab.newSkill')}>
      <label class="block text-sm">
        {t('name')}
        <TextField
          class="mt-1 font-mono"
          value={d.name}
          maxLength={NAME_MAX}
          placeholder="code-review"
          onInput={(e) => set({ name: (e.target as HTMLInputElement).value.toLowerCase().replace(/[\s_]+/g, '-') })}
        />
        <span class="mt-0.5 block text-xs text-muted">{t('tab.nameHelp')}</span>
      </label>
      <label class="block text-sm">
        {t('description')}
        <TextArea
          class="mt-1"
          rows={2}
          maxLength={DESCRIPTION_MAX}
          value={d.description}
          placeholder={t('tab.descPlaceholder')}
          onInput={(e) => set({ description: (e.target as HTMLTextAreaElement).value })}
        />
        <span class="mt-0.5 block text-xs text-muted">{t('tab.descHelp')}</span>
      </label>
      <label class="block text-sm">
        {t('tab.bodyMarkdown')}
        <TextArea compact
          class="mt-1 font-mono leading-5"
          rows={12}
          value={d.body}
          placeholder={t('tab.bodyPlaceholder')}
          onInput={(e) => set({ body: (e.target as HTMLTextAreaElement).value })}
        />
      </label>
      <Checkbox class="text-sm" checked={d.modelInvocable} onChange={(v) => set({ modelInvocable: v })}>
        <span>
          {t('invocable')}
          <span class="block text-xs text-muted">{t('tab.invocableHelp')}</span>
        </span>
      </Checkbox>
      {error && (
        <p role="alert" class="text-xs text-danger">
          {error}
        </p>
      )}
      <div class="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button variant="primary" onClick={() => void save()}>
          <Icon name="check" />
          {t('save')}
        </Button>
      </div>
    </div>
  );
}

/** Built-in skills (read-only; can only be turned on/off) */
function BuiltinRow({ s }: { s: Skill }) {
  const on = !skillSettings.value.value.disabledBuiltinSkills.includes(s.name);
  const [open, setOpen] = useState(false);
  return (
    <li class="rounded-lg border border-line p-3">
      <div class="flex items-start gap-2">
        <Icon name="book" class="mt-0.5 size-4 shrink-0 text-faint" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="font-mono text-sm font-medium">{s.name}</span>
            <span class="rounded bg-glass-strong px-1.5 py-0.5 text-[11px] text-muted">{t('tab.builtin')}</span>
          </div>
          <p class="mt-0.5 text-xs text-muted">{s.description}</p>
          {s.allowedTools?.includes('save_skill') && (
            <p class="mt-1 text-xs text-muted">{t('tab.unlocksSave')}</p>
          )}
          <div class="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <Checkbox checked={on} onChange={(v) => void setBuiltinEnabled(s.name, v)}>
              {t('tab.use')}
            </Checkbox>
            <button type="button" class="flex items-center gap-1 text-muted hover:text-ink" aria-expanded={open} onClick={() => setOpen(!open)}>
              {t('tab.body')}
              <Chevron open={open} />
            </button>
          </div>
          <Collapse open={open} class="pt-2">
            <pre class="max-h-64 overflow-auto rounded-lg bg-sunken p-2 text-xs leading-5 whitespace-pre-wrap">{s.body}</pre>
          </Collapse>
        </div>
      </div>
    </li>
  );
}

function SkillRow({ s, onEdit }: { s: Skill; onEdit(): void }) {
  return (
    <li class="rounded-lg border border-line p-3">
      <div class="flex items-start gap-2">
        <Icon name="book" class="mt-0.5 size-4 shrink-0 text-faint" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="font-mono text-sm font-medium">{s.name}</span>
            {s.createdBy === 'model' && (
              <span class="rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent-text" data-tip={t('tab.byModelTitle')}>
                {t('tab.byModel')}
              </span>
            )}
          </div>
          <p class="mt-0.5 line-clamp-2 text-xs text-muted">{s.description}</p>
          <Checkbox class="mt-2 text-xs" checked={s.modelInvocable} onChange={(v) => void setModelInvocable(s.id, v)}>
            {t('invocable')}
          </Checkbox>
        </div>
        <div class="flex shrink-0 items-center">
          <IconButton label={t('tab.editAria', { name: s.name })} title={t('edit')} onClick={onEdit}>
            <Icon name="edit" class="size-4" />
          </IconButton>
          <IconButton label={t('tab.exportAria', { name: s.name })} title={t('tab.export')} onClick={() => downloadSkill(s)}>
            <Icon name="download" class="size-4" />
          </IconButton>
          <IconButton
            label={t('tab.deleteAria', { name: s.name })}
            title={t('delete')}
            variant="remove"
            onClick={() =>
              void askConfirm({ title: t('tab.deleteTitle'), message: t('tab.deleteMessage', { name: s.name }), confirmLabel: t('delete'), danger: true }).then((ok) => {
                if (ok) void removeSkill(s.id);
              })
            }
          >
            <Icon name="trash" class="size-4" />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

export function SkillsTab() {
  const list = skills.value;
  const [editing, setEditing] = useState<string | null>(null); // 'new' | skill id
  const file = useRef<HTMLInputElement>(null);

  const onImport = async (files: FileList | null) => {
    if (!files?.length) return;
    const r = await importSkillFiles([...files]);
    const done = [...r.added, ...r.updated];
    const n = done.length;
    const updated = r.updated.length;
    if (n) {
      const params = { n: formatNumber(n), updated: formatNumber(updated) };
      showToast(n === 1 ? t(updated ? 'tab.importedOneUpdated' : 'tab.importedOne') : t(updated ? 'tab.importedUpdated' : 'tab.imported', params));
    }
    if (r.errors.length) showToast(t('tab.importFailed', { list: r.errors.join(' / ') }), 'error');
    if (file.current) file.current.value = '';
  };

  return (
    <div class="space-y-4">
      <p class="text-xs leading-5 text-muted">
        {t('tab.intro')}
      </p>
      <p class="rounded-lg bg-warn-soft p-2.5 text-xs text-warn">
        {t('tab.warning')}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setEditing('new')} disabled={editing === 'new'}>
          <Icon name="plus" class="size-4" />
          {t('tab.newSkill')}
        </Button>
        <Button variant="outline" onClick={() => file.current?.click()}>
          <Icon name="upload" class="size-4" />
          {t('tab.import')}
        </Button>
        <input ref={file} type="file" accept=".md,.markdown,text/markdown,text/plain" multiple class="hidden" onChange={(e) => void onImport((e.target as HTMLInputElement).files)} />
      </div>
      <section class="space-y-2">
        <h4 class="text-xs font-semibold text-muted">{t('tab.builtin')}</h4>
        <ul class="space-y-2">
          {builtinSkills.map((s) => (
            <BuiltinRow key={s.id} s={s} />
          ))}
        </ul>
      </section>
      <h4 class="text-xs font-semibold text-muted">{t('tab.yours')}</h4>
      {editing === 'new' && <SkillEditor onDone={() => setEditing(null)} />}
      {list.length === 0 && editing !== 'new' ? (
        <EmptyState icon="book">{t('none')}</EmptyState>
      ) : (
        <ul class="space-y-2">
          {list.map((s) => (editing === s.id ? <SkillEditor key={s.id} skill={s} onDone={() => setEditing(null)} /> : <SkillRow key={s.id} s={s} onEdit={() => setEditing(s.id)} />))}
        </ul>
      )}
    </div>
  );
}
