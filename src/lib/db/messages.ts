// Texts of lib/db (errors)
import { defineMessages } from '../i18n';

export const t = defineMessages(
  {
    'export.notBackup': 'このアプリのバックアップファイルではありません。このアプリで書き出したファイルを選んでください。',
    'export.tooNew': '新しい版のアプリで書き出されたファイルのため読み込めません。アプリを読み込み直して最新にしてから試してください。',
    'export.badFormat': 'ファイルの形式が正しくないため読み込めません。ファイルが壊れていないか確認してください。',
    'images.noData': '画像のデータが見つかりませんでした。',
    'sealed.locked': 'データがロックされています。パスフレーズで解錠してください。'
  },
  {
    en: {
      'export.notBackup': 'This is not a backup file from this app. Choose a file exported from this app.',
      'export.tooNew': 'This file was exported by a newer version of the app and cannot be imported. Reload the app to update it, then try again.',
      'export.badFormat': 'The file format is invalid, so it cannot be imported. Check that the file is not damaged.',
      'images.noData': 'The image data was not found.',
      'sealed.locked': 'Your data is locked. Unlock it with your passphrase.'
    },
    zh: {
      'export.notBackup': '这不是本应用的备份文件。请选择从本应用导出的文件。',
      'export.tooNew': '此文件由更新版本的应用导出，无法导入。请重新加载应用以更新到最新版本后再试。',
      'export.badFormat': '文件格式不正确，无法导入。请检查文件是否已损坏。',
      'images.noData': '找不到图像数据。',
      'sealed.locked': '数据已锁定。请用口令解锁。'
    }
  }
);
