// Settings → 情報: which build is running, whether a newer one is out, and diagnostics for bug reports
import { useState } from 'preact/hooks';
import { diagnosticsText } from '../../state/diagnostics';
import { APP_BUILD, checkForUpdate, isDevBuild, newerBuild, shortCommit, updateCheck } from '../../state/version';
import { showToast } from '../../state/ui';
import { formatDateTime } from '../../lib/i18n';
import { Button, Chevron, Collapse, Icon, Spinner } from '../ui';
import { Group, Row, ToggleRow } from '../settings-ui';
import { saveSettings, settings } from '../../state/settings';
import { t } from './messages';

/** A fact about the build, as a row: its value on the right, in the code font */
const fact = (value: preact.ComponentChildren) => <span class="font-mono text-xs text-ink">{value}</span>;

function Version() {
  const [checking, setChecking] = useState(false);
  const check = updateCheck.value;
  const newer = newerBuild.value;
  return (
    // A development build has no version to compare, so it cannot check for updates: only what it is shows
    isDevBuild ? (
      <Group title={t('about.version')}>
        <Row label={t('about.dev')} />
      </Group>
    ) : (
      <Group title={t('about.version')} footer={t('about.updateNote')}>
        <Row label={t('about.version')} control={fact(APP_BUILD.version)} />
        <Row label={t('about.commit')} control={fact(<span data-tip={APP_BUILD.commit}>{shortCommit(APP_BUILD.commit)}</span>)} />
        <Row label={t('about.built')} control={fact(APP_BUILD.builtAt ? formatDateTime(new Date(APP_BUILD.builtAt)) : '-')} />
        <div class="space-y-2.5 px-4 py-3">
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
              disabled={checking}
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
        </div>
      </Group>
    )
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
    <Group title={t('about.diag')} note={t('about.diagDesc')} footer={t('about.diagNever')}>
      <div class="space-y-2.5 px-4 py-3">
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
      </div>
    </Group>
  );
}

export function AboutTab() {
  return (
    <div class="space-y-8">
      <Version />
      <Diagnostics />
      <Group title={t('about.developer')} footer={t('about.devRequestsNote')}>
        <ToggleRow checked={settings.value.developerMode} onChange={(v) => saveSettings({ developerMode: v })} label={t('about.devRequests')} hint={t('about.devRequestsDesc')} />
      </Group>
    </div>
  );
}
