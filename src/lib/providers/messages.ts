// Texts of lib/providers (errors, texts sent back to models, and the providers' descriptions and key guides)
// (i18n/index named explicitly: endpoints.ts is also loaded by the Vite config)
import { defineMessages } from '../i18n/index';

export const t = defineMessages(
  {
    // ---- Tool results sent back to the model ----
    'tool.denied': 'ユーザーがこのツールの実行を拒否しました。{reason}',
    'tool.failed': 'ツールの実行に失敗しました: {error}',

    // ---- Streaming ----
    'stream.stopped': '停止しました。',
    'stream.emptyBody': '応答の本文が空でした。もう一度試してください。',
    'stream.error': 'ストリームの途中でエラーが発生しました: {message}',
    'stream.unknownError': '不明なエラー',
    'stream.disconnected': '受信中に接続が切れました。もう一度試してください。',

    // ---- HTTP errors ----
    'error.proOnly': 'このモデルは有料プランでのみ利用できます。別のモデルを選んでください。',
    'error.auth': 'API キーが無効か、権限がありません。設定でキーを確認してください。',
    'error.balance': '残高が不足しています。接続先の管理画面で残高を確認してください。',
    'error.rateLimitAfter': 'レート制限に達しました。約 {seconds} 秒後に再試行してください。',
    'error.rateLimit': 'レート制限に達しました。しばらく待ってから再試行してください。',
    'error.notFound': 'モデルまたはエンドポイントが見つかりません。モデル一覧を更新してください。',
    'error.badRequest': 'リクエストが拒否されました（{status}）。{detail}',
    'error.server': '接続先でエラーが発生しました（{status}）。時間をおいて再試行してください。',
    'error.network': '接続できませんでした。ネットワークに問題があるか、接続先がブラウザからのアクセス（CORS）を許可していません。',
    'error.keyNeedsVault': 'キーを付ける通信はキー金庫を経由する必要があります。',

    // ---- VITE_CUSTOM_PROVIDERS (build-time configuration) ----
    'custom.notJson': 'VITE_CUSTOM_PROVIDERS を JSON として読めません。書式を確認してください。',
    'custom.notArray': 'VITE_CUSTOM_PROVIDERS は配列で指定してください。',
    'custom.badId': '{where}.id は半角の小文字・数字・ハイフンで指定してください。',
    'custom.duplicateId': '{where}.id「{id}」は使えません（重複）。別の id にしてください。',
    'custom.badUrl': '{where}.baseUrl が URL ではありません。',
    'custom.insecureUrl': '{where}.baseUrl は https（ローカルなら http）にしてください。',
    'custom.urlExtras': '{where}.baseUrl に認証情報やクエリは書けません。',

    // ---- Provider descriptions (presets) ----
    'cors.generic': 'ネットワーク接続、または拡張機能が {host} をブロックしていないか確認してください。',
    'cors.direct': '{name} は通常ブラウザから直接接続できます。ネットワーク接続、または拡張機能が {host} をブロックしていないか確認してください。',
    'cors.venice': 'Venice は通常ブラウザから直接接続できます。ネットワーク接続、または広告ブロッカー等の拡張機能が api.venice.ai をブロックしていないか確認してください。',

    'venice.tagline': 'プロンプトを保存しない private モデルと、制限の少ないモデル。内蔵の Web 検索と残高の確認つき。',
    'venice.keyGuide':
      'Venice の管理画面（Settings → API）で「INFERENCE」タイプのキーを作り、1 日の利用上限（consumption limit）と有効期限を設定してください。モデルを Venice ホストのものに限る「PRIVATE_ONLY」もおすすめです。キーが万一漏れても被害額が上限で止まります。',
    'venice.systemPrompt': 'Venice 既定のシステムプロンプトを付ける',
    'venice.systemPromptDesc': 'オフ（既定）なら、あなたが書いた指示だけがモデルに渡ります。',
    'venice.private': 'Venice がホストし、プロンプトを保存しないモデル',
    'venice.relayed': 'Venice が匿名化して Claude・Gemini などの外部事業者に中継するモデル。各社の保持ポリシーに従います。',
    'venice.relayedNote': '「外部中継」のモデルは、Venice が匿名化したうえで Claude・Gemini などの外部事業者に送ります。プロンプトの保持や検閲は各社の方針に従います。',
    'venice.searchProviders': 'Venice の検索提供元',
    'venice.searchProvidersWhat': 'Venice 内蔵の Web 検索をオンにしたときの検索語（Venice 経由）',
    'venice.thirdParties': '外部 AI 事業者',
    'venice.thirdPartiesWhat': 'Venice の「外部中継」のモデルを使ったときの会話（Venice が匿名化して中継）',

    'openrouter.tagline': '数百のモデルを 1 つのキーで。データを保存・学習に使う提供元は既定で経由しません。',
    'openrouter.keyGuide': 'OpenRouter の管理画面（Keys）でキーを作り、クレジットの上限（credit limit）を設定してください。キーが万一漏れても被害額が上限で止まります。',
    'openrouter.pickerNote': 'OpenRouter は複数の提供元に中継します。このアプリは既定で「データを保存・学習に使う提供元」を経由しない設定（data_collection: deny）で送信します。',
    'openrouter.destinationNote': '実際に処理する提供元へ中継されます（データ収集する提供元は既定で除外）',

    'anthropic.tagline': 'Anthropic の Claude を直接使う。',
    'anthropic.keyGuide':
      'Anthropic Console（console.anthropic.com）の API Keys でキーを作り、Limits でワークスペースの利用上限（spend limit）を設定してください。キーが万一漏れても被害額が上限で止まります。',

    'gemini.tagline': 'Google の Gemini。無料枠では、送った内容が Google のサービス改善に使われることがあります。',
    'gemini.keyGuide':
      'Google AI Studio（aistudio.google.com）でキーを作ってください。無料枠のキーでは、送った内容が Google のサービス改善に使われ、人が読むこともあります（有料枠では使われません）。有料にする場合は Google Cloud の請求設定で予算を設定してください。',
    'gemini.destinationNote': '無料枠のキーでは、送った内容が Google のサービス改善に使われることがあります',

    'deepseek.tagline': 'DeepSeek のモデル。安価。データは中国の事業者のサーバーで処理されます。',
    'deepseek.keyGuide': 'DeepSeek Platform（platform.deepseek.com）でキーを作ってください。プリペイド式なので、チャージした額が使える上限になります。',
    'deepseek.destinationNote': '中国の事業者（DeepSeek）のサーバーで処理されます',

    'groq.tagline': '高速な推論。Llama・Qwen・gpt-oss などのオープンなモデル。',
    'groq.keyGuide': 'GroqCloud（console.groq.com）でキーを作ってください。無料枠には回数とトークン数の上限があります。有料にする場合は利用上限を設定してください。',

    'custom.tagline': '{host} の OpenAI 互換 API（ビルド時に追加した接続先）',
    'custom.keyGuideOptional': 'キーなしでも使えます。キーが必要な場合だけ設定してください。',
    'custom.keyGuide': '{name} の管理画面でキーを作り、可能なら利用上限を設定してください。',
    'custom.corsHint': '{host} がこのサイトからの接続を許可しているか（CORS）確認してください。Ollama なら環境変数 OLLAMA_ORIGINS にこのサイトのオリジンを入れて起動します。',
    'custom.checkConnection': '{host} への接続を確認してください。'
  },
  {
    en: {
      'tool.denied': 'The user denied running this tool. {reason}',
      'tool.failed': 'The tool failed: {error}',

      'stream.stopped': 'Stopped.',
      'stream.emptyBody': 'The response body was empty. Try again.',
      'stream.error': 'An error occurred during the stream: {message}',
      'stream.unknownError': 'Unknown error',
      'stream.disconnected': 'The connection was lost while receiving. Try again.',

      'error.proOnly': 'This model is only available on a paid plan. Choose another model.',
      'error.auth': 'The API key is invalid or does not have permission. Check the key in settings.',
      'error.balance': "Your balance is too low. Check your balance in the provider's dashboard.",
      'error.rateLimitAfter': 'Rate limit reached. Try again in about {seconds} seconds.',
      'error.rateLimit': 'Rate limit reached. Wait a moment and try again.',
      'error.notFound': 'The model or endpoint was not found. Refresh the model list.',
      'error.badRequest': 'The request was rejected ({status}). {detail}',
      'error.server': 'The provider returned an error ({status}). Try again later.',
      'error.network': 'Could not connect. There may be a network problem, or the provider does not allow access from browsers (CORS).',
      'error.keyNeedsVault': 'Requests that carry a key must go through the key vault.',

      'custom.notJson': 'VITE_CUSTOM_PROVIDERS is not valid JSON. Check its syntax.',
      'custom.notArray': 'VITE_CUSTOM_PROVIDERS must be an array.',
      'custom.badId': '{where}.id must use only lowercase letters, digits and hyphens.',
      'custom.duplicateId': '{where}.id "{id}" cannot be used (duplicate). Use another id.',
      'custom.badUrl': '{where}.baseUrl is not a URL.',
      'custom.insecureUrl': '{where}.baseUrl must use https (http only for local hosts).',
      'custom.urlExtras': '{where}.baseUrl cannot contain credentials or a query.',

      'cors.generic': 'Check your network connection, and whether an extension is blocking {host}.',
      'cors.direct': '{name} normally accepts direct connections from browsers. Check your network connection, and whether an extension is blocking {host}.',
      'cors.venice': 'Venice normally accepts direct connections from browsers. Check your network connection, and whether an extension such as an ad blocker is blocking api.venice.ai.',

      'venice.tagline': 'Models that never store your prompts (private) and models with fewer restrictions. Built-in web search and balance check.',
      'venice.keyGuide':
        'In the Venice dashboard (Settings → API), create a key of type "INFERENCE" and set a daily consumption limit and an expiry date. "PRIVATE_ONLY", which limits the key to models Venice hosts, is also recommended. If the key ever leaks, the damage stops at the limit.',
      'venice.systemPrompt': "Add Venice's default system prompt",
      'venice.systemPromptDesc': 'When off (the default), only the instructions you write are passed to the model.',
      'venice.private': "Models hosted by Venice that don't store prompts",
      'venice.relayed': "Models that Venice anonymizes and relays to third parties such as Claude and Gemini. Each company's retention policy applies.",
      'venice.relayedNote': "Venice anonymizes requests to relayed models and sends them to third parties such as Claude and Gemini. Prompt retention and censorship follow each company's policy.",
      'venice.searchProviders': "Venice's search providers",
      'venice.searchProvidersWhat': "Search terms when Venice's built-in web search is on (via Venice)",
      'venice.thirdParties': 'Third-party AI companies',
      'venice.thirdPartiesWhat': "Conversations with Venice's relayed models (anonymized and relayed by Venice)",

      'openrouter.tagline': 'Hundreds of models with one key. By default, skips upstream providers that store or train on your data.',
      'openrouter.keyGuide': 'In the OpenRouter dashboard (Keys), create a key and set a credit limit. If the key ever leaks, the damage stops at the limit.',
      'openrouter.pickerNote': 'OpenRouter relays to multiple upstream providers. By default this app sends requests with a setting that avoids providers that store or train on data (data_collection: deny).',
      'openrouter.destinationNote': 'Relayed to the upstream provider that processes the request (providers that collect data are excluded by default)',

      'anthropic.tagline': "Use Anthropic's Claude directly.",
      'anthropic.keyGuide':
        'In the Anthropic Console (console.anthropic.com), create a key under API Keys and set a workspace spend limit under Limits. If the key ever leaks, the damage stops at the limit.',

      'gemini.tagline': "Google's Gemini. On the free tier, what you send may be used to improve Google's services.",
      'gemini.keyGuide':
        "Create a key in Google AI Studio (aistudio.google.com). With a free-tier key, what you send is used to improve Google's services and may be read by people (not on the paid tier). If you switch to paid, set a budget in Google Cloud billing.",
      'gemini.destinationNote': "With a free-tier key, what you send may be used to improve Google's services",

      'deepseek.tagline': "DeepSeek's models. Low cost. Data is processed on servers of a company in China.",
      'deepseek.keyGuide': 'Create a key on the DeepSeek Platform (platform.deepseek.com). It is prepaid, so the amount you top up is your spending limit.',
      'deepseek.destinationNote': 'Processed on servers of a company in China (DeepSeek)',

      'groq.tagline': 'Fast inference. Open models such as Llama, Qwen and gpt-oss.',
      'groq.keyGuide': 'Create a key in GroqCloud (console.groq.com). The free tier limits requests and tokens. If you switch to paid, set a spending limit.',

      'custom.tagline': 'OpenAI-compatible API at {host} (provider added at build time)',
      'custom.keyGuideOptional': 'Works without a key. Set one only if it is required.',
      'custom.keyGuide': 'Create a key in the {name} dashboard and set a spending limit if you can.',
      'custom.corsHint': "Check that {host} allows connections from this site (CORS). For Ollama, start it with this site's origin in the OLLAMA_ORIGINS environment variable.",
      'custom.checkConnection': 'Check the connection to {host}.'
    },
    zh: {
      'tool.denied': '用户拒绝运行此工具。{reason}',
      'tool.failed': '工具运行失败：{error}',

      'stream.stopped': '已停止。',
      'stream.emptyBody': '响应正文为空。请重试。',
      'stream.error': '流式传输过程中发生错误：{message}',
      'stream.unknownError': '未知错误',
      'stream.disconnected': '接收过程中连接中断。请重试。',

      'error.proOnly': '此模型仅限付费套餐使用。请选择其他模型。',
      'error.auth': 'API 密钥无效或没有权限。请在设置中检查密钥。',
      'error.balance': '余额不足。请在服务商的管理后台查看余额。',
      'error.rateLimitAfter': '已达到速率限制。请在约 {seconds} 秒后重试。',
      'error.rateLimit': '已达到速率限制。请稍候再试。',
      'error.notFound': '找不到模型或端点。请刷新模型列表。',
      'error.badRequest': '请求被拒绝（{status}）。{detail}',
      'error.server': '服务商出错（{status}）。请稍后重试。',
      'error.network': '无法连接。可能是网络有问题，或者服务商不允许从浏览器访问（CORS）。',
      'error.keyNeedsVault': '携带密钥的请求必须经过密钥保险库。',

      'custom.notJson': 'VITE_CUSTOM_PROVIDERS 不是有效的 JSON。请检查格式。',
      'custom.notArray': 'VITE_CUSTOM_PROVIDERS 必须是数组。',
      'custom.badId': '{where}.id 只能使用小写字母、数字和连字符。',
      'custom.duplicateId': '{where}.id“{id}”不可用（重复）。请换一个 id。',
      'custom.badUrl': '{where}.baseUrl 不是 URL。',
      'custom.insecureUrl': '{where}.baseUrl 必须使用 https（本地地址可用 http）。',
      'custom.urlExtras': '{where}.baseUrl 不能包含凭据或查询参数。',

      'cors.generic': '请检查网络连接，以及扩展程序是否屏蔽了 {host}。',
      'cors.direct': '{name} 通常可以从浏览器直接连接。请检查网络连接，以及扩展程序是否屏蔽了 {host}。',
      'cors.venice': 'Venice 通常可以从浏览器直接连接。请检查网络连接，以及广告拦截器等扩展程序是否屏蔽了 api.venice.ai。',

      'venice.tagline': '不保存提示词的 private 模型，以及限制较少的模型。内置网页搜索和余额查询。',
      'venice.keyGuide':
        '请在 Venice 管理后台（Settings → API）创建“INFERENCE”类型的密钥，并设置每日用量上限（consumption limit）和有效期。也推荐使用“PRIVATE_ONLY”，将模型限制为 Venice 托管的模型。即使密钥泄露，损失也会止于上限。',
      'venice.systemPrompt': '附加 Venice 默认的系统提示词',
      'venice.systemPromptDesc': '关闭时（默认），只有你写的指令会传给模型。',
      'venice.private': '由 Venice 托管、不保存提示词的模型',
      'venice.relayed': '由 Venice 匿名化后中转给 Claude、Gemini 等外部厂商的模型。遵循各厂商的数据保留政策。',
      'venice.relayedNote': '“外部中转”模型会由 Venice 匿名化后发送给 Claude、Gemini 等外部厂商。提示词的保留和审查遵循各厂商的政策。',
      'venice.searchProviders': 'Venice 的搜索提供方',
      'venice.searchProvidersWhat': '开启 Venice 内置网页搜索时的搜索词（经由 Venice）',
      'venice.thirdParties': '外部 AI 厂商',
      'venice.thirdPartiesWhat': '使用 Venice“外部中转”模型时的对话（由 Venice 匿名化后中转）',

      'openrouter.tagline': '一个密钥即可使用数百个模型。默认不经过会存储数据或用数据训练的提供方。',
      'openrouter.keyGuide': '请在 OpenRouter 管理后台（Keys）创建密钥，并设置额度上限（credit limit）。即使密钥泄露，损失也会止于上限。',
      'openrouter.pickerNote': 'OpenRouter 会中转给多个提供方。本应用默认以不经过“会存储数据或用数据训练的提供方”的设置（data_collection: deny）发送。',
      'openrouter.destinationNote': '会中转给实际处理请求的提供方（默认排除收集数据的提供方）',

      'anthropic.tagline': '直接使用 Anthropic 的 Claude。',
      'anthropic.keyGuide':
        '请在 Anthropic Console（console.anthropic.com）的 API Keys 中创建密钥，并在 Limits 中设置工作区的用量上限（spend limit）。即使密钥泄露，损失也会止于上限。',

      'gemini.tagline': 'Google 的 Gemini。使用免费额度时，发送的内容可能会被用于改进 Google 的服务。',
      'gemini.keyGuide':
        '请在 Google AI Studio（aistudio.google.com）创建密钥。使用免费额度的密钥时，发送的内容会被用于改进 Google 的服务，也可能被人工查看（付费额度不会）。如改为付费，请在 Google Cloud 的结算设置中设置预算。',
      'gemini.destinationNote': '使用免费额度的密钥时，发送的内容可能会被用于改进 Google 的服务',

      'deepseek.tagline': 'DeepSeek 的模型。价格低廉。数据在中国企业的服务器上处理。',
      'deepseek.keyGuide': '请在 DeepSeek Platform（platform.deepseek.com）创建密钥。采用预付费方式，充值金额即为可用上限。',
      'deepseek.destinationNote': '在中国企业（DeepSeek）的服务器上处理',

      'groq.tagline': '高速推理。提供 Llama、Qwen、gpt-oss 等开放模型。',
      'groq.keyGuide': '请在 GroqCloud（console.groq.com）创建密钥。免费额度对请求次数和 token 数有上限。如改为付费，请设置用量上限。',

      'custom.tagline': '{host} 的 OpenAI 兼容 API（构建时添加的服务商）',
      'custom.keyGuideOptional': '无需密钥即可使用。仅在需要时设置密钥。',
      'custom.keyGuide': '请在 {name} 的管理后台创建密钥，并尽量设置用量上限。',
      'custom.corsHint': '请确认 {host} 是否允许来自本站的连接（CORS）。如果是 Ollama，请在环境变量 OLLAMA_ORIGINS 中加入本站的源后再启动。',
      'custom.checkConnection': '请检查与 {host} 的连接。'
    }
  }
);
