// Diagnostics text for bug reports (Settings → 情報 → 診断情報をコピー).
// What it includes: build, browser and its features, storage, vault placement and lock state, which providers are
// on and whether they have a key, model counts, settings that are switches or numbers, row counts, recent errors.
// What it never includes: keys (not even the last digits), conversation text, titles, prompts, skills, file
// names, system prompts, URLs of this deployment or of custom endpoints.
import { recentErrors } from '../lib/error-log';
import { tableCounts } from '../lib/db/repo';
import { vaultIsolated } from '../lib/vault/client';
import { keyInfos, vaultState } from './keys';
import { dataLock } from './lock';
import { enabledProviders, models, modelsStates } from './models';
import { settings } from './settings';
import { APP_BUILD, newerBuild } from './version';

const yes = (b: unknown) => (b ? 'yes' : 'no');
const mb = (n?: number) => (n == null ? '?' : `${(n / 1024 / 1024).toFixed(1)} MB`);

async function features(): Promise<string[]> {
  const w = globalThis as any;
  let prf = '?';
  try {
    const caps = await w.PublicKeyCredential?.getClientCapabilities?.();
    prf = caps ? yes(caps['extension:prf']) : w.PublicKeyCredential ? 'unknown' : 'no';
  } catch {
    /* not supported */
  }
  return [
    `crypto.subtle: ${yes(w.crypto?.subtle)}`,
    `Trusted Types: ${yes(w.trustedTypes)}`,
    `BroadcastChannel: ${yes(w.BroadcastChannel)}`,
    `Service Worker: ${navigator.serviceWorker?.controller ? 'active' : 'serviceWorker' in navigator ? 'not controlling' : 'no'}`,
    `Installed (standalone): ${yes(matchMedia?.('(display-mode: standalone)').matches)}`,
    `Passkey PRF: ${prf}`
  ];
}

export async function diagnosticsText(): Promise<string> {
  const s = settings.value;
  const lines: string[] = ['# nobackend-llm-client diagnostics', `Generated: ${new Date().toISOString()}`, ''];

  lines.push('## Build', `Version: ${APP_BUILD.version}`, `Commit: ${APP_BUILD.commit}`, `Built: ${APP_BUILD.builtAt || '-'}`);
  if (newerBuild.value) lines.push(`Newer build on server: ${newerBuild.value.commit}`);

  lines.push('', '## Browser', `User agent: ${navigator.userAgent}`, `Languages: ${(navigator.languages ?? [navigator.language]).join(', ')}`, `Online: ${yes(navigator.onLine)}`);
  lines.push(...(await features()));

  lines.push('', '## Storage');
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    lines.push(`Used / quota: ${mb(est?.usage)} / ${mb(est?.quota)}`, `Persistent: ${yes(persisted)}`);
  } catch {
    lines.push('Estimate: unavailable');
  }
  try {
    const counts = await tableCounts();
    lines.push(`Rows: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  } catch (e) {
    lines.push(`Rows: unavailable (${String((e as Error)?.message ?? e).slice(0, 120)})`);
  }

  const v = vaultState.value;
  lines.push('', '## Vault and encryption', `Vault: ${vaultIsolated ? 'separate origin' : 'same origin'}`, `Passphrase: ${yes(v.hasPassphrase)}`, `Vault locked: ${yes(v.locked)}`, `Data lock: ${dataLock.value}`);

  lines.push('', '## Providers');
  const enabled = enabledProviders.value;
  if (!enabled.length) lines.push('(none enabled)');
  for (const p of enabled) {
    const k = keyInfos.value[p.id];
    const st = modelsStates.value[p.id];
    const count = models.value.filter((m) => m.providerId === p.id).length;
    lines.push(
      `- ${p.id}: key ${k?.present ? (k.locked ? 'locked' : k.encrypted ? 'encrypted' : 'plain') : 'none'}, models ${count}, list ${st?.fetchedAt ? new Date(st.fetchedAt).toISOString() : 'never'}${st?.error ? `, list error ${st.error.kind}${st.error.status ? ` ${st.error.status}` : ''}` : ''}`
    );
  }

  lines.push(
    '',
    '## Settings',
    `Language: ${s.language}`,
    `Auto lock: ${s.autoLockMinutes} min`,
    `Auto compact: ${yes(s.autoCompact)} (${s.compactThreshold})`,
    `Resend reasoning: ${yes(s.resendReasoning)}`,
    `Temperature: ${s.temperature ?? 'default'}`,
    `Reply suggestions: ${yes(s.replySuggestions)} (${s.suggestionCount})`,
    `Tool permissions: ${Object.entries(s.toolPermissions).map(([k, x]) => `${k}=${x}`).join(', ') || 'default'}`,
    `Provider switches: ${JSON.stringify(s.providerSettings)}`
  );

  const errs = recentErrors();
  lines.push('', `## Recent errors (${errs.length}, this page only)`);
  for (const e of errs) lines.push(`- ${new Date(e.at).toISOString()} [${e.source}${e.provider ? `/${e.provider}` : ''}${e.kind ? ` ${e.kind}` : ''}${e.status ? ` ${e.status}` : ''}] ${e.message}`);
  if (!errs.length) lines.push('(none)');
  return lines.join('\n');
}
