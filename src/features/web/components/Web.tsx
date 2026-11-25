// Web search in the input box and in tool cards
import type { Conversation } from '../../../lib/db/schema';
import { updateConversation } from '../../../state/conversations';
import { providerById } from '../../../state/models';
import type { ToolPart } from '../../../components/extensions';
import { Chip, Icon } from '../../../components/ui';
import { searchModeFor } from '../state';
import { t } from '../messages';

export function WebSearchButton({ conv }: { conv: Conversation }) {
  const mode = searchModeFor(conv.providerId, conv.modelId);
  const on = conv.webSearch !== 'off';
  const pname = providerById(conv.providerId)?.name ?? '';
  const title =
    mode === 'builtin'
      ? t('button.builtin', { provider: pname })
      : mode === 'tools'
        ? t('button.tools')
        : t('button.unavailable');
  return (
    <Chip aria-pressed={on} on={on && !!mode} disabled={!mode} title={title} onClick={() => updateConversation({ webSearch: on ? 'off' : 'auto' })}>
      <Icon name="globe" class="size-3.5" />
      {on && mode ? t('button.on') : t('webSearch')}
    </Chip>
  );
}

/** Search results under a web_search card (collapsed) */
export function SearchResults({ p }: { p: ToolPart }) {
  const results = (p.uiDetails as { results?: { title: string; url: string }[] } | undefined)?.results;
  if (p.state !== 'output-available' || !results?.length) return null;
  return (
    <details class="border-t border-line px-3 py-2">
      <summary class="cursor-pointer text-muted">{t('card.showResults')}</summary>
      <ol class="mt-1 list-decimal space-y-0.5 pl-5">
        {results.map((r) => (
          <li key={r.url}>
            <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" class="text-accent-text underline">
              {r.title}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
