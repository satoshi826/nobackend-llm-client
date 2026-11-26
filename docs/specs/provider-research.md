# Chat providers: research notes (2026-11-26)

Facts about chat providers, for adding more. NanoGPT, DeepInfra, Cerebras, Novita, Chutes and Together are in the app; the others below are candidates. CORS was checked with `OPTIONS` preflights from a foreign origin (2026-11-25/26, no credentials sent); no provider documents CORS, so "yes" is an observation, not a promise. Facts marked *unconfirmed* came from search snippets or pages that did not load and must be checked before implementing.

## Summary

| Provider | Browser-callable | Model list | Spend cap | Data | Reasoning field | Native search / images |
|---|---|---|---|---|---|---|
| **NanoGPT** | Yes (`*`) | **Keyless**, `?detailed=true`: context, capabilities, USD/1M prices | **Per key** (daily/weekly/monthly USD) + account | No logging by default; ZDR routing, Private Mode | `reasoning` (or `reasoning_content` on request) | `:online` / `web_search`; OpenAI-style images |
| **DeepInfra** | Yes (`*`) | **Keyless**, `metadata.pricing`, tags (`chat`, `vision`, `reasoning`…) | **Per key** monthly USD, scoped tokens | Memory only, not logged, no training | `reasoning_content` (*unconfirmed*) | — / OpenAI-style images |
| **Cerebras** | Yes (`*`) | **Keyless** `/public/v1/models`: prices, capabilities, `deprecated` | None documented; prepaid credits | Not retained (privacy policy) | `reasoning` | — / — |
| **Novita** | Yes | **Keyless**, prices, `context_size` | **Per key** budgets | Zero retention by default | `reasoning_content` | — |
| **Chutes** | Yes | **Keyless**, prices, `supported_features`, TEE flag | *unconfirmed* | TEE ("confidential") models | `<think>` inline (existing splitter) | — |
| **Together** | Yes (`*`) | Key; `pricing`, `type` (*shape unconfirmed*) | Prepaid only, no per-key cap | **ZDR by default**, no training | `reasoning` or `reasoning_content` | — / OpenAI-style images |
| **xAI** | Yes (`*`) | Key; prices in cents per 100M | Team prepaid; per-key ACLs and rate limits, no $ cap | 30-day audit; self-serve ZDR | `reasoning_content`; cost `cost_in_usd_ticks` | Search on **Responses API only**; OpenAI-style images |
| **Mistral** | Yes (`*`) | Key; capabilities, no prices | Org/workspace monthly cap | Opt-out training toggle; ZDR via support | `content` chunks typed `thinking` | Search / images only via Agents + Conversations |
| **Moonshot (Kimi)** | Yes (origin echoed) | Key; capability flags, no prices | Per project daily/monthly | Unclear for API (Singapore) | `reasoning_content` (must be sent back) | Client-run search formula; no images |
| **Perplexity** | Yes (`*`) | Ids only | Not documented; docs say keep keys off the client | No training; ZDR by agreement | — | Search built in; API moving from Sonar to a Responses-shaped Agent API |
| **Fireworks** | Yes (`*`) | Key; own paginated shape, no prices | Account monthly cap | Not stored without opt-in | `reasoning_content` | — / non-standard image API |
| **Nebius** | Yes | Key (verbose) | *unconfirmed* | Zero-retention toggle | — | — |
| **Hyperbolic** | Yes | Without prices | *unconfirmed* | *unconfirmed* | — | — |
| **Alibaba (DashScope intl)** | Yes | Key | **No hard cap** | — | — | `enable_search` (no sources in compat mode) |
| SambaNova | **No** (only its own origin) | — | — | — | — | — |
| Z.ai / BigModel | **No** (no ACAO on preflight) | — | — | — | — | — |

Base URLs: NanoGPT `https://api.nano-gpt.com/api/v1`, DeepInfra `https://api.deepinfra.com/v1/openai`, Cerebras `https://api.cerebras.ai/v1`, Novita `https://api.novita.ai/openai/v1`, Chutes `https://llm.chutes.ai/v1`, Together `https://api.together.ai/v1`, xAI `https://api.x.ai/v1`, Mistral `https://api.mistral.ai/v1`, Moonshot `https://api.moonshot.ai/v1`, Perplexity `https://api.perplexity.ai`, Fireworks `https://api.fireworks.ai/inference/v1`, Nebius `https://api.tokenfactory.nebius.com/v1`, Hyperbolic `https://api.hyperbolic.ai/inference/v1` (recheck the Novita and Chutes hosts against their docs when adding them).

## Recommendation

1. **Next — presets with small adapter options**: xAI (chat is compatible; native search needs the Responses API, so use the Tavily fallback first), Moonshot (send `reasoning_content` back), Mistral (parse `thinking` content chunks; search and images need the Agents API, so leave them out), Fireworks (model list needs its own mapper).
2. **Later or skip**: Perplexity (the API is mid-migration and the docs say not to use keys client-side), Nebius / Hyperbolic / Alibaba (little to gain over the hosts already in the app; Alibaba has no spend cap), SambaNova and Z.ai (no CORS, would need a proxy).
