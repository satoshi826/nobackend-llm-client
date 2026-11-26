// The result of a code block's "run" button: HTML / SVG shown in the sandbox, JavaScript run there (console output)
import { useEffect, useState } from 'preact/hooks';
import { runJavaScript, runText, type RunResult } from '../lib/sandbox/client';
import { SandboxFrame, svgPage } from './SandboxFrame';
import { Spinner } from './ui';
import { t } from './messages';

export function CodeRun({ kind, code }: { kind: 'html' | 'svg' | 'js'; code: string }) {
  const [out, setOut] = useState<RunResult | null>(null);
  useEffect(() => {
    if (kind === 'js') void runJavaScript(code).then(setOut);
  }, [kind, code]);
  return (
    <div class="mt-2 space-y-1">
      {kind === 'js' ? (
        out ? (
          <pre class={`m-0 max-h-80 overflow-auto rounded-xl border border-line bg-sunken p-3 font-mono text-[13px] whitespace-pre-wrap ${out.error ? 'text-danger' : 'text-ink'}`}>{runText(out) || t('run.noOutput')}</pre>
        ) : (
          <div class="flex items-center gap-2 text-xs text-muted">
            <Spinner class="size-3" />
            {t('run.running')}
          </div>
        )
      ) : (
        <SandboxFrame html={kind === 'svg' ? svgPage(code) : code} title={t('run.preview')} class="h-80" />
      )}
      <p class="text-xs text-muted">{t('run.note')}</p>
    </div>
  );
}
