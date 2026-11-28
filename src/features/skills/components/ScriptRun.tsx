// Under a run_skill_script card: what the script printed, and, once it ended having written files, the question which
// of them to save in the working folder (then what was saved); or that it was stopped before it ended
import { useState } from 'preact/hooks';
import type { ToolPart } from '../../../components/extensions';
import { Button, Checkbox, Disclosure, Icon } from '../../../components/ui';
import { formatBytes } from '../../../lib/i18n';
import { RUN_TIMEOUT_MS } from '../../../lib/sandbox/client';
import { saveQuestions, type SaveQuestion } from '../saving';
import type { ScriptDetails } from '../tools';
import { t } from '../messages';

function SaveFiles({ q }: { q: SaveQuestion }) {
  const [chosen, setChosen] = useState(() => new Set(q.files.map((f) => f.path)));
  const toggle = (path: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(path);
    else next.delete(path);
    setChosen(next);
  };
  return (
    <div role="group" aria-label={t('script.saveGroup')} class="border-t border-accent bg-accent-soft px-3 py-2 text-sm">
      <p class="font-medium">{t('script.saveQuestion')}</p>
      <ul class="mt-1.5 space-y-1">
        {q.files.map((f) => (
          <li key={f.path}>
            <Checkbox class="text-xs" checked={chosen.has(f.path)} onChange={(on) => toggle(f.path, on)}>
              <span class="min-w-0 font-mono break-all">{f.path}</span>
              <span class="shrink-0 text-muted">
                {formatBytes(f.bytes)} · {f.replaces ? t('script.replaces') : t('script.new')}
              </span>
            </Checkbox>
          </li>
        ))}
      </ul>
      {q.files.some((f) => f.replaces) && <p class="mt-1.5 text-xs text-muted">{t('script.saveHelp')}</p>}
      <div class="mt-2 flex flex-wrap gap-2">
        <Button variant="primary" disabled={!chosen.size} onClick={() => q.answer([...chosen])}>
          <Icon name="check" />
          {t('script.save')}
        </Button>
        <Button variant="outline" onClick={() => q.answer(null)}>
          <Icon name="x" />
          {t('script.dontSave')}
        </Button>
      </div>
    </div>
  );
}

export function ScriptRun({ p, live }: { p: ToolPart; live: boolean }) {
  const q = live ? saveQuestions.value[p.toolCallId] : undefined;
  const d = p.uiDetails as ScriptDetails | undefined;
  const printed = q?.printed ?? d;
  return (
    <>
      {printed && (printed.stdout || printed.stderr) && (
        <Disclosure class="border-t border-line px-3 py-2 text-xs" summary={t('script.output')} defaultOpen>
          {printed.stdout && <pre class="mt-1 max-h-60 overflow-auto rounded-lg bg-sunken p-2 font-mono whitespace-pre-wrap text-ink">{printed.stdout}</pre>}
          {printed.stderr && <pre class="mt-1 max-h-60 overflow-auto rounded-lg bg-sunken p-2 font-mono whitespace-pre-wrap text-danger">{printed.stderr}</pre>}
        </Disclosure>
      )}
      {d?.stopped && <p class="border-t border-line px-3 py-2 text-xs text-muted">{d.stopped === 'time' ? t('script.stoppedTime', { s: RUN_TIMEOUT_MS / 1000 }) : t('script.stoppedUser')}</p>}
      {q && <SaveFiles q={q} />}
      {!q && !!d?.saved?.length && <p class="border-t border-line px-3 py-2 text-xs text-muted">{t('script.saved', { paths: d.saved.join(', ') })}</p>}
      {!q && d?.declined && <p class="border-t border-line px-3 py-2 text-xs text-muted">{t('script.declined')}</p>}
    </>
  );
}
