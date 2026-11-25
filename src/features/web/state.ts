// Web search: which method a conversation uses, and the tools / built-in search it contributes to a reply
import { getPreset } from '../../lib/providers/registry';
import { keyReady } from '../../state/keys';
import { modelOf, providerById } from '../../state/models';
import { defineFeatureSettings } from '../../state/feature-settings';
import { registerToolProvider } from '../../state/tool-registry';
import { WEB_TOOLS } from './tools';

/** Search method on providers with built-in web search (providers without one always use tools) */
export const webSettings = defineFeatureSettings('web', { searchEngine: 'builtin' as 'builtin' | 'tools' }, (old) =>
  old.searchEngine === 'tools' ? { searchEngine: 'tools' as const } : {}
);

/**
 * How web search is done in a conversation.
 * - 'tools': a tool-calling model + a Tavily key (on providers with built-in search, when "tools" is chosen in settings)
 * - 'builtin': the provider's built-in search (features.builtInWebSearch)
 * - null: unavailable
 */
export function searchModeFor(providerId: string, modelId: string): 'tools' | 'builtin' | null {
  const m = modelOf(providerId, modelId);
  const toolsReady = !!m?.capabilities.tools && keyReady('tavily');
  const cfg = providerById(providerId);
  if (cfg && getPreset(cfg.preset).features?.builtInWebSearch) {
    if (webSettings.value.value.searchEngine === 'tools' && toolsReady) return 'tools';
    return m?.capabilities.webSearch === false ? (toolsReady ? 'tools' : null) : 'builtin';
  }
  return toolsReady ? 'tools' : null;
}

registerToolProvider({
  id: 'web',
  tools: ({ conv }) => (conv.webSearch !== 'off' && searchModeFor(conv.providerId, conv.modelId) === 'tools' ? WEB_TOOLS : []),
  builtinWebSearch: ({ conv }) => (conv.webSearch !== 'off' && searchModeFor(conv.providerId, conv.modelId) === 'builtin' ? conv.webSearch : undefined)
});
