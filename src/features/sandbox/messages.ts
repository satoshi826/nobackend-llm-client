// Texts of the sandbox feature (the run_javascript tool)
import { defineMessages } from '../../lib/i18n';

export const t = defineMessages(
  {
    'tool.label': 'JavaScript の実行',
    'tool.noCode': '実行するコード（code）が空です。',
    'tool.codeField': 'コード',
    'tool.approvalNote': '隔離された環境で実行します。ネットへの接続や、このアプリ・ファイルへのアクセスはできません。',
    'tool.failed': 'エラー',
    'tool.output': '出力',
    'settings.title': 'コードの実行（サンドボックス）',
    'settings.desc': 'HTML の表示と JavaScript の実行は、隔離された環境で行います。ネットへの接続や、このアプリのデータ・ファイルへのアクセスはできません。',
    'settings.tool': 'モデルによる JavaScript の実行',
    'settings.runButtons': 'コードブロックに「実行」ボタンを表示する',
    'settings.runButtonsDesc': 'html・svg・js のコードを、その場で表示・実行できます。'
  },
  {
    en: {
      'tool.label': 'Run JavaScript',
      'tool.noCode': 'The code to run is empty.',
      'tool.codeField': 'Code',
      'tool.approvalNote': 'Runs in an isolated space: no network, and no access to this app or your files.',
      'tool.failed': 'Error',
      'tool.output': 'Output',
      'settings.title': 'Running code (sandbox)',
      'settings.desc': 'HTML is shown and JavaScript runs in an isolated space, with no network and no access to this app’s data or your files.',
      'settings.tool': 'Let models run JavaScript',
      'settings.runButtons': 'Show “Run” on code blocks',
      'settings.runButtonsDesc': 'Show or run html, svg and js code right where it is.'
    },
    zh: {
      'tool.label': '运行 JavaScript',
      'tool.noCode': '要运行的代码（code）为空。',
      'tool.codeField': '代码',
      'tool.approvalNote': '在隔离的环境中运行：无法连接网络，也无法访问本应用或你的文件。',
      'tool.failed': '错误',
      'tool.output': '输出',
      'settings.title': '运行代码（沙箱）',
      'settings.desc': 'HTML 的显示和 JavaScript 的运行都在隔离的环境中进行，无法连接网络，也无法访问本应用的数据或你的文件。',
      'settings.tool': '允许模型运行 JavaScript',
      'settings.runButtons': '在代码块上显示“运行”按钮',
      'settings.runButtonsDesc': '可以直接显示或运行 html、svg 和 js 代码。'
    }
  }
);
