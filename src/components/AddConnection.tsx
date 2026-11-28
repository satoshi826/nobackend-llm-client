// Adding a connection: choose a provider, then save its key. The provider becomes a connection, turned on, once its
// key is stored (a provider that needs no key, at once). Used on the first screen and in Settings → 接続とキー
import { useEffect, useState } from 'preact/hooks';
import { getPreset } from '../lib/providers/registry';
import { accountById } from '../lib/keys/accounts';
import { keyStatus } from '../state/keys';
import { connections, hostOfProvider, providers, setProviderEnabled } from '../state/models';
import { KeyPanel } from './KeyPanel';
import { Badge, Button, Icon } from './ui';
import { t } from './messages';

/** compact: inside a card of the settings (the key's rows are recessed, and where keys are kept is told there already) */
export function AddConnection({ onAdded, heading = true, compact }: { onAdded(id: string): void; heading?: boolean; compact?: boolean }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const keyless = chosen ? !!accountById(chosen)?.keyOptional : false;
  const saved = chosen !== null && (keyless || keyStatus(chosen).present);
  useEffect(() => {
    if (!chosen || !saved) return;
    void setProviderEnabled(chosen, true).then(() => onAdded(chosen));
  }, [chosen, saved]);

  if (chosen && !saved) {
    const keyUrl = getPreset(chosen).keyUrl;
    return (
      <div class="space-y-3">
        <p class="text-xs text-muted">{t('conn.keyNote')}</p>
        {keyUrl && (
          <p class="text-sm">
            <a href={keyUrl} target="_blank" rel="noopener noreferrer" class="text-accent-text underline">
              {t('conn.makeKey', { host: new URL(keyUrl).host })}
            </a>
          </p>
        )}
        <KeyPanel accountId={chosen} compact={compact} />
        <Button variant="outline" class="text-xs" onClick={() => setChosen(null)}>
          <Icon name="chevron-left" class="size-3.5" />
          {t('conn.back')}
        </Button>
      </div>
    );
  }
  const added = new Set(connections.value.map((p) => p.id));
  const available = providers.value.filter((p) => !added.has(p.id));
  // Providers with a free tier first, each group A–Z; the groups are named only when there are two
  const groups = [
    { title: t('conn.freeTier'), list: available.filter((p) => getPreset(p.id).freeTier) },
    { title: t('conn.others'), list: available.filter((p) => !getPreset(p.id).freeTier) }
  ].filter((g) => g.list.length);
  const GroupHeading = heading ? 'h4' : 'h3';
  return (
    <div>
      {heading && <h3 class="mb-2 text-sm font-semibold">{t('conn.chooseHeading')}</h3>}
      <div class="space-y-4">
        {groups.map((g) => (
          <section key={g.title}>
            {groups.length > 1 && <GroupHeading class="mb-2 text-xs font-semibold text-muted">{g.title}</GroupHeading>}
            <ul class="space-y-2">
              {g.list.map((p) => {
                const preset = getPreset(p.id);
                return (
                  <li key={p.id}>
                    <button type="button" class="w-full rounded-xl border border-line p-3 text-left hover:border-line-strong hover:bg-glass" onClick={() => setChosen(p.id)}>
                      <div class="flex items-center gap-2">
                        <span class="shrink-0 font-medium">{preset.label}</span>
                        {preset.freeTier && <Badge>{t('conn.freeTier')}</Badge>}
                        <span class="min-w-0 truncate text-xs text-muted">{hostOfProvider(p.id)}</span>
                        <Icon name="chevron-right" class="ml-auto size-4 shrink-0 text-faint" />
                      </div>
                      {preset.tagline && <p class="mt-1 text-xs leading-5 text-muted">{preset.tagline}</p>}
                      {preset.freeTier && <p class="mt-1 text-xs leading-5 text-muted">{preset.freeTier}</p>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
