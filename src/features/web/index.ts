// The web feature: searching (the chat provider's own search, or the Tavily tool) and reading pages (fetch_url).
// On by default; turned off in Settings → Web 検索 (no per-conversation switch).
// Importing this module registers it with the core through extension points.
import { registerSettingsTab, registerToolView } from '../../components/extensions';
import { SearchResults } from './components/Web';
import { lazyComponent } from '../../components/lazy';
import { t } from './messages';
import './state';

export { searchRouteFor } from './state';

registerToolView({
  names: ['web_search'],
  label: () => t('webSearch'),
  icon: 'search',
  editableField: {
    key: 'query',
    label: () => t('card.queryField')
  },
  approvalNote: () => t('card.searchNote'),
  doneStatus: (p) => {
    const n = (p.uiDetails as { results?: unknown[] } | undefined)?.results?.length ?? 0;
    return t(n === 1 ? 'card.resultsOne' : 'card.resultsMany', { n });
  },
  Detail: SearchResults
});
// fetch_url asks in the fetch page, not on a card: the card shows what was asked of the page and where it came from
registerToolView({
  names: ['fetch_url'],
  label: () => t('fetchPage'),
  icon: 'globe',
  summary: (p) => {
    const i = p.input as { url?: string; prompt?: string } | undefined;
    return i?.url ? `${i.url}${i.prompt ? ` — ${t('card.prompt')}: ${i.prompt}` : ''}` : undefined;
  },
  doneStatus: (p) => {
    const d = p.uiDetails as { title?: string; url?: string; via?: string } | undefined;
    if (!d?.url) return undefined;
    return t(d.via === 'jina' ? 'card.readJina' : 'card.read', { title: d.title ? `「${d.title}」` : new URL(d.url).host });
  }
});
registerSettingsTab({
  id: 'search',
  label: () => t('tabLabel'),
  icon: 'globe',
  Component: lazyComponent(() => import('./components/SearchSettings').then((m) => m.SearchSettings))
});
