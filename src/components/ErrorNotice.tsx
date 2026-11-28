// A failure as the user sees it: what happened and what to do, the provider's own words on request, and the
// actions the app can take for its kind
import type { MessageError } from '../lib/db/schema';
import type { ProviderErrorKind } from '../lib/providers/types';
import { getPreset } from '../lib/providers/registry';
import { providerById } from '../state/models';
import { contextPanelOpen, openSettings } from '../state/ui';
import { IdleButton } from './IdleButton';
import { Button, Disclosure, Icon } from './ui';
import { t } from './messages';

/** Kinds where sending the same request again may work (after waiting, or after fixing the key or the balance) */
const RETRY = new Set<string>(['auth', 'insufficient-balance', 'rate-limit', 'overloaded', 'timeout', 'server', 'network-or-cors'] satisfies ProviderErrorKind[]);
/** Kinds where another model may answer */
const OTHER_MODEL = new Set<string>(['model-unavailable', 'context-length', 'content-policy', 'overloaded', 'bad-request'] satisfies ProviderErrorKind[]);

/** retry / otherModel: given only where they can run (the request can be sent again; another model can answer it) */
export function ErrorNotice({ error, providerId, retry, otherModel }: { error: MessageError; providerId?: string; retry?(): void; otherModel?(): void }) {
  const kind = error.kind;
  const cfg = providerId ? providerById(providerId) : undefined;
  const creditUrl = kind === 'insufficient-balance' && cfg ? getPreset(cfg.preset).creditUrl : undefined;
  const actions = [
    kind === 'auth' && (
      <Button key="keys" class="text-xs" variant="outline" onClick={() => openSettings('connections')}>
        <Icon name="key" class="size-3.5" />
        {t('error.openKeys')}
      </Button>
    ),
    creditUrl && (
      <Button key="credit" class="text-xs" variant="outline" title={new URL(creditUrl).host} onClick={() => window.open(creditUrl, '_blank', 'noopener,noreferrer')}>
        <Icon name="link" class="size-3.5" />
        {t('error.addCredit')}
      </Button>
    ),
    kind === 'context-length' && (
      <Button key="compact" class="text-xs" variant="outline" onClick={() => (contextPanelOpen.value = true)}>
        <Icon name="compress" class="size-3.5" />
        {t('error.compact')}
      </Button>
    ),
    retry && RETRY.has(kind) && (
      <IdleButton key="retry" class="text-xs" variant="outline" onClick={retry}>
        <Icon name="refresh" class="size-3.5" />
        {t('msg.regenerate')}
      </IdleButton>
    ),
    otherModel && OTHER_MODEL.has(kind) && (
      <IdleButton key="other" class="text-xs" variant="outline" onClick={otherModel}>
        <Icon name="swap" class="size-3.5" />
        {t('msg.regenerateOther')}
      </IdleButton>
    )
  ].filter(Boolean);
  const said = [error.status && `HTTP ${error.status}`, error.detail].filter(Boolean).join('\n');
  return (
    <div class="mt-2 space-y-2">
      <div role="alert" class="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
        <div>{error.message}</div>
        {error.hint && <div class="mt-1 text-xs opacity-80">{error.hint}</div>}
        {said && (
          <Disclosure class="mt-1 text-xs" summary={t('error.details')}>
            <pre class="mt-1 whitespace-pre-wrap break-words font-sans text-muted">{said}</pre>
          </Disclosure>
        )}
      </div>
      {actions.length > 0 && <div class="flex flex-wrap gap-1.5">{actions}</div>}
    </div>
  );
}
