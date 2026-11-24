# nobackend-llm-client

> Bring your own API key. No backend — runs entirely in your browser.

サーバーを持たない、ログを残さない LLM チャットクライアント。
ローカル LLM を動かすほどではないが、SaaS に会話を預けたくない人のための、ブラウザだけで動くチャットです。

- **サーバーなし**: 静的ファイルだけ。会話はブラウザから Venice.ai の API へ直接送られます。
- **データは手元だけ**: 会話・設定は IndexedDB に保存。アカウント登録・解析ツール・外部スクリプトなし。
- **キーを盗まれにくく**: 厳格な CSP + Trusted Types、キーは登録したホスト以外へ送らない、エクスポートに含めない。
- **プライバシー既定値**: Venice がホストする `private` モデルだけを既定で表示。保存しない「一時チャット」あり。

設計の詳細は [docs/design.md](docs/design.md) を参照。

## 使い方（開発）

```bash
npm install
npm test            # 単体テスト（Vitest）
npm run dev         # http://localhost:5173
```

### 実際の API を使わずに試す（モックサーバー）

```bash
npm run mock                                            # Venice 互換モック（キーは mock-key）
VITE_VENICE_BASE_URL=http://localhost:8787/api/v1 npm run dev
```

モックはメッセージ中のキーワードで挙動が変わります: `思考` / `think` / `コード` / `長文` / `エラー` / `残高` / `画像` / `xss`、Web 検索オンで出典付き。

### 本番相当の CSP で確認する

```bash
npm run build
node scripts/serve-with-headers.mjs dist 4173            # public/_headers を適用して配信
```

## デプロイ（Cloudflare Pages / Workers Static Assets）

`npm run build` の `dist/` をそのまま配信します。`dist/_headers` に CSP などのセキュリティヘッダが入っています。
自分でデプロイして使うのが最も安全です（配布元を信頼する必要がなくなります）。

## キー金庫（推奨・任意）

API キーを本体とは**別のオリジン**（別サイト）に置く仕組みです。本体で XSS が起きてもキーそのものは読み出せず、被害は「タブを開いている間の不正利用」までに抑えられます（利用上限付きキーなら金額にも上限がかかります）。

- キーの入力・暗号化・解錠は、金庫の画面（本体に埋め込まれた iframe）の中だけで行います。本体はキーを持ちません。
- 金庫は、ビルド時に決まったホスト（api.venice.ai / openrouter.ai）宛てのときだけキーを付けて送信します。本体から送信先を変えることはできません。

デプロイ手順（例: 本体 `https://app.example.com`、金庫 `https://vault.example.com`）:

```bash
# 金庫（別サイトとしてデプロイ。dist-vault/ をそのまま配信）
VITE_APP_ORIGIN=https://app.example.com npx vite build --config vite.vault.config.ts
# 本体（金庫の URL を指定してビルド。CSP の frame-src に金庫が自動で追加される）
VITE_VAULT_URL=https://vault.example.com/index.html npm run build
```

Cloudflare Pages なら 2 つのプロジェクト（例: `myapp.pages.dev` と `myapp-vault.pages.dev`）に分けて置きます。`VITE_VAULT_URL` を指定しない場合は、キーを本体に保存する従来の方式で動きます。

開発時:

```bash
VITE_APP_ORIGIN=http://localhost:5173 npx vite --config vite.vault.config.ts   # 金庫 :5175
VITE_VAULT_URL=http://localhost:5175/index.html npm run dev                      # 本体 :5173
```

## API キーについて

Venice の管理画面で **INFERENCE タイプ**のキーを作り、**1 日の利用上限（consumption limit）と有効期限**を設定してください。
`modelPrivacy: PRIVATE_ONLY` にすると外部中継モデルを使えなくなり、より安全です。

## 現状

できること: Venice 接続とキー検証 / モデル一覧（private 優先・価格・能力表示）/ ストリーミング / 思考の表示 / Markdown・コードハイライト / 会話の保存・検索・ピン留め・名前変更・削除 / 再生成・編集と版の切り替え（会話ツリー）/ システムプロンプトと保存済みプロンプト / Web 検索（Venice 内蔵）と出典 / 一時チャット / JSON バックアップと読み込み / 全データ削除 / ダークモード / モバイル表示

Phase 2 で追加: PWA（オフライン起動）/ Venice 残高の表示と急減警告 / API キーのパスフレーズ暗号化 / OpenRouter 対応（データ収集する提供元を既定で除外）

未対応: ファイル添付、画像生成、ツール実行（エージェント）、独自 Web 検索、モデル比較 ほか（docs/design.md のフェーズ計画を参照）
