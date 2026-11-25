// External services used by tools (other than LLMs). Keys are kept the same way as for LLM providers (direct mode / key vault).
import { t } from './messages';

export interface ToolService {
  id: string;
  label: string;
  baseUrl: string;
  /** Usable without a key (with limits) */
  keyOptional: boolean;
  keyGuide: string;
}

const env = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;

export const SERVICES: Record<string, ToolService> = {
  // label and keyGuide are getters so they follow the current language
  tavily: {
    id: 'tavily',
    get label() {
      return t('tavily.label');
    },
    baseUrl: env.VITE_TAVILY_BASE_URL || 'https://api.tavily.com',
    keyOptional: false,
    get keyGuide() {
      return t('tavily.keyGuide');
    }
  },
  jina: {
    id: 'jina',
    get label() {
      return t('jina.label');
    },
    baseUrl: env.VITE_JINA_BASE_URL || 'https://r.jina.ai',
    keyOptional: true,
    get keyGuide() {
      return t('jina.keyGuide');
    }
  }
};

export const SERVICE_ORDER = ['tavily', 'jina'] as const;

export function serviceById(id: string): ToolService | undefined {
  return SERVICES[id];
}

export function serviceHost(id: string): string {
  const s = SERVICES[id];
  return s ? new URL(s.baseUrl).host : '';
}
