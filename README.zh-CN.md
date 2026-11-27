# nobackend-llm-client

[English](README.md) | [日本語](README.ja.md) | **简体中文**

> 使用你自己的 API 密钥，无需后端，完全在浏览器中运行的 LLM 聊天客户端。

这是一个不需要服务器、不保留日志的 LLM 聊天客户端。它面向这样的人：想使用审查较少的模型或开放权重模型，但不想把对话留在 SaaS 产品里，也不想自己运维服务器或在本地运行模型。

- **无后端**: 只有静态文件。浏览器用你的密钥直接连接模型提供商的 API。没有账号、没有统计分析、没有第三方脚本。
- **数据只在本地**: 对话和设置只保存在浏览器中（IndexedDB）。
- **密钥不易被盗**: API 密钥只由一个独立的"密钥保管库"页面持有，不会交给应用本体。保管库只会把密钥附加到该提供商在构建时确定的主机上。另有严格的 CSP 和 Trusted Types。
- **可选口令**: 设置后，API 密钥和对话都会加密保存，在解锁之前整个应用都被锁屏隐藏。

界面支持日语、英语和简体中文（自动跟随浏览器，或在"设置 → 显示"中选择）。设计原则与规则见 [docs/principles.md](docs/principles.md)（英文）。

## 功能

- **提供商**: Venice、OpenRouter、Anthropic、Google Gemini、OpenAI、DeepSeek、Groq、NanoGPT、DeepInfra、Cerebras、Novita、Chutes、Together，以及在构建时添加的 OpenAI 兼容端点（如 Ollama）。没有哪个提供商被特殊对待，首次启动时由你选择使用哪个。
- **模型列表**: 书签（跨提供方标星的模型）、排序（推荐 / 名称 / 价格 / 上下文长度）和筛选（private / 推理 / 图像 / 搜索 / 免费），并显示价格和能力。
- **聊天**: 流式输出、显示推理过程、Markdown 和代码高亮、对话树（重新生成、编辑、换模型重新生成），以及从不保存的临时对话（在发送第一条消息前，于聊天顶部切换）。
- **沙箱**: HTML 和 SVG 文件以页面形式显示，html / svg / js 代码块带有“运行”按钮，聊天模型可以运行 JavaScript 做精确计算（`run_javascript`，运行前确认）。这些都在无法访问应用、并阻止网络请求的隔离框架中运行（WebRTC 连接只在会阻止它的浏览器中被阻止，Chrome 不会）。
- **文件**: 让模型"整理成报告"，它会把文档（Markdown、CSV 等）保存到"文件"标签页；长文档分段写入；每个文件保留上次修改之前的内容，可以撤销最后一次修改。对话的文件放在工作文件夹中（随第一个文件创建，由模型命名），模型只能读写其中的文件（以及附加到对话的文件）；在"文件"标签页中选择"在此文件夹中对话"，即可用已有的文件夹开始新对话。文件名可以包含文件夹（`site/css/style.css`），HTML 页面预览时可以加载同一站点（页面上方最近的含 index.html 的文件夹）中的文件（CSS、JavaScript 模块、图像），仍不连接网络。"文件"标签页是一个文件管理器（卡片/列表视图、排序、按内容搜索、按类型和对话浏览、多选、拖放导入）。可以从设备或已保存的文件中附加文本、CSV、代码或 PDF（在浏览器内提取文字）。支持查看、编辑、下载和打印（保存为 PDF）。
- **图像生成**（Venice、OpenAI、Gemini、OpenRouter、NanoGPT、DeepInfra、Together；按指令编辑支持 Gemini、NanoGPT、OpenAI、OpenRouter、Venice；放大和去除背景仅限 Venice）: 输入框的图像模式（模型、宽高比、分辨率、1–4 张、风格、反向提示词、种子），"相同设置再生成"/"生成相似图像"，放大、编辑、去除背景，图库，以及可选的让聊天模型生成图像的工具。图像保存在本地（设置口令后加密）。
- **视频生成**（Venice、OpenRouter、Gemini）: 输入框的视频模式，设置其中任一密钥后显示（模型、时长、分辨率、宽高比、声音、首帧；可从图像生成动起来的视频，图像上有“生成视频”）。发送前显示价格。生成会在服务端持续数分钟，重新加载页面后也能继续等待（Venice、OpenRouter），也可以停止等待、之后再次等待。视频与图像一起保存。
- **回复建议**: 在最新回答下方给出几条简短的后续回复，点击即可填入输入框。数量、参考最近几轮对话以及使用的模型都可以设置。
- **网络**: 用提供商内置的搜索（Anthropic、Gemini、Groq、OpenRouter、Venice）或 Tavily 工具搜索；模型用 `fetch_url` 读取网页（HTML、文本、PDF），由另一次调用只提取所需内容后再交给模型（与 Claude Code 的 WebFetch 相同的方式）；用 `fetch_file` 导入文件。所有获取都在获取页面中确认，并可记住你允许的网站。
- **技能（Skills）**: 兼容 SKILL.md 的操作说明。模型只在需要时才读取正文，你也可以用 `/名称` 手动指定。在对话中让它"把这个做成技能"，模型会起草一份，经你批准后保存。
- **长对话**: 对话压缩（手动或自动）、提示缓存、上下文长度保护。
- **用量**: 按天、提供商、模型统计 token 数和费用，记录只保存在本浏览器中。可查看 DeepSeek、NanoGPT、OpenRouter（此密钥额度的剩余）和 Venice 的余额，余额异常下降时会提醒。
- **数据**: 全文搜索、JSON 备份与导入（可用密码加密）、删除图像、清除全部数据、PWA、深色模式、移动端布局。
- **开发者**: 可以查看每条回复发送给服务商的请求（JSON）（设置 → 关于 →“显示已发送的请求”）。

## 快速开始

```bash
npm install
npm test          # 单元测试（Vitest）
npm run dev       # http://localhost:5173
```

### 不用真实 API 试用（模拟服务器）

```bash
npm run mock      # 兼容 Venice / Anthropic / Gemini / OpenRouter / OpenAI / Tavily / Jina Reader 的模拟服务器（:8787）
VITE_VENICE_BASE_URL=http://localhost:8787/api/v1 \
VITE_ANTHROPIC_BASE_URL=http://localhost:8787/anthropic/v1 \
VITE_TAVILY_BASE_URL=http://localhost:8787/tavily \
VITE_JINA_BASE_URL=http://localhost:8787/jina \
npm run dev
```

**模拟密钥**: Venice 用 `mock-key`，Anthropic 用 `mock-ant`，Tavily 用 `tvly-mock`。Gemini（`mock-gem`）、OpenRouter（`mock-or`，仅模型列表、余额、图像和视频）和 OpenAI（`mock-oai`）通过 `VITE_GEMINI_BASE_URL=http://localhost:8787/gemini/v1beta`、`VITE_OPENROUTER_BASE_URL=http://localhost:8787/openrouter/api/v1`、`VITE_OPENAI_BASE_URL=http://localhost:8787/openai/v1` 使用。模拟服务器也提供 Venice 的图像模型并生成 PNG，并受理三个视频 API 的生成（查询几次后返回一段短视频）：图像提示词包含 `違反` 时返回内容政策拒绝（附带改写建议），包含 `ぼかし` 时返回模糊处理的结果；对聊天模型说“絵を描いて”（图像工具开启时）会调用 `generate_image`。

消息中的**关键词**会改变模拟服务器的行为:

- 通用: `思考` / `think`、`コード`、`長文`、`エラー`、`残高`、`画像`、`xss`、`盗用`
- 工具方式的网页搜索: `検索`、`読んで`（搜索之后）。直接读取网页: `ページを読んで`
- 内置搜索（Anthropic 和 Gemini 的模拟）: `検索` / `天気`
- 技能: `スキル` 会读取列表中的第一个技能
- 使用 skill-creator 的对话: `作って` / `直して` 会调用 save_skill
- 文件: `レポートにまとめて` 会调用 create_file；对话中有文件时，`追記して` / `結論を直して` / `全部読んで` 会调用 append_file / edit_file / read_file
- 沙箱: `実行できる例` 会返回可运行的 JS 和 HTML 代码块，`計算して` 会调用 run_javascript，`ページを作って` 会创建 HTML 文件

### 用生产环境的响应头检查

```bash
npm run build
node scripts/serve-with-headers.mjs dist 4173   # 应用 dist/_headers
npx wrangler dev --local                         # 或用 Cloudflare 的本地运行环境
```

## 部署（通过 GitHub 部署到 Cloudflare Workers）

应用作为只提供静态文件的 Worker 运行（`wrangler.jsonc`，没有 Worker 代码）。密钥保管库（`/vault/`）和获取页面（`/fetch/`）也由同一站点提供。

1. 把本仓库推送到 GitHub。
2. 在 Cloudflare 控制台打开 Workers & Pages → Create → **Import a repository**，选择该仓库。
3. 配置项目:
   - **Project name**: 与 `wrangler.jsonc` 中的 `name`（`nobackend-llm-client`）相同。
   - **Build command**: `npm run build`。可以留空，因为 `wrangler.jsonc` 也会执行它。
   - **Deploy command**: `npx wrangler deploy`（默认值）。
   - **环境变量**: 不需要。Node 22 由 `.node-version` 指定。**不要**设置任何 `VITE_*_BASE_URL`，它们仅用于模拟服务器。
4. 之后每次推送到 `main`，都会部署到 `https://<名称>.<账户>.workers.dev`。

**请关闭以下 Cloudflare 功能**: Web Analytics、Rocket Loader、Email Address Obfuscation、Zaraz。它们会注入脚本，会被 CSP 拦截，也违背"无第三方脚本"的原则。

**验证**: 每个页面都应只有一个 CSP，保管库页面应带有保管库专用的 CSP（其 `connect-src` 列出各 LLM API）。

```bash
curl -sI https://<你的站点>/ | grep -i content-security-policy
curl -sI https://<你的站点>/vault/ | grep -i content-security-policy
```

然后打开站点，确认开发者工具控制台中没有 CSP 错误。再用设有用量上限的密钥完整试一遍：保存密钥 → 聊天 → 设置并解锁口令。

也可以用 Cloudflare Pages 部署（构建命令 `npm run build`，输出目录 `dist`），`_headers` 的效果相同。

**数据按源（origin）分开保存**: 对话和密钥属于你访问的那个 URL。迁移时（从本地试用版到正式站点、从 `workers.dev` 到自定义域名等），请先在"设置 → 隐私与数据"中导出备份，再到新站点导入。密钥需要重新输入。

### 严格配置：把保管库和获取页面放在独立的源上

默认情况下，密钥保管库（`/vault/`）和获取页面（`/fetch/`）与应用同源提供，放在任何主机上都能用。其局限是：万一应用内运行了脚本（XSS），它可以向保管库索取密钥，也可以借获取页面把数据发往任意地址。两者都放在独立的源上后，这样的脚本什么也做不了。

```bash
# 保管库站点（部署 dist-vault/）和获取页面站点（部署 dist-fetch/）
VITE_APP_ORIGIN=https://app.example.com npm run build:vault
VITE_APP_ORIGIN=https://app.example.com npm run build:fetch
# 应用站点：两个源会加入 frame-src，且不再构建 /vault/ 和 /fetch/
VITE_VAULT_URL=https://vault.example.com/ VITE_FETCH_URL=https://fetch.example.com/ npm run build
```

请使用同一自定义域名下的子域名（三个 Workers 或 Pages 站点，免费）。两个不同的 `*.workers.dev` / `*.pages.dev` 站点被视为不同站点，保管库的存储可能被分区；`*.github.io` 的页面则全部同源。应用的预览部署无法嵌入独立的保管库。密钥需要在新的保管库中重新输入。

### 其他静态主机（GitHub Pages 等）

`npm run build` 会把每个页面的 CSP 同时写入 `_headers` 和 HTML，因此不读取 `_headers` 的主机（GitHub Pages）也会执行 CSP。但 `<meta>` 形式的 CSP 写不了的内容会失去：`frame-ancestors`（其他网站可以嵌入这些页面）以及其他响应头（`nosniff`、`Referrer-Policy`、COOP）。日常使用推荐 Cloudflare。

默认从域名根目录提供（名为 `<用户名>.github.io` 的仓库，或自定义域名）。要放在 `<用户名>.github.io/<仓库名>/` 这样的路径下时，构建时指定该路径：

```bash
VITE_BASE_PATH=/<仓库名>/ npm run build
```

各页面（`fetch/`、`vault/`、`sandbox/`）、Service Worker 和资源都会位于该路径下。`<用户名>.github.io` 下的所有站点同源：你其他仓库站点上的脚本可以读取应用保存的内容（对话、保管库中的密钥），只有口令加密能保护它们。最好使用应用专用的域名。

### 读取网页、从网络导入文件

模型接触网络的方式有两种，都由独立的获取页面（`/fetch/`，有自己的 CSP）先显示地址并征求确认；可以对某个网站选择“不再询问”，读取网页和获取文件分别记住（保存在获取页面的存储中，可在 设置 → 网页 →“获取页面设置”中移除）。之后无论模型在地址中放入什么，都会不经确认发送给该网站。应用本身既不连接任意地址，也不连接 Jina Reader。获取页面依次尝试：直接获取 → 中转服务器（已设置时）→ Jina Reader（仅限读取）。

- **读取**（`fetch_url`，同时给出想从网页了解的内容）: 在应用内把网页（HTML、文本或 PDF）转为正文，由一次不带工具的独立调用根据正文回答请求。对话模型只收到这个回答，因此网页中植入的指令不容易产生影响。读取所用的模型与对话相同，或在 设置 → 网页 的“用于读取网页的模型”中选择。无法直接获取的网页经由中转服务器（见下文）；仍无法获取的网页，以及 HTML 中几乎没有正文（可见文字不足约 400 字）的网页（由脚本绘制），经由 Jina Reader（`r.jina.ai`）读取。
- **导入**（`fetch_file`）: 把文件或图像原样保存到“文件”标签。文本、CSV、HTML、代码和 PDF 会成为模型可以读取的文件；图像按图像保存（最大 20 MB，不支持 SVG）。需要处理网页的 HTML（例如写爬虫）时，可以保存后让模型读取，或用 `run_javascript` 试运行。

Jina Reader 无需密钥即可使用（每个 IP 地址每分钟最多 20 次）。想提高上限时，可以在获取页面设置中填写 API 密钥（可选）。该密钥以未加密的形式保存在获取页面的存储中（设置口令后也一样），只随发往 Jina Reader 的请求发送，不包含在备份中。

浏览器只能从允许跨源读取的网站获取（CORS）：文件和图像的分发站点（GitHub raw 文件、Wikimedia、许多 CDN）通常允许，普通网页通常不允许。对于这些网站，可以部署自己的中转服务器（可选）：

```bash
# 在自己的 Cloudflare 上部署中转（relay/worker.js）；在 relay/wrangler.jsonc 的 ALLOWED_ORIGINS 中填写获取页面的源（与应用同站时即应用的源）
cd relay && npx wrangler deploy
# 应用：告诉获取页面中转的位置
VITE_FETCH_RELAY_URL=https://nobackend-fetch-relay.<账户>.workers.dev npm run build
# 获取页面放在独立源时，build:fetch 和应用的 build 都要传入相同的值（应用在 设置 → 网页 中显示它）
```

中转只连接公开的 https 地址，不转发你的请求头或 Cookie，不保存任何内容，只响应允许的源，对重定向目标做同样的检查，并向 Cloudflare 指定每个 IP 每分钟最多 30 次请求（源可以被脚本伪造，中转的地址也能从应用代码中读到）。不过 Cloudflare 只是粗略地执行这个限制，测试时所有请求都通过了。通过中转获取的地址中转（你自己的 Worker）也能看到。

### 在构建时添加提供商

`VITE_CUSTOM_PROVIDERS` 接收一个 OpenAI 兼容端点的 JSON 数组。它们会自动加入提供商列表、保管库的允许主机以及 CSP。

```bash
VITE_CUSTOM_PROVIDERS='[{"id":"ollama","label":"Ollama","baseUrl":"http://localhost:11434/v1","keyOptional":true}]' npm run build
```

| 字段 | 含义 |
|---|---|
| `id` | 小写字母、数字、连字符 |
| `label` | 显示名称（省略时为 `id`） |
| `baseUrl` | https（http 仅限本机） |
| `keyOptional` | 无需密钥即可使用 |
| `publicModels` | 无需密钥即可获取模型列表 |

配置无效时构建会失败。端点必须允许来自你站点的 CORS；Ollama 需要带上 `OLLAMA_ORIGINS=https://<你的站点>` 启动。由于密钥的发送目标在构建时固定，无法在界面中运行时添加提供商。

## 口令（保护密钥和对话）

不需要选择保存方式。

- **没有口令时**，密钥和对话按原样保存。
- **设置口令后**:
  - API 密钥、对话、文件、图像、已保存的提示词和技能都会被加密（获取页面保存的 Jina Reader 密钥和不再询问的网站除外）。
  - 解锁之前，整个应用都被锁屏隐藏。
  - 每个标签页、每次重新加载都需要重新解锁。
  - 可以用侧边栏的按钮锁定，也可以设置无操作时自动锁定。
- **如何设置**: 首次保存密钥后，应用会提示一次是否设置口令（可以跳过）。也可以随时在"设置 → 连接与密钥"中设置、修改或移除。修改和移除都需要输入当前口令。
- **忘记口令将无法恢复。** 锁屏界面只能清除全部数据后重新开始。
- **除非导出时设置密码，备份是明文 JSON**（设置口令后默认加密）。请妥善保管明文备份。

## API 密钥安全建议

请始终使用**设有用量上限的密钥**。万一泄露，损失也止于上限。

- **Venice**: 创建 **INFERENCE** 类型的密钥，设置每日用量上限和有效期。设置 `modelPrivacy: PRIVATE_ONLY` 可以禁止使用被转发给第三方的模型。
- **OpenRouter**: 为密钥设置额度上限。
- **Anthropic**: 在 Console 中设置工作区的支出上限。
- **Gemini**: 免费层级下，Google 可能会用你发送的内容改进其服务（付费层级不会）。
- **DeepSeek**: 预付费，充值金额即为上限。数据由一家中国公司的服务器处理。
- **Groq**: 免费层级有次数和 token 数限制；升级为付费时请设置支出上限。
- **NanoGPT**: 请为密钥设置每日、每周或每月的用量上限。
- **DeepInfra**: 请为密钥设置每月用量上限。
- **Cerebras**: 预付费额度，余额即为上限。
- **Novita**: 请为密钥设置预算（用量上限）。
- **Chutes**: 尚未确认是否可以按密钥设置用量上限，请小额充值使用。
- **Together**: 预付费，没有按密钥的上限，请小额充值使用。
- **Tavily**（工具方式的网页搜索）: 设置用量上限。
