// Settings → 情報: which build is running, whether a newer one is out, and diagnostics for bug reports
import { useState } from 'preact/hooks';
import { diagnosticsText } from '../../state/diagnostics';
import { APP_BUILD, checkForUpdate, isDevBuild, newerBuild, shortCommit, updateCheck } from '../../state/version';
import { showToast } from '../../state/ui';
import { formatDateTime } from '../../lib/i18n';
import { Button, Chevron, Collapse, Icon, Spinner } from '../ui';
import { Section } from '../settings-ui';
import { t } from './messages';

function Row({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="flex items-baseline justify-between gap-3 text-sm">
      <span class="text-muted">{label}</span>
      <span class="min-w-0 truncate text-right font-mono text-xs text-ink">{children}</span>
    </div>
  );
}

function Version() {
  const [checking, setChecking] = useState(false);
  const check = updateCheck.value;
  const newer = newerBuild.value;
  return (
    <Section title={t('about.version')}>
      {isDevBuild ? (
        <p class="text-sm text-muted">{t('about.dev')}</p>
      ) : (
        <div class="space-y-1.5">
          <Row label={t('about.version')}>{APP_BUILD.version}</Row>
          <Row label={t('about.commit')}>
            <span title={APP_BUILD.commit}>{shortCommit(APP_BUILD.commit)}</span>
          </Row>
          <Row label={t('about.built')}>{APP_BUILD.builtAt ? formatDateTime(new Date(APP_BUILD.builtAt)) : '-'}</Row>
        </div>
      )}
      <div class="space-y-2 border-t border-line pt-3">
        <div class="text-sm" role="status" aria-live="polite">
          {newer ? (
            <span class="text-ink-strong">{t('about.newer', { commit: shortCommit(newer.commit) })}</span>
          ) : !check ? (
            <span class="text-muted">{t('about.notChecked')}</span>
          ) : check.ok ? (
            <span class="text-ink">{t('about.latest')}</span>
          ) : (
            <span class="text-warn">{t('about.checkFailed')}</span>
          )}
          {check && <span class="ml-2 text-xs text-muted">{t('about.checkedAt', { time: formatDateTime(check.at, { timeStyle: 'short' }) })}</span>}
        </div>
        <div class="flex flex-wrap gap-2">
          {newer && (
            <Button variant="primary" onClick={() => location.reload()}>
              <Icon name="refresh" />
              {t('about.reload')}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={checking || isDevBuild}
            onClick={async () => {
              setChecking(true);
              await checkForUpdate();
              setChecking(false);
            }}
          >
            {checking ? <Spinner /> : <Icon name="refresh" class="size-3.5" />}
            {t('about.check')}
          </Button>
        </div>
        <p class="text-xs text-muted">{t('about.updateNote')}</p>
      </div>
    </Section>
  );
}

function Diagnostics() {
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const build = async () => {
    const s = await diagnosticsText();
    setText(s);
    return s;
  };
  return (
    <Section title={t('about.diag')}>
      <p class="text-xs text-muted">{t('about.diagDesc')}</p>
      <p class="text-xs text-muted">{t('about.diagNever')}</p>
      <div class="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await navigator.clipboard.writeText(await build());
              showToast(t('about.diagCopied'));
            } catch {
              setOpen(true);
              showToast(t('about.diagCopyFailed'), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : <Icon name="copy" class="size-3.5" />}
          {t('about.diagCopy')}
        </Button>
        <Button
          aria-expanded={open}
          onClick={async () => {
            if (!open) await build();
            setOpen(!open);
          }}
        >
          <Icon name="file" />
          {t('about.diagShow')}
          <Chevron open={open} />
        </Button>
      </div>
      <Collapse open={open && text !== null}>
        <pre class="scroll-thin max-h-72 overflow-auto rounded-xl bg-sunken p-3 text-xs whitespace-pre-wrap break-all select-all">{text}</pre>
      </Collapse>
    </Section>
  );
}

export function AboutTab() {
  return (
    <div class="space-y-6">
      <Version />
      <Diagnostics />
    </div>
  );
}
