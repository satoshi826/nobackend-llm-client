// Texts of lib/tools (external services used by tools)
import { defineMessages } from '../i18n';

export const t = defineMessages(
  {
    'tavily.label': 'Tavily（Web 検索）',
    'tavily.keyGuide': 'Tavily（tavily.com）でキーを作成してください。無料枠は月 1,000 クレジット（検索 1 回 = 1 クレジット）です。検索語は Tavily に送られます。',
    'jina.label': 'Jina Reader（ページ本文の取得）',
    'jina.keyGuide': 'キーなしでも使えます（1 分あたり 20 回まで）。キーを設定すると上限が上がります。取得する URL は Jina に送られます。'
  },
  {
    en: {
      'tavily.label': 'Tavily (web search)',
      'tavily.keyGuide': 'Create a key at Tavily (tavily.com). The free tier gives 1,000 credits a month (1 search = 1 credit). Search terms are sent to Tavily.',
      'jina.label': 'Jina Reader (page text)',
      'jina.keyGuide': 'Works without a key (up to 20 requests a minute). Setting a key raises the limit. The URLs you fetch are sent to Jina.'
    },
    zh: {
      'tavily.label': 'Tavily（网页搜索）',
      'tavily.keyGuide': '请在 Tavily（tavily.com）创建密钥。免费额度为每月 1,000 积分（每次搜索 = 1 积分）。搜索词会发送给 Tavily。',
      'jina.label': 'Jina Reader（获取网页正文）',
      'jina.keyGuide': '无需密钥即可使用（每分钟最多 20 次）。设置密钥可提高上限。要获取的 URL 会发送给 Jina。'
    }
  }
);
