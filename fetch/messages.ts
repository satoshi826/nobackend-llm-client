// Texts of the fetch page. The language comes from the lang URL parameter (main.ts).
import { defineMessages } from '../src/lib/i18n';

export const t = defineMessages(
  {
    title: 'Web からファイルを取得しますか？',
    from: '取得先',
    noteDirect: 'このページから {host} に直接アクセスします。アドレスに含まれる内容は {host} に送られます。',
    noteRelay: '{host} が直接の取得を許していないときは、中継サーバー {relay} を通します（アドレスは中継サーバーにも送られます）。',
    limit: '{max} MB までのファイルを取り込めます。',
    fetch: '取得',
    cancel: 'キャンセル',
    close: '閉じる',
    progress: '取得しています（{size}）',
    badUrl: 'https で始まるアドレスだけを取得できます。',
    blocked: '取得できませんでした。{host} がブラウザからの取得を許していないか、ネットワークに接続できません。',
    blockedRelay: '取得できませんでした。中継サーバーを通しても {host} に接続できません。',
    status: '取得できませんでした（{host} の応答: {status}）。',
    tooBig: 'ファイルが大きすぎます（上限 {max} MB）。',
    embedOnly: 'このページはアプリに埋め込まれて使われます。直接開いても操作できません。'
  },
  {
    en: {
      title: 'Fetch a file from the web?',
      from: 'From',
      noteDirect: 'This page connects to {host} directly. Whatever the address contains is sent to {host}.',
      noteRelay: 'If {host} does not allow fetching directly, the relay server {relay} is used (the address is sent to the relay too).',
      limit: 'Files up to {max} MB can be brought in.',
      fetch: 'Fetch',
      cancel: 'Cancel',
      close: 'Close',
      progress: 'Fetching ({size})',
      badUrl: 'Only addresses starting with https can be fetched.',
      blocked: 'Couldn’t fetch it. {host} doesn’t allow fetching from a browser, or the network can’t be reached.',
      blockedRelay: 'Couldn’t fetch it. {host} can’t be reached through the relay server either.',
      status: 'Couldn’t fetch it ({host} answered {status}).',
      tooBig: 'The file is too large (up to {max} MB).',
      embedOnly: 'This page is used inside the app. Opening it directly does nothing.'
    },
    zh: {
      title: '要从网络获取文件吗？',
      from: '来源',
      noteDirect: '此页面将直接访问 {host}。地址中包含的内容会发送给 {host}。',
      noteRelay: '如果 {host} 不允许直接获取，将通过中转服务器 {relay} 获取（地址也会发送给中转服务器）。',
      limit: '可导入最大 {max} MB 的文件。',
      fetch: '获取',
      cancel: '取消',
      close: '关闭',
      progress: '正在获取（{size}）',
      badUrl: '只能获取以 https 开头的地址。',
      blocked: '无法获取。{host} 不允许从浏览器获取，或无法连接网络。',
      blockedRelay: '无法获取。通过中转服务器也无法连接 {host}。',
      status: '无法获取（{host} 的响应：{status}）。',
      tooBig: '文件太大（上限 {max} MB）。',
      embedOnly: '此页面在应用内使用。直接打开无法操作。'
    }
  }
);
