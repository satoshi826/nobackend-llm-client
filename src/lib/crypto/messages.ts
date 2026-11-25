// Texts of lib/crypto (errors)
import { defineMessages } from '../i18n';

export const t = defineMessages(
  {
    'passphrase.tooShort': 'パスフレーズは {min} 文字以上にしてください。',
    'passphrase.wrong': 'パスフレーズが違います。入力し直してください。',
    'passphrase.unsupported': '対応していない暗号化形式のため開けませんでした。アプリを最新にしてから試してください。',
    'dataKey.invalid': 'データ鍵の形式が正しくないため読み込めませんでした。'
  },
  {
    en: {
      'passphrase.tooShort': 'Use a passphrase of at least {min} characters.',
      'passphrase.wrong': 'Wrong passphrase. Enter it again.',
      'passphrase.unsupported': 'Could not open this because the encryption format is not supported. Update the app and try again.',
      'dataKey.invalid': 'Could not load the data key because its format is invalid.'
    },
    zh: {
      'passphrase.tooShort': '口令至少需要 {min} 个字符。',
      'passphrase.wrong': '口令不正确。请重新输入。',
      'passphrase.unsupported': '加密格式不受支持，无法打开。请将应用更新到最新版本后再试。',
      'dataKey.invalid': '数据密钥格式不正确，无法加载。'
    }
  }
);
