// Developer view of one reply's requests: the body sent to the provider at each step, with the system prompt and the
// tools picked out of it (each provider puts them in its own place)
import { sentRequestsOf, type SentRequest } from '../state/sent-requests';
import { showToast } from '../state/ui';
import { Button, Disclosure, Icon } from './ui';
import { formatNumber } from '../lib/i18n';
import { systemOf, toolsOf } from '../lib/providers/request-parts';
import { t } from './messages';

/** Pretty JSON with very long strings (images as base64) shortened, for reading; copying gives the full body */
function shortJson(body: unknown): string {
  return JSON.stringify(body, (_k, v) => (typeof v === 'string' && v.length > 4000 ? `${v.slice(0, 300)}… (${v.length} chars)` : v), 2) ?? String(body);
}

function Step({ r, n }: { r: SentRequest; n: number }) {
  const full = typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2);
  const system = systemOf(r.body);
  const tools = toolsOf(r.body);
  let where = r.url;
  try {
    const u = new URL(r.url);
    where = u.host + u.pathname;
  } catch {
    /* shown as is */
  }
  return (
    <div class="space-y-1.5 border-t border-line pt-2 first:border-t-0 first:pt-0">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-medium text-ink">{t('req.step', { n })}</span>
        <span class="truncate font-mono">{where}</span>
        <span class="tabular-nums">{t('req.size', { kb: formatNumber(Math.ceil(full.length / 1024)) })}</span>
        <Button class="ml-auto text-xs" onClick={() => void navigator.clipboard.writeText(full).then(() => showToast(t('req.copied')))}>
          <Icon name="copy" class="size-3.5" />
          {t('req.copy')}
        </Button>
      </div>
      <Disclosure summary={t('req.system')}>
        <pre class="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sunken p-2 font-mono text-ink">{system || t('req.none')}</pre>
      </Disclosure>
      <Disclosure summary={t('req.tools', { n: tools.length })}>
        <ul class="mt-1 space-y-1.5">
          {tools.map((x) => (
            <li key={x.name}>
              <span class="font-mono text-ink">{x.name}</span>
              {x.description && <span class="block whitespace-pre-wrap">{x.description}</span>}
            </li>
          ))}
        </ul>
      </Disclosure>
      <Disclosure summary={t('req.json')}>
        <pre class="mt-1 max-h-96 overflow-auto rounded-lg bg-sunken p-2 font-mono text-ink">{shortJson(r.body)}</pre>
      </Disclosure>
    </div>
  );
}

/** Under a reply in developer mode: the requests sent for it */
export function RequestView({ replyId }: { replyId: string }) {
  const list = sentRequestsOf(replyId);
  return (
    <div class="mt-2 space-y-2 rounded-xl border border-line bg-glass p-3 text-xs text-muted">
      <p>{t('req.note')}</p>
      {list.map((r, i) => (
        <Step key={i} r={r} n={i + 1} />
      ))}
    </div>
  );
}
