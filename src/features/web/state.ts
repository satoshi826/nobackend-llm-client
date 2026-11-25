// Web search: which route a reply uses, and the tools / native search it contributes to a reply.
// Routes (docs/specs/web-and-images.md §2): the chat provider's own search (native), Tavily + Jina tools, or none.
import { getPreset } from '../../lib/providers/registry';
import { keyReady } from '../../state/keys';
import { modelOf, providerById } from '../../state/models';
import { defineFeatureSettings } from '../../state/feature-settings';
import { registerToolProvider } from '../../state/tool-registry';
import { WEB_TOOLS } from './tools';

/**
 * enabled: web search on (the default; off only in settings).
 * searchEngine: on connections with their own search, 'builtin' (native, the default) or 'tools' (Tavily, when usable)
 */
export const webSettings = defineFeatureSettings('web', { enabled: true, searchEngine: 'builtin' as 'builtin' | 'tools' }, (old) =>
  old.searchEngine === 'tools' ? { searchEngine: 'tools' as const } : {}
);

export type SearchRoute = 'native' | 'tools' | null;

/** Whether the connection's own search works with this model */
export function nativeSearchFor(providerId: string, modelId: string): boolean {
  const cfg = providerById(providerId);
  const native = cfg ? getPreset(cfg.preset).nativeWebSearch : undefined;
  return !!native?.supports(modelId, modelOf(providerId, modelId));
}

/**
 * How a reply searches the web.
 * - native: the chat provider's own search (no extra key; billed by the provider; no per-search confirmation)
 * - tools: a tool-calling model + a Tavily key (fallback, or when the user prefers it)
 * - null: off in settings, or no way to search with this model
 */
export function searchRouteFor(providerId: string, modelId: string): SearchRoute {
  if (!webSettings.value.value.enabled) return null;
  const toolsReady = !!modelOf(providerId, modelId)?.capabilities.tools && keyReady('tavily');
  if (nativeSearchFor(providerId, modelId)) return webSettings.value.value.searchEngine === 'tools' && toolsReady ? 'tools' : 'native';
  return toolsReady ? 'tools' : null;
}

registerToolProvider({
  id: 'web',
  tools: ({ conv }) => (searchRouteFor(conv.providerId, conv.modelId) === 'tools' ? WEB_TOOLS : []),
  builtinWebSearch: ({ conv }) => (searchRouteFor(conv.providerId, conv.modelId) === 'native' ? 'auto' : undefined)
});
