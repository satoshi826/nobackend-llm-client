// Texts of the sandbox feature (the run_javascript tool)
import { defineMessages } from '../../lib/i18n';

export const t = defineMessages(
  {
    'tool.label': 'JavaScript の実行',
    'tool.noCode': '実行するコード（code）が空です。',
    'tool.codeField': 'コード',
    'tool.approvalNote': '隔離された環境で実行します。ネットへの接続や、このアプリ・ファイルへのアクセスはできません。',
    'tool.failed': 'エラー',
    'tool.output': '出力'
  },
  {
    en: {
      'tool.label': 'Run JavaScript',
      'tool.noCode': 'The code to run is empty.',
      'tool.codeField': 'Code',
      'tool.approvalNote': 'Runs in an isolated space: no network, and no access to this app or your files.',
      'tool.failed': 'Error',
      'tool.output': 'Output'
    },
    zh: {
      'tool.label': '运行 JavaScript',
      'tool.noCode': '要运行的代码（code）为空。',
      'tool.codeField': '代码',
      'tool.approvalNote': '在隔离的环境中运行：无法连接网络，也无法访问本应用或你的文件。',
      'tool.failed': '错误',
      'tool.output': '输出'
    }
  }
);
