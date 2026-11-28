// Approval card for save_skill: shows the full draft for editing, and the changes when updating an existing skill. There is no "Always allow".
import { useMemo, useState } from 'preact/hooks';
import type { Part } from '../../../lib/providers/types';
import { resolveApproval } from '../../../state/approvals';
import { lineDiff } from '../../../lib/skills/diff';
import { Button, Icon, Segmented, TextArea, TextField, cx, Checkbox } from '../../../components/ui';
import { allSkills } from '../state';
import { t } from '../messages';

type ToolPart = Extract<Part, { type: 'tool' }>;

interface Draft {
  name: string;
  description: string;
  body: string;
  model_invocable: boolean;
}


function Diff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const changed = lines.some((l) => l.type !== 'same');
  if (!changed) return <p class="text-xs text-muted">{t('approval.noBodyChange')}</p>;
  return (
    <pre class="max-h-72 overflow-auto rounded-lg border border-line bg-glass p-2 font-mono text-xs leading-5" aria-label={t('approval.diffLabel')}>
      {lines.map((l, i) => (
        <div
          key={i}
          class={cx(
            'whitespace-pre-wrap',
            l.type === 'add' && 'bg-ok-soft text-ok',
            l.type === 'del' && 'bg-danger-soft text-danger line-through decoration-rose-400/60'
          )}
        >
          {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
          {l.text || ' '}
        </div>
      ))}
    </pre>
  );
}

export function SkillApproval({ p }: { p: ToolPart }) {
  const init = (p.input ?? {}) as Partial<Draft>;
  const [d, setD] = useState<Draft>({ name: init.name ?? '', description: init.description ?? '', body: init.body ?? '', model_invocable: init.model_invocable !== false });
  const [reason, setReason] = useState('');
  const existing = allSkills.value.find((s) => s.name === d.name.trim());
  const [view, setView] = useState<'diff' | 'edit'>(existing ? 'diff' : 'edit');
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const descChanged = existing && existing.description !== d.description.trim();

  return (
    <div role="group" aria-label={t('approval.group')} class="my-2 rounded-lg border border-accent bg-accent-soft p-3 text-sm">
      <div class="mb-1 flex items-center gap-1.5 font-medium">
        <Icon name="book" class="size-4" />
        {existing ? t('approval.updateQuestion', { name: existing.name }) : t('approval.saveQuestion')}
      </div>
      <p class="mb-2 text-xs text-muted">
        {t('approval.help')}
      </p>
      {existing && (
        <Segmented
          label={t('approval.viewLabel')}
          items={[
            { id: 'diff', label: t('approval.tabDiff') },
            { id: 'edit', label: t('approval.tabEdit') }
          ]}
          value={view}
          onChange={setView}
          size="sm"
          class="mb-2"
        />
      )}
      {view === 'diff' && existing ? (
        <div class="space-y-2">
          {descChanged && (
            <div class="text-xs">
              <div class="text-muted">{t('description')}</div>
              <div class="text-danger line-through">{existing.description}</div>
              <div class="text-ok">{d.description}</div>
            </div>
          )}
          {existing.modelInvocable !== d.model_invocable && (
            <p class="text-xs">{t('approval.invocableChange', { before: t(existing.modelInvocable ? 'on' : 'off'), after: t(d.model_invocable ? 'on' : 'off') })}</p>
          )}
          <Diff before={existing.body} after={d.body} />
        </div>
      ) : (
        <div class="space-y-2">
          <label class="block text-xs">
            {t('name')}
            <TextField compact class="mt-0.5 block w-full font-mono" value={d.name} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="block text-xs">
            {t('description')}
            <TextArea compact class="mt-0.5 block w-full" rows={2} value={d.description} onInput={(e) => set({ description: (e.target as HTMLTextAreaElement).value })} />
          </label>
          <label class="block text-xs">
            {t('body')}
            <TextArea compact class="mt-0.5 block w-full font-mono leading-5" rows={10} value={d.body} onInput={(e) => set({ body: (e.target as HTMLTextAreaElement).value })} />
          </label>
          <Checkbox class="text-xs" checked={d.model_invocable} onChange={(v) => set({ model_invocable: v })}>
            {t('invocable')}
          </Checkbox>
        </div>
      )}
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => resolveApproval(p.toolCallId, { approved: true, input: d })}>
          <Icon name="check" />
          {existing ? t('approval.update') : t('save')}
        </Button>
        <Button variant="outline" onClick={() => resolveApproval(p.toolCallId, { approved: false, reason: reason || undefined })}>
          <Icon name="x" />
          {t('approval.deny')}
        </Button>
        <TextField compact
          class="min-w-0 flex-1"
          placeholder={t('approval.reason')}
          value={reason}
          onInput={(e) => setReason((e.target as HTMLInputElement).value)}
        />
      </div>
    </div>
  );
}
