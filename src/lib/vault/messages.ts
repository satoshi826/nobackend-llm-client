// Texts of lib/vault (the app side of the key vault: errors)
import { defineMessages } from '../i18n';

export const t = defineMessages(
  {
    'connectFailed': 'キー金庫に接続できませんでした。ページを読み込み直してください。',
    'vaultFailed': 'キー金庫での処理に失敗しました。',
    'methodNotAllowed': '許可されていないメソッドです。',
    'bodyMustBeString': '本文は文字列のみ送れます。'
  },
  {
    en: {
      'connectFailed': 'Could not connect to the key vault. Reload the page.',
      'vaultFailed': 'The key vault could not complete the operation.',
      'methodNotAllowed': 'This method is not allowed.',
      'bodyMustBeString': 'Only a string body can be sent.'
    },
    zh: {
      'connectFailed': '无法连接到密钥保险库。请重新加载页面。',
      'vaultFailed': '密钥保险库处理失败。',
      'methodNotAllowed': '不允许使用此方法。',
      'bodyMustBeString': '请求正文只能是字符串。'
    }
  }
);
