// Texts of lib/tools: external services used by tools, and what a call's arguments got wrong (check.ts)
import { defineMessages } from '../i18n';

export const t = defineMessages(
  {
    'tavily.label': 'Tavily（Web 検索）',
    'tavily.keyGuide': 'Tavily（tavily.com）でキーを作成してください。無料枠は月 1,000 クレジット（検索 1 回 = 1 クレジット）です。検索語は Tavily に送られます。',
    'check.unknown': 'このツールに引数「{name}」はありません。{tool} の引数: {params}。',
    'check.missing': '必須の引数「{name}」がありません。',
    'check.notObject': '引数がオブジェクトではありません。{tool} の引数: {params}。',
    'check.requiredName': '{name}（必須）',
    'check.none': 'なし',
    'check.string': '引数「{name}」は文字列にしてください。',
    'check.number': '引数「{name}」は数値にしてください。',
    'check.integer': '引数「{name}」は整数にしてください。',
    'check.boolean': '引数「{name}」は true か false にしてください。',
    'check.array': '引数「{name}」は配列にしてください。',
    'check.object': '引数「{name}」はオブジェクトにしてください。',
    'check.enum': '引数「{name}」は次のどれかにしてください: {values}。',
  },
  {
    en: {
      'tavily.label': 'Tavily (web search)',
      'tavily.keyGuide': 'Create a key at Tavily (tavily.com). The free tier gives 1,000 credits a month (1 search = 1 credit). Search terms are sent to Tavily.',
      'check.unknown': 'Unknown parameter "{name}". {tool} takes: {params}.',
      'check.missing': 'Missing required parameter "{name}".',
      'check.notObject': 'The arguments must be an object. {tool} takes: {params}.',
      'check.requiredName': '{name} (required)',
      'check.none': 'nothing',
      'check.string': 'Parameter "{name}" must be a string.',
      'check.number': 'Parameter "{name}" must be a number.',
      'check.integer': 'Parameter "{name}" must be an integer.',
      'check.boolean': 'Parameter "{name}" must be true or false.',
      'check.array': 'Parameter "{name}" must be an array.',
      'check.object': 'Parameter "{name}" must be an object.',
      'check.enum': 'Parameter "{name}" must be one of: {values}.',
    },
    zh: {
      'tavily.label': 'Tavily（网页搜索）',
      'tavily.keyGuide': '请在 Tavily（tavily.com）创建密钥。免费额度为每月 1,000 积分（每次搜索 = 1 积分）。搜索词会发送给 Tavily。',
      'check.unknown': '未知参数“{name}”。{tool} 接受的参数：{params}。',
      'check.missing': '缺少必需参数“{name}”。',
      'check.notObject': '参数必须是对象。{tool} 接受的参数：{params}。',
      'check.requiredName': '{name}（必需）',
      'check.none': '无',
      'check.string': '参数“{name}”必须是字符串。',
      'check.number': '参数“{name}”必须是数字。',
      'check.integer': '参数“{name}”必须是整数。',
      'check.boolean': '参数“{name}”必须是 true 或 false。',
      'check.array': '参数“{name}”必须是数组。',
      'check.object': '参数“{name}”必须是对象。',
      'check.enum': '参数“{name}”必须是以下之一：{values}。',
    }
  }
);
