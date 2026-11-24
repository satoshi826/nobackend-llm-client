# nobackend-llm-client

> Bring your own API key. No backend — runs entirely in your browser.

サーバーを持たない、ログを残さない LLM チャットクライアント。
ローカル LLM を動かすほどではないが、SaaS に会話を預けたくない人のための、ブラウザだけで動くチャットです。

- **サーバーなし**: 静的ファイルだけ。会話はブラウザから LLM の API（Venice.ai / OpenRouter）へ直接送られます。
- **データは手元だけ**: 会話・設定は IndexedDB に保存。アカウント登録・解析ツール・外部スクリプトなし。
- **キーを盗まれにくく**: API キーはキー保管ページ（キー金庫）だけが持ち、アプリ本体には渡りません。厳格な CSP + Trusted Types。キーは決められたホスト宛てにしか付けず、バックアップにも含めません。
- **プライバシー既定値**: Venice がホストする `private` モデルだけを既定で表示。保存しない「一時チャット」あり。

設計の詳細は [docs/design.md](docs/design.md) を参照。

## できること

- Venice / OpenRouter（データ収集する提供元を既定で除外）。モデル一覧（private 優先・価格・能力表示）
- ストリーミング、思考の表示、Markdown・コードハイライト
- 会話の保存・全文検索・ピン留め・名前変更・削除、一時チャット
- 再生成・編集・別のモデルで再生成と、版の切り替え（会話ツリー）
- システムプロンプトと保存済みプロンプト
- Web 検索: Venice 内蔵、またはツール（Tavily で検索・Jina Reader で本文取得。実行前に承認）
- 会話の圧縮（手動・自動）、プロンプトキャッシュ、文脈長の安全装置
- API キーのパスフレーズ暗号化、Venice 残高の表示と急減の警告
- JSON バックアップと読み込み、全データ削除、PWA、ダークモード、モバイル表示

## 使い方（開発）

```bash
npm install
npm test            # 単体テスト（Vitest）
npm run dev         # http://localhost:5173
```

### 実際の API を使わずに試す（モックサーバー）

```bash
npm run mock        # Venice / Tavily / Jina 互換のモック（キーは mock-key / tvly-mock）
VITE_VENICE_BASE_URL=http://localhost:8787/api/v1 VITE_TAVILY_BASE_URL=http://localhost:8787/tavily VITE_JINA_BASE_URL=http://localhost:8787/jina npm run dev
```

モックはメッセージ中のキーワードで挙動が変わります: `思考` / `think` / `コード` / `長文` / `エラー` / `残高` / `画像` / `xss` / `盗用`、ツール方式の Web 検索では `検索` / `読んで`。

### 本番相当のヘッダ（CSP）で確認する

```bash
npm run build
node scripts/serve-with-headers.mjs dist 4173     # dist/_headers を適用して配信
```

## デプロイ（Cloudflare Pages など）

`npm run build` の `dist/` をそのまま配信します。`dist/_headers` に CSP などのセキュリティヘッダが入っています（ビルド時に `csp.config.ts` から生成）。
自分でデプロイして使うのが最も安全です（配布元を信頼する必要がなくなります）。

## API キーの保管（キー金庫）

API キーの入力・保存・暗号化と、キーを付けた送信は、常に **キー金庫のページ**（`vault/`）が行います。アプリ本体は「どのキーを付けて送るか」を金庫に頼むだけで、キーそのものを持ちません。金庫は、ビルド時に決まったホスト（api.venice.ai / openrouter.ai / api.tavily.com / r.jina.ai）宛てのときだけキーを付けます。

金庫の置き場所は 2 通りで、コードは同じです。

| 置き場所 | 手間 | 安全性 |
|---|---|---|
| **同じオリジン**（既定。`dist/vault/`） | デプロイ 1 つ | キーは本体の画面には渡らないが、本体で XSS が起きた場合の隔離はない |
| **別オリジン**（推奨） | デプロイ 2 つ | 本体で XSS が起きてもキーは読めない。被害は「タブを開いている間の不正利用」まで（利用上限付きキーなら金額にも上限） |

別オリジンにする手順（例: 本体 `https://app.example.com`、金庫 `https://vault.example.com`）:

```bash
# 金庫（別サイトとしてデプロイ。dist-vault/ をそのまま配信）
VITE_APP_ORIGIN=https://app.example.com npx vite build --config vite.vault.config.ts
# 本体（金庫の URL を指定してビルド。CSP の frame-src に金庫が自動で追加される）
VITE_VAULT_URL=https://vault.example.com/index.html npm run build
```

Cloudflare Pages なら 2 つのプロジェクトに分けます。`*.pages.dev` 同士は別サイト扱いのため、ブラウザによっては金庫の保存領域が制限されることがあります。毎日使うなら、独自ドメインで `app.example.com` と `vault.example.com` のように同じドメインの下に置くのがおすすめです。

## API キーについて

Venice の管理画面で **INFERENCE タイプ**のキーを作り、**1 日の利用上限（consumption limit）と有効期限**を設定してください。
`modelPrivacy: PRIVATE_ONLY` にすると外部中継モデルを使えなくなり、より安全です。OpenRouter・Tavily でも利用上限を設定してください。
