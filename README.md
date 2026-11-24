# nobackend-llm-client

> Bring your own API key. No backend — runs entirely in your browser.

サーバーを持たない、ログを残さない LLM チャットクライアント。
ローカル LLM を動かすほどではないが、SaaS に会話を預けたくない人のための、ブラウザだけで動くチャットです。

- **サーバーなし**: 静的ファイルだけ。会話はブラウザから LLM の提供元の API へ直接送られます（Venice.ai・OpenRouter・Anthropic・Google Gemini・DeepSeek・Groq。どれも対等な接続先で、最初に使うものを選びます。Ollama などの OpenAI 互換 API もビルド時に足せます）。
- **データは手元だけ**: 会話・設定は IndexedDB に保存。アカウント登録・解析ツール・外部スクリプトなし。
- **キーを盗まれにくく**: API キーはキー保管ページ（キー金庫）だけが持ち、アプリ本体には渡りません。厳格な CSP + Trusted Types。キーは決められたホスト宛てにしか付けず、バックアップにも含めません。
- **プライバシー既定値**: モデル一覧は「プロンプトを保存しない」と明示された `private` モデルを先頭に並べ、外部事業者へ中継するモデルには警告を表示（`private` だけに絞り込みも可）。保存しない「一時チャット」あり。

設計の詳細は [docs/design.md](docs/design.md) を参照。

## できること

- 接続先: Venice / OpenRouter（データ収集する提供元を既定で除外）/ Anthropic（Messages API）/ Gemini / DeepSeek / Groq、ビルド時に足す OpenAI 互換の接続先。モデル一覧（並び替え・絞り込み・価格・能力表示）
- ストリーミング、思考の表示、Markdown・コードハイライト
- 会話の保存・全文検索・ピン留め・名前変更・削除、一時チャット
- 再生成・編集・別のモデルで再生成と、版の切り替え（会話ツリー）
- システムプロンプトと保存済みプロンプト
- スキル（SKILL.md 互換の手順書。モデルが必要なときだけ読み込む／入力欄から「/名前」で指定／会話の中で「スキルにして」と頼むと、確認のうえで作成・手直し）
- Web 検索: 接続先の内蔵検索（Venice）、またはツール（Tavily で検索・Jina Reader で本文取得。実行前に承認）
- 会話の圧縮（手動・自動）、プロンプトキャッシュ、文脈長の安全装置
- パスフレーズを設定すると API キーをすべて自動で暗号化、キーの一括削除。残高を返す接続先（Venice）の残高表示と急減の警告
- 使用量と費用の集計（日・接続先・モデルごと。記録はこの端末の中だけ）
- JSON バックアップと読み込み、全データ削除、PWA、ダークモード、モバイル表示

## 使い方（開発）

```bash
npm install
npm test            # 単体テスト（Vitest）
npm run dev         # http://localhost:5173
```

### 実際の API を使わずに試す（モックサーバー）

```bash
npm run mock        # Venice / Anthropic / Tavily / Jina 互換のモック（キーは mock-key / mock-ant / tvly-mock）
VITE_VENICE_BASE_URL=http://localhost:8787/api/v1 VITE_ANTHROPIC_BASE_URL=http://localhost:8787/anthropic/v1 VITE_TAVILY_BASE_URL=http://localhost:8787/tavily VITE_JINA_BASE_URL=http://localhost:8787/jina npm run dev
```

モックはメッセージ中のキーワードで挙動が変わります: `思考` / `think` / `コード` / `長文` / `エラー` / `残高` / `画像` / `xss` / `盗用`、ツール方式の Web 検索では `検索` / `読んで`、スキルがあるときは `スキル`（一覧の先頭を読み込む）、skill-creator を使った会話では `作って` / `直して`（save_skill）。

### 本番相当のヘッダ（CSP）で確認する

```bash
npm run build
node scripts/serve-with-headers.mjs dist 4173     # dist/_headers を適用して配信
```

## デプロイ（Cloudflare Pages）

`npm run build` の `dist/` をそのまま配信します。`dist/_headers` に CSP などのセキュリティヘッダが入っています（ビルド時に `csp.config.ts` から生成）。キー金庫は `dist/vault/` として同じプロジェクトに入ります。
自分でデプロイして使うのが最も安全です（配布元を信頼する必要がなくなります）。

### GitHub 連携で自動デプロイ（金庫は同じオリジン）

1. このリポジトリを GitHub にプッシュする。
2. Cloudflare ダッシュボード → Workers & Pages → Create → **Pages** → Connect to Git でリポジトリを選ぶ。
3. ビルド設定:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - 環境変数: なし（`.node-version` で Node 22 を使う）。**`VITE_*_BASE_URL` は設定しない**（モック用）
4. デプロイ後、`https://<プロジェクト名>.pages.dev` で開く。以後は main ブランチへのプッシュで自動デプロイ、それ以外のブランチはプレビュー URL になる（オリジンが違うので、データは本番と別）。

**Cloudflare 側でオフにするもの**（スクリプトを差し込むため、CSP で止まるうえ「外部スクリプトなし」の方針に反する）: Web Analytics（Pages の Metrics）、Rocket Loader、Email Address Obfuscation、Zaraz。独自ドメインを使わない `*.pages.dev` では、ゾーンの設定（Rocket Loader など）は関係ありません。

**確認**:

```bash
curl -sI https://<プロジェクト名>.pages.dev/ | grep -i content-security-policy
curl -sI https://<プロジェクト名>.pages.dev/vault/index.html | grep -i content-security-policy   # 金庫用（connect-src に LLM の API）
```

ブラウザの開発者ツールのコンソールに CSP 違反が出ていないこと、利用上限付きのキーでキーの保存 → チャット → パスフレーズの設定・解錠 → すべてのキーを削除が通ることを確かめます。

**データはオリジンごと**: 会話とキーは、開いた URL（オリジン）ごとに別々に保存されます。お試し用（localhost）から本番に移る、`pages.dev` から独自ドメインに移る、などのときは、先に「プライバシーとデータ」でバックアップを書き出し、移った先で読み込んでください（キーは入れ直し）。

### ビルド時に接続先を足す（Ollama などの OpenAI 互換 API）

`VITE_CUSTOM_PROVIDERS` に JSON 配列で指定すると、接続先の一覧・キー金庫の送り先・CSP に自動で入ります（Cloudflare なら環境変数に設定）。

```bash
VITE_CUSTOM_PROVIDERS='[{"id":"ollama","label":"Ollama","baseUrl":"http://localhost:11434/v1","keyOptional":true}]' npm run build
```

- `id`: 半角の小文字・数字・ハイフン / `baseUrl`: https（ローカルなら http も可）/ `keyOptional`: キーなしで使う / `publicModels`: モデル一覧をキーなしで取れる
- 相手が CORS を許可している必要があります。Ollama なら `OLLAMA_ORIGINS=https://<このサイト>` を付けて起動します。

## API キーの保管（キー金庫）

API キーの入力・保存・暗号化と、キーを付けた送信は、常に **キー金庫のページ**（`vault/`）が行います。アプリ本体は「どのキーを付けて送るか」を金庫に頼むだけで、キーそのものを持ちません。金庫は、ビルド時に決まったホスト（各接続先の API・api.tavily.com・r.jina.ai）宛てのときだけ、接続先ごとのヘッダ（多くは `Authorization: Bearer`、Anthropic は `x-api-key`）でキーを付けます。

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

### 保存のしかた

保存方法を選ぶ必要はありません。キー金庫にパスフレーズがなければキーはそのまま保存し、パスフレーズを設定するとすべてのキーを暗号化します（後から設定しても、保存済みのキーを暗号化し直します）。解錠は起動時に 1 回で、すべてのキーが使えるようになります。パスフレーズを忘れた場合は元に戻せないので、「すべてのキーを削除」して入れ直してください。パスフレーズの設定・変更・解除は設定の「接続とキー」、キーの一括削除は同じ場所と「プライバシーとデータ」にあります。

## API キーについて

どの接続先でも、**利用上限のあるキー**を使ってください。キーが万一漏れても、被害額が上限で止まります。

- **Venice**: 管理画面で **INFERENCE タイプ**のキーを作り、1 日の利用上限（consumption limit）と有効期限を設定。`modelPrivacy: PRIVATE_ONLY` にすると外部中継モデルを使えなくなり、より安全です。
- **OpenRouter**: キーにクレジットの上限（credit limit）を設定。
- **Anthropic**: Console の Limits でワークスペースの利用上限（spend limit）を設定。
- **Gemini**: 無料枠のキーでは、送った内容が Google のサービス改善に使われることがあります（有料枠では使われません）。
- **DeepSeek**: プリペイド式なので、チャージした額が上限。データは中国の事業者のサーバーで処理されます。
- **Groq**: 無料枠には回数・トークン数の上限あり。有料にする場合は利用上限を設定。
- **Tavily**（ツール方式の Web 検索）: 利用上限を設定。

## 接続先を足すには

組み込みの接続先は `src/lib/providers/presets/` のプリセットとして書き、宛先は `src/lib/providers/endpoints.ts` に足します（CSP とキー金庫の許可先はここから作られます）。キーの確認方法・モデル一覧の読み方に加えて、接続先だけの機能（内蔵の Web 検索、残高を返す応答ヘッダ、固有の設定、画面の説明文）もプリセットが宣言し、アプリ本体には接続先ごとの分岐を置きません。キーを付けてよいホストと CSP の通信先はビルド時にプリセットから決まるため、画面から任意の URL を足すことはできません（キーの送り先を固定するための制約です）。
