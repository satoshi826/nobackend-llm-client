// Texts of lib/markdown (labels inside rendered messages)
import { defineMessages } from '../i18n';

export const t = defineMessages(
  {
    'image.alt': '画像',
    'image.blocked': '[画像: {label}]',
    'image.externalTitle': '外部画像は自動で読み込みません',
    'code.copy': 'コピー'
  },
  {
    en: {
      'image.alt': 'Image',
      'image.blocked': '[Image: {label}]',
      'image.externalTitle': 'External images are not loaded automatically',
      'code.copy': 'Copy'
    },
    zh: {
      'image.alt': '图像',
      'image.blocked': '[图像：{label}]',
      'image.externalTitle': '外部图像不会自动加载',
      'code.copy': '复制'
    }
  }
);
