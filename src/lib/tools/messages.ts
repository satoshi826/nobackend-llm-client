// Texts of lib/tools (external services used by tools)
import { defineMessages } from '../i18n';

export const t = defineMessages(
  {
    'tavily.label': 'Tavily（Web 検索）',
    'tavily.keyGuide': 'Tavily（tavily.com）でキーを作成してください。無料枠は月 1,000 クレジット（検索 1 回 = 1 クレジット）です。検索語は Tavily に送られます。',
  },
  {
    en: {
      'tavily.label': 'Tavily (web search)',
      'tavily.keyGuide': 'Create a key at Tavily (tavily.com). The free tier gives 1,000 credits a month (1 search = 1 credit). Search terms are sent to Tavily.',
    },
    zh: {
      'tavily.label': 'Tavily（网页搜索）',
      'tavily.keyGuide': '请在 Tavily（tavily.com）创建密钥。免费额度为每月 1,000 积分（每次搜索 = 1 积分）。搜索词会发送给 Tavily。',
    }
  }
);
