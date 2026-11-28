// External services used by tools (other than LLMs). Their keys are kept in the key vault, like LLM providers' keys.
import { t } from './messages';

export interface ToolService {
  id: string;
  label: string;
  baseUrl: string;
  /** The API paths (relative to baseUrl) the app calls with the key: the vault attaches it to no other path */
  paths: string[];
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
    paths: ['search'],
    keyOptional: false,
    get keyGuide() {
      return t('tavily.keyGuide');
    }
  }
};

export const SERVICE_ORDER = ['tavily'] as const;
