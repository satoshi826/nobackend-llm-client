// Every provider's preset is made here: from its connection (endpoints.ts) and what the provider does differently
import type { ProviderPreset } from '../types';
import type { Endpoint } from '../endpoints';
import { t as tp } from './messages';

type Key = Parameters<typeof tp>[0];

/**
 * The preset of a connection. Its tagline and key guide are the texts `<id>.tagline` and `<id>.keyGuide`, its CORS
 * hint names its host; `own` may replace them. Getters in `own` stay getters (texts follow the current language)
 */
export function definePreset(e: Endpoint, own: Partial<Omit<ProviderPreset, 'id' | 'label' | 'modelsNeedKey'>> = {}): ProviderPreset {
  const id = e.id;
  const host = new URL(e.baseUrl).host;
  const preset: ProviderPreset = {
    id,
    label: e.label,
    modelsNeedKey: !e.publicModels,
    get tagline() {
      return tp(`${id}.tagline` as Key);
    },
    get keyGuide() {
      return tp(`${id}.keyGuide` as Key);
    },
    get corsHint() {
      return tp('cors.generic', { host });
    }
  };
  return Object.defineProperties(preset, Object.getOwnPropertyDescriptors(own));
}

/**
 * A provider's cheaper, lower-priority tier as a setting of the connection (off by default). A request it refuses is
 * sent again in the standard tier (the adapter's streamChat), and an answer it served is priced at `priceFactor` of the list price
 */
export function flexTier(priceFactor: number): Pick<ProviderPreset, 'flex' | 'settings' | 'requestOptions'> {
  return {
    flex: { priceFactor },
    settings: [
      {
        key: 'flex',
        get label() {
          return tp('flex.label');
        },
        get desc() {
          return tp('flex.desc', { percent: Math.round((1 - priceFactor) * 100) });
        },
        default: false
      }
    ],
    requestOptions: ({ settings }) => (settings.flex ? { service_tier: 'flex' } : undefined)
  };
}
