// Approval card for save_skill: shows the full draft for editing, and the changes when updating an existing skill. There is no "Always allow".
import { useMemo, useState } from 'preact/hooks';
import type { Part } from '../lib/providers/types';
import { allSkills, resolveApproval } from '../state/app';
import { lineDiff } from '../lib/skills/diff';
import { Button, Icon, cx } from './ui';

type ToolPart = Extract<Part, { type: 'tool' }>;

interface Draft {
  name: string;
  description: string;
  body: string;
  model_invocable: boolean;
}

const fieldCls = 'block w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[13px] dark:border-zinc-700 dark:bg-zinc-950';

function Diff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const changed = lines.some((l) => l.type !== 'same');
  if (!changed) return <p class="text-xs text-zinc-500">本文の変更はありません。</p>;
  return (
    <pre class="max-h-72 overflow-auto rounded-lg border border-zinc-200 bg-white p-2 font-mono text-xs leading-5 dark:border-zinc-800 dark:bg-zinc-950" aria-label="本文の変更点">
      {lines.map((l, i) => (
        <div
          key={i}
          class={cx(
            'whitespace-pre-wrap',
            l.type === 'add' && 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200',
            l.type === 'del' && 'bg-rose-50 text-rose-900 line-through decoration-rose-400/60 dark:bg-rose-950/60 dark:text-rose-200'
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
    <div role="group" aria-label="スキルの保存の確認" class="my-2 rounded-lg border border-violet-300 bg-violet-50/50 p-3 text-sm dark:border-violet-800 dark:bg-violet-950/30">
      <div class="mb-1 flex items-center gap-1.5 font-medium">
        <Icon name="book" class="size-4" />
        {existing ? `スキル「${existing.name}」を更新してよいですか？` : '新しいスキルを保存してよいですか？'}
      </div>
      <p class="mb-2 text-xs text-zinc-500">
        保存すると、今後の会話でモデルがこの指示を読み込みます。内容を確認し、必要なら直してから保存してください。Web ページなど、あなた以外から来た指示が混ざっていないかにも注意してください。
      </p>
      {existing && (
        <div class="mb-2 flex gap-1 text-xs" role="tablist">
          {(['diff', 'edit'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              class={cx('rounded-md px-2 py-1', view === v ? 'bg-white shadow-sm dark:bg-zinc-900' : 'text-zinc-500')}
              onClick={() => setView(v)}
            >
              {v === 'diff' ? '変更点' : '全文・編集'}
            </button>
          ))}
        </div>
      )}
      {view === 'diff' && existing ? (
        <div class="space-y-2">
          {descChanged && (
            <div class="text-xs">
              <div class="text-zinc-500">説明</div>
              <div class="text-rose-800 line-through dark:text-rose-300">{existing.description}</div>
              <div class="text-emerald-800 dark:text-emerald-300">{d.description}</div>
            </div>
          )}
          {existing.modelInvocable !== d.model_invocable && (
            <p class="text-xs">モデルが必要に応じて使う: {existing.modelInvocable ? 'オン' : 'オフ'} → {d.model_invocable ? 'オン' : 'オフ'}</p>
          )}
          <Diff before={existing.body} after={d.body} />
        </div>
      ) : (
        <div class="space-y-2">
          <label class="block text-xs">
            名前
            <input class={cx(fieldCls, 'mt-0.5 font-mono')} value={d.name} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="block text-xs">
            説明
            <textarea class={cx(fieldCls, 'mt-0.5')} rows={2} value={d.description} onInput={(e) => set({ description: (e.target as HTMLTextAreaElement).value })} />
          </label>
          <label class="block text-xs">
            指示
            <textarea class={cx(fieldCls, 'mt-0.5 font-mono text-xs leading-5')} rows={10} value={d.body} onInput={(e) => set({ body: (e.target as HTMLTextAreaElement).value })} />
          </label>
          <label class="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={d.model_invocable} onChange={(e) => set({ model_invocable: (e.target as HTMLInputElement).checked })} />
            モデルが必要に応じて使う
          </label>
        </div>
      )}
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => resolveApproval(p.toolCallId, { approved: true, input: d })}>
          {existing ? '更新する' : '保存する'}
        </Button>
        <Button variant="outline" onClick={() => resolveApproval(p.toolCallId, { approved: false, reason: reason || undefined })}>
          拒否
        </Button>
        <input
          class="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          placeholder="拒否の理由・直してほしい点（任意・モデルに伝わります）"
          value={reason}
          onInput={(e) => setReason((e.target as HTMLInputElement).value)}
        />
      </div>
    </div>
  );
}
