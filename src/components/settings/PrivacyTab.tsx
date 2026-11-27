// Settings → プライバシーとデータ: destinations, storage, backups, deleting keys and everything
import { useEffect, useRef, useState } from 'preact/hooks';
import { BackupPasswordNeeded, downloadExport, importFromFile, wipeEverything } from '../../state/data';
import { clearAllKeys, vaultState } from '../../state/keys';
import { enabledProviders, hostOfProvider } from '../../state/models';
import { saveSettings, settings } from '../../state/settings';
import { showToast } from '../../state/ui';
import { imageUsage } from '../../lib/db/images';
import { storageBreakdown, type StorageBreakdown } from '../../lib/db/storage-usage';
import { getPreset } from '../../lib/providers/registry';
import { accountById } from '../../lib/keys/accounts';
import { FETCH_ROUTES } from '../../lib/fetcher/config';
import { askConfirm } from '../ConfirmDialog';
import { safariClearsData } from '../device';

import { Button, Icon, Spinner, TextField, Checkbox } from '../ui';
import { Section } from '../settings-ui';
import { t } from './messages';
import { sentences } from '../messages';
import { formatDateTime, formatNumber } from '../../lib/i18n';

const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

export function PrivacyTab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null);
  // Encrypted backups: on by default when the vault has a passphrase
  const [encrypt, setEncrypt] = useState(vaultState.value.hasPassphrase);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [importPw, setImportPw] = useState('');
  const doImport = async (f: File, password?: string) => {
    try {
      const r = await importFromFile(f, password);
      setPendingFile(null);
      setImportPw('');
      const items = [t('privacy.importItemConversations', { n: formatNumber(r.conversations) })];
      if (r.skills) items.push(t('privacy.importItemSkills', { n: formatNumber(r.skills) }));
      if (r.tables.files) items.push(t('privacy.importItemFiles', { n: formatNumber(r.tables.files) }));
      if (r.tables.images) items.push(t('privacy.importItemImages', { n: formatNumber(r.tables.images) }));
      showToast(t('privacy.imported', { items: items.join(t('privacy.importItemSep')), skipped: formatNumber(r.skipped) }));
    } catch (err) {
      if (err instanceof BackupPasswordNeeded) setPendingFile(f);
      else showToast((err as Error).message, 'error');
    }
  };
  const [imgUsage, setImgUsage] = useState<{ count: number; bytes: number } | null>(null);
  useEffect(() => {
    void imageUsage().then(setImgUsage);
  }, []);
  const s = settings.value;
  useEffect(() => {
    (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      setUsage({ used: est?.usage ?? 0, quota: est?.quota ?? 0, persisted });
    })();
  }, []);
  const rows: [string, string][] = [
    ...enabledProviders.value.map(
      (p) => {
        const preset = getPreset(p.preset);
        // The provider's own web search: queries go to the provider too (and on to its search engine)
        const search = preset.nativeWebSearch?.note;
        const note = [preset.copy?.destinationNote, search && t('privacy.destSearch', { note: search })].filter(Boolean).join(' ');
        return [hostOfProvider(p.id), note ? t('privacy.destProviderNote', { name: p.name, note }) : t('privacy.destProvider', { name: p.name })] as [string, string];
      }
    ),
    [accountById('tavily')!.host, t('privacy.destTavily')],
    [t('privacy.destPages'), t('privacy.destPagesText', { jina: new URL(FETCH_ROUTES.jina).host })],
    ...(FETCH_ROUTES.relay ? [[new URL(FETCH_ROUTES.relay).host, t('privacy.destRelay')] as [string, string]] : []),
    ...enabledProviders.value.flatMap((p) => getPreset(p.preset).copy?.extraDestinations ?? []),
    [t('privacy.destOrigin'), t('privacy.destOriginText')]
  ];
  return (
    <div class="space-y-6 text-sm">
      <Section title={t('privacy.destinations')}>
        <table class="w-full text-left text-xs">
          <tbody class="divide-y divide-line">
            {rows.map(([dest, what]) => (
              <tr key={dest}>
                <td class="py-1.5 pr-3 align-top font-mono whitespace-nowrap">{dest}</td>
                <td class="py-1.5">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="text-xs text-muted">{t('privacy.destinationsNote')}</p>
      </Section>
      <Section title={t('privacy.storage')}>
        {usage && (
          <div class="space-y-1.5">
            <p class="text-xs text-muted">
              {t('privacy.usage', { used: formatNumber(usage.used / 1024 / 1024, ONE_DECIMAL), quota: formatNumber(usage.quota / 1024 / 1024 / 1024, ONE_DECIMAL) })} ·{' '}
              {usage.persisted ? t('privacy.persisted') : t('privacy.notPersisted')}
            </p>
            {safariClearsData && <p class="text-xs text-warn">{t('privacy.iosHomeScreen')}</p>}
            {!usage.persisted && (
              <Button
                variant="outline"
                class="text-xs"
                onClick={async () => {
                  const ok = (await navigator.storage?.persist?.()) ?? false;
                  setUsage({ ...usage, persisted: ok });
                  showToast(
                    ok ? t('privacy.persistGranted') : t('privacy.persistDenied'),
                    ok ? 'info' : 'error'
                  );
                }}
              >
                <Icon name="shield" class="size-3.5" />
                {t('privacy.requestPersist')}
              </Button>
            )}
          </div>
        )}
        <StorageParts />
        <div class="space-y-2 rounded-lg border border-line p-3">
          <Checkbox checked={encrypt} onChange={setEncrypt}>
            <span>
              {t('privacy.encrypt')}
              <span class="block text-xs text-muted">{t('privacy.encryptDesc')}</span>
            </span>
          </Checkbox>
          {encrypt && (
            <div class="grid gap-2 sm:grid-cols-2">
              <TextField type="password" autocomplete="new-password" placeholder={t('privacy.passwordPlaceholder')} value={pw1} onInput={(e) => setPw1((e.target as HTMLInputElement).value)} aria-label={t('privacy.passwordLabel')} />
              <TextField type="password" autocomplete="new-password" placeholder={t('privacy.passwordConfirmPlaceholder')} value={pw2} onInput={(e) => setPw2((e.target as HTMLInputElement).value)} aria-label={t('privacy.passwordConfirmLabel')} />
            </div>
          )}
          {encrypt && pw1.length >= 8 && pw2 && pw1 !== pw2 && <p class="text-xs text-danger">{t('privacy.passwordMismatch')}</p>}
          <div class="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || (encrypt && (pw1.length < 8 || pw1 !== pw2))}
              aria-busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await downloadExport(encrypt ? pw1 : undefined);
                  showToast(encrypt ? t('privacy.exportedEncrypted') : t('privacy.exported'));
                  setPw1('');
                  setPw2('');
                } catch (err) {
                  showToast((err as Error).message, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner class="size-4" /> : <Icon name="download" />}
              {t('privacy.export')}
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" />
              {t('privacy.import')}
            </Button>
          </div>
          {pendingFile && (
            <form
              class="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void doImport(pendingFile, importPw);
              }}
            >
              <span class="text-xs text-muted">{t('privacy.fileEncrypted', { name: pendingFile.name })}</span>
              <TextField type="password" autocomplete="current-password" placeholder={t('privacy.password')} value={importPw} onInput={(e) => setImportPw((e.target as HTMLInputElement).value)} aria-label={t('privacy.passwordLabel')} data-autofocus />
              <Button variant="primary" type="submit" disabled={!importPw}>
                <Icon name="key" />
                {t('privacy.decryptImport')}
              </Button>
              <Button onClick={() => setPendingFile(null)}>{t('privacy.cancel')}</Button>
            </form>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            class="hidden"
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              (e.target as HTMLInputElement).value = '';
              if (f) await doImport(f);
            }}
          />
        </div>
        <Checkbox class="text-sm" checked={s.backupIncludeImages} onChange={(v) => void saveSettings({ backupIncludeImages: v })}>
          <span>
            {t('privacy.includeImages')}
            <span class="block text-xs text-muted">
              {sentences(
                t('privacy.includeImagesSize'),
                imgUsage && t('privacy.includeImagesNow', { count: formatNumber(imgUsage.count), size: formatNumber(imgUsage.bytes / 1024 / 1024, ONE_DECIMAL) }),
                t('privacy.includeImagesOff')
              )}
            </span>
          </span>
        </Checkbox>
        <p class="text-xs text-muted">
          {sentences(s.lastBackupAt ? t('privacy.lastBackup', { date: formatDateTime(s.lastBackupAt) }) : t('privacy.noBackupYet'), t('privacy.noKeysInBackup'))}
        </p>
      </Section>
      <Section title={t('privacy.deleteKeys')}>
        <p class="text-xs text-muted">{vaultState.value.hasPassphrase ? t('privacy.deleteKeysTextPass') : t('privacy.deleteKeysText')}</p>
        <Button
          variant="danger"
          onClick={() =>
            void askConfirm({
              title: t('privacy.deleteKeysTitle'),
              message: vaultState.value.hasPassphrase ? t('privacy.deleteKeysConfirmPass') : t('privacy.deleteKeysConfirm'),
              confirmLabel: t('privacy.deleteKeysButton'),
              danger: true
            }).then(async (ok) => {
              if (!ok) return;
              await clearAllKeys();
              showToast(t('privacy.keysDeleted'));
            })
          }
        >
          <Icon name="trash" />
          {t('privacy.deleteKeysTitle')}
        </Button>
      </Section>
      <Section title={t('privacy.wipe')}>
        <p class="text-xs text-muted">{t('privacy.wipeText')}</p>
        <Button
          variant="danger"
          onClick={() =>
            void askConfirm({
              title: t('privacy.wipeTitle'),
              message: t('privacy.wipeConfirm'),
              confirmLabel: t('privacy.wipeButton'),
              danger: true,
              requireText: t('privacy.deleteWord')
            }).then((ok) => {
              if (ok) void wipeEverything();
            })
          }
        >
          <Icon name="trash" />
          {t('privacy.wipeTitle')}
        </Button>
      </Section>
    </div>
  );
}


const mb = (bytes: number) => formatNumber(bytes / 1024 / 1024, ONE_DECIMAL);

/** What takes the space, measured when asked (it reads every record once) */
function StorageParts() {
  const [parts, setParts] = useState<{ b: StorageBreakdown; used: number; caches: number } | 'loading' | null>(null);
  if (parts === null)
    return (
      <Button
        variant="outline"
        class="text-xs"
        onClick={async () => {
          setParts('loading');
          const [b, est] = await Promise.all([storageBreakdown(), navigator.storage?.estimate?.()]);
          const details = (est as { usageDetails?: Record<string, number> } | undefined)?.usageDetails;
          setParts({ b, used: est?.usage ?? 0, caches: details?.caches ?? 0 });
        }}
      >
        <Icon name="chart" class="size-3.5" />
        {t('privacy.breakdown')}
      </Button>
    );
  if (parts === 'loading')
    return (
      <p class="flex items-center gap-2 text-xs text-muted" role="status">
        <Spinner class="size-3.5" />
        {t('privacy.breakdownLoading')}
      </p>
    );
  const { b, used, caches } = parts;
  const known = b.conversations.bytes + b.images.bytes + b.videos.bytes + b.files.bytes + b.other + caches;
  const rows: [string, number][] = [
    [t('privacy.partConversations', { n: formatNumber(b.conversations.count) }), b.conversations.bytes],
    [t('privacy.partImages', { n: formatNumber(b.images.count) }), b.images.bytes],
    ...(b.videos.count ? [[t('privacy.partVideos', { n: formatNumber(b.videos.count) }), b.videos.bytes] as [string, number]] : []),
    [t('privacy.partFiles', { n: formatNumber(b.files.count) }), b.files.bytes],
    [t('privacy.partOther'), b.other],
    ...(caches ? [[t('privacy.partApp'), caches] as [string, number]] : []),
    ...(used > known ? [[t('privacy.partBrowser'), used - known] as [string, number]] : [])
  ];
  return (
    <div class="space-y-1.5">
      <ul class="divide-y divide-line rounded-lg border border-line text-xs">
        {rows.map(([name, bytes]) => (
          <li key={name} class="flex items-baseline justify-between gap-3 px-3 py-1.5">
            <span class="min-w-0">{name}</span>
            <span class="shrink-0 tabular-nums text-muted">{t('privacy.partSize', { size: mb(bytes) })}</span>
          </li>
        ))}
      </ul>
      <p class="text-xs text-muted">{t('privacy.breakdownNote')}</p>
    </div>
  );
}
