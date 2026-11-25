// Web search results in tool cards
import type { ToolPart } from '../../../components/extensions';
import { t } from '../messages';

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
