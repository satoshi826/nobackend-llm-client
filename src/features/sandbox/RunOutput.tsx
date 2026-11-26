// Under a run_javascript card: the code that ran and what it printed
import type { ToolPart } from '../../components/extensions';
import { Disclosure } from '../../components/ui';
import { t } from './messages';

export function RunOutput({ p }: { p: ToolPart }) {
  const code = (p.input as { code?: string } | undefined)?.code;
  const d = p.uiDetails as { output?: string; failed?: boolean } | undefined;
  if (!code || !d) return null;
  return (
    <Disclosure class="border-t border-line px-3 py-2 text-xs" summary={t('tool.output')} defaultOpen>
      <pre class="mt-1 max-h-60 overflow-auto rounded-lg bg-sunken p-2 font-mono whitespace-pre-wrap text-ink">{code}</pre>
      <pre class={`mt-1 max-h-60 overflow-auto rounded-lg bg-sunken p-2 font-mono whitespace-pre-wrap ${d.failed ? 'text-danger' : 'text-ink'}`}>{d.output}</pre>
    </Disclosure>
  );
}
