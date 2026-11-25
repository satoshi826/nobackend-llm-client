// Web search feature (provider built-in search, or Tavily + Jina Reader tools).
// Importing this module registers it with the core through extension points.
import { registerComposerAddon, registerSettingsTab, registerToolView } from '../../components/extensions';
import { SearchResults, WebSearchButton } from './components/Web';
import { lazyComponent } from '../../components/lazy';
import { t } from './messages';
import { formatNumber } from '../../lib/i18n';
import './state';

export { searchModeFor } from './state';

registerComposerAddon({ id: 'web', Button: WebSearchButton });
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
registerToolView({
  names: ['fetch_url'],
  label: () => t('fetchPage'),
  icon: 'globe',
  editableField: { key: 'url', label: 'URL' },
  approvalNote: () => t('card.fetchNote'),
  doneStatus: (p) => {
    const d = p.uiDetails as { chars?: number; truncated?: boolean } | undefined;
    return t(d?.truncated ? 'card.charsPartial' : 'card.chars', { n: formatNumber(d?.chars ?? 0) });
  }
});
registerSettingsTab({
  id: 'search',
  label: () => t('webSearch'),
  Component: lazyComponent(() => import('./components/SearchSettings').then((m) => m.SearchSettings))
});
