// Text shared by image and video mode (Japanese is the reference; see docs/writing.md). Each kind's own text is in
// image/messages.ts and video/messages.ts
import { defineMessages } from '../../lib/i18n';

export const t = defineMessages(
  {
    'mode.generate': '生成',
    'model.loading': 'モデルを読み込んでいます',
    'model.failed': 'モデルの一覧を取得できませんでした: {error}',
    'model.retry': '再試行',
    'model.default': '既定',
    'model.relayed': '外部中継',
    'setKey': 'キーを設定',
    'cost.estimate': '約 {cost}',
    'cost.unknown': '費用不明',
    'working.elapsed': '{n} 秒'
  },
  {
    en: {
      'mode.generate': 'Generate',
      'model.loading': 'Loading models',
      'model.failed': "Couldn't load the model list: {error}",
      'model.retry': 'Retry',
      'model.default': 'Default',
      'model.relayed': 'relayed',
      'setKey': 'Set key',
      'cost.estimate': '~{cost}',
      'cost.unknown': 'cost unknown',
      'working.elapsed': '{n}s'
    },
    zh: {
      'mode.generate': '生成',
      'model.loading': '正在加载模型',
      'model.failed': '无法获取模型列表：{error}',
      'model.retry': '重试',
      'model.default': '默认',
      'model.relayed': '外部中转',
      'setKey': '设置密钥',
      'cost.estimate': '约 {cost}',
      'cost.unknown': '费用未知',
      'working.elapsed': '{n} 秒'
    }
  }
);
