// Texts of lib/chat the user sees (errors). Prompts are in English where they are built
import { defineMessages } from '../i18n';

export const t = defineMessages(
  {
    'events.parseError': '引数を解析できませんでした: {error}',
    'run.stopped': '停止しました。',
    'run.unknownTool': 'ツール「{name}」は使えません。',
    'run.repeated': '同じ呼び出しが繰り返されたため中止しました。',
    'run.forbidden': '設定でこのツールは禁止されています。',
    'run.noApprovalUi': '承認できる画面がありません。',
    'title.new': '新しいチャット',
    'summary.empty': '要約が空でした。別のモデルで試してください。'
  },
  {
    en: {
      'events.parseError': 'Could not parse the arguments: {error}',
      'run.stopped': 'Stopped.',
      'run.unknownTool': 'The tool "{name}" is not available.',
      'run.repeated': 'Stopped because the same call was repeated.',
      'run.forbidden': 'This tool is blocked in settings.',
      'run.noApprovalUi': 'There is no screen to approve this on.',
      'title.new': 'New chat',
      'summary.empty': 'The summary was empty. Try another model.'
    },
    zh: {
      'events.parseError': '无法解析参数：{error}',
      'run.stopped': '已停止。',
      'run.unknownTool': '工具“{name}”不可用。',
      'run.repeated': '由于重复了相同的调用，已中止。',
      'run.forbidden': '此工具已在设置中被禁止。',
      'run.noApprovalUi': '没有可以进行批准的界面。',
      'title.new': '新对话',
      'summary.empty': '摘要为空。请换一个模型再试。'
    }
  }
);
