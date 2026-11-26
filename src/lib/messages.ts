// Texts of the files directly under lib/ (model list sorting and filters)
import { defineMessages } from './i18n';

export const t = defineMessages(
  {
    'sort.recommended': 'おすすめ順',
    'sort.name': '名前順',
    'sort.price': '安い順',
    'sort.context': 'コンテキストが長い順',
    'filter.reasoning': '思考',
    'filter.vision': '画像',
    'filter.webSearch': '検索',
    'filter.free': '無料'
  },
  {
    en: {
      'sort.recommended': 'Recommended',
      'sort.name': 'Name',
      'sort.price': 'Cheapest',
      'sort.context': 'Longest context',
      'filter.reasoning': 'Reasoning',
      'filter.vision': 'Image',
      'filter.webSearch': 'Search',
      'filter.free': 'Free'
    },
    zh: {
      'sort.recommended': '推荐',
      'sort.name': '名称',
      'sort.price': '价格最低',
      'sort.context': '上下文最长',
      'filter.reasoning': '思考',
      'filter.vision': '图像',
      'filter.webSearch': '搜索',
      'filter.free': '免费'
    }
  }
);
