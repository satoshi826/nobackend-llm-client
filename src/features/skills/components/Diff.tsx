// The lines a skill's instructions gain and lose (reviewing an update from a model or an import)
import { useMemo } from 'preact/hooks';
import { lineDiff } from '../../../lib/skills/diff';
import { cx } from '../../../components/ui';
import { t } from '../messages';

export function Diff({ before, after }: { before: string; after: string }) {
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
