# Writing UI text

Rules for every text the app shows, in all three languages. It states what is true now; the history is in git.

Languages: Japanese (reference), English, Simplified Chinese. The language setting is in Settings → 表示 (auto follows the browser). Text the model reads is in English whatever the UI language: tool descriptions, system notes, the framing of tool results, and the prompts of side jobs (summaries, reply suggestions, reading a page). Models follow English most reliably, and the request does not change with the language. A prompt whose answer the user reads asks for it in the conversation's language, and in the UI language when that is unclear. Text the user also sees is translated: the built-in skills, and a tool's error on its card (the model reads that error in English).

## Code

- Each folder keeps its messages next to its code in `messages.ts`, exporting `t` (several folders' messages in one file: import with an alias, e.g. `import { t as tf } from '../files/messages'`). TypeScript enforces the same keys in every language.
- Keys are camelCase and grouped by prefix (`filer.upload`, `filer.emptyHint`).
- Never build sentences from fragments: one template with `{placeholders}` per sentence (word order differs between languages).
- Never compute translated text at module load (`const LABEL = t('x')` at top level): call `t()` during render or inside functions, because the language can change at runtime.
- Numbers and dates go through the formatters (no bare `toLocaleString()`).
- Not translated: product and provider names (Venice, OpenRouter, Tavily, Jina Reader, Anthropic, ...), model ids, code, file extensions, `API`, `private` (Venice's mode name, shown as is).

## Japanese wording rules

- Buttons and menu items: short, no です/ます (保存, 削除, 書き出す, アップロード).
- Help text and descriptions: です・ます, one or two sentences.
- Dismissing: キャンセル in confirmations and forms; 閉じる for panels and dialogs that only show things; あとで only for postponing a suggestion. Not やめる.
- Errors: what happened, then what to do (「〜できませんでした。〜してください。」).
- A half-width space between Japanese and Latin letters or digits (API キー, 3 件).
- tok → トークン.

## English

Sentence case, short, verb first on buttons ("Export backup"), no "please", no exclamation marks, "you/your" for the user.

## Simplified Chinese

Natural mainland UI wording, full-width punctuation, no space between Chinese and Latin text except around product names when it reads better.

## Glossary

| 日本語 | English | 简体中文 |
|---|---|---|
| 会話 | conversation (chat in short labels) | 对话 |
| 新しいチャット | New chat | 新对话 |
| 一時チャット | Temporary chat | 临时对话 |
| 接続先 | provider | 服务商 |
| API キー | API key | API 密钥 |
| キー金庫 | key vault | 密钥保险库 |
| パスフレーズ | passphrase | 口令 |
| 解錠 / ロック | unlock / lock | 解锁 / 锁定 |
| モデル | model | 模型 |
| スキル | skill | 技能 |
| ファイル | file | 文件 |
| 添付 | attach / attachment | 附件 |
| 画像 / 画像モード | image / image mode | 图像 / 图像模式 |
| 動画 / 動画モード / 最初の場面 | video / video mode / first frame | 视频 / 视频模式 / 首帧 |
| Web 検索 | web search | 网页搜索 |
| ツール | tool | 工具 |
| 実行 / 常に許可 / 拒否 | Run / Always allow / Deny | 运行 / 始终允许 / 拒绝 |
| 圧縮 | compact | 压缩 |
| 返信候補 | reply suggestions | 回复建议 |
| 使用量 | usage | 用量 |
| バックアップ / 書き出す / 読み込む | backup / export / import | 备份 / 导出 / 导入 |
| 外部中継 | relayed | 外部中转 |
| 取得用ページ | fetch page | 获取页面 |
| 中継サーバー | relay server | 中转服务器 |
| 版 | version | 版本 |
| 作業フォルダ | working folder | 工作文件夹 |
| 指示（システムプロンプト） | instructions (system prompt) | 指令（系统提示词） |
| 思考 | reasoning | 思考 |
| コンテキスト長 | context length | 上下文长度 |
