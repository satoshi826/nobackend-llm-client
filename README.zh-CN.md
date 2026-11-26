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
- **聊天**: 流式输出、显示推理过程、Markdown 和代码高亮、对话树（重新生成、编辑、换模型重新生成），以及从不保存的临时聊天（在发送第一条消息前，于聊天顶部切换）。
- **文件**: 让模型"整理成报告"，它会把文档（Markdown、CSV 等）保存到"文件"标签页；长文档分段写入，并保留所有版本。"文件"标签页是一个文件管理器（卡片/列表视图、排序、按内容搜索、按类型和对话浏览、多选、拖放导入）。可以从设备或已保存的文件中附加文本、CSV、代码或 PDF（在浏览器内提取文字）。支持查看、编辑、下载和打印（保存为 PDF）。
- **图像生成（Venice）**: 输入框的图像模式（模型、宽高比、分辨率、1–4 张、风格、反向提示词、种子），"相同设置再生成"/"生成相似图像"，放大、编辑、去除背景，图库，以及可选的让聊天模型生成图像的工具。图像保存在本地（设置口令后加密）。
- **回复建议**: 在最新回答下方给出几条简短的后续回复，点击即可填入输入框。数量、参考最近几轮对话以及使用的模型都可以设置。
- **网页搜索**: 提供商内置的搜索（Venice），或工具方式（Tavily 搜索、Jina Reader 获取网页正文，均需你批准后执行）。
- **技能（Skills）**: 兼容 SKILL.md 的操作说明。模型只在需要时才读取正文，你也可以用 `/名称` 手动指定。在对话中让它"把这个做成技能"，模型会起草一份，经你批准后保存。
- **长对话**: 对话压缩（手动或自动）、提示缓存、上下文长度保护。
- **用量**: 按天、提供商、模型统计 token 数和费用，记录只保存在本浏览器中。Venice 余额异常下降时会提醒。
- **数据**: 全文搜索、JSON 备份与导入（可用密码加密）、删除图像、清除全部数据、PWA、深色模式、移动端布局。

## 快速开始

```bash
npm install
npm test          # 单元测试（Vitest）
npm run dev       # http://localhost:5173
```

### 不用真实 API 试用（模拟服务器）

```bash
npm run mock      # 兼容 Venice / Anthropic / Tavily / Jina 的模拟服务器（:8787）
VITE_VENICE_BASE_URL=http://localhost:8787/api/v1 \
VITE_ANTHROPIC_BASE_URL=http://localhost:8787/anthropic/v1 \
VITE_TAVILY_BASE_URL=http://localhost:8787/tavily \
VITE_JINA_BASE_URL=http://localhost:8787/jina \
npm run dev
```

**模拟密钥**: Venice 用 `mock-key`，Anthropic 用 `mock-ant`，Tavily 用 `tvly-mock`。

消息中的**关键词**会改变模拟服务器的行为:

- 通用: `思考` / `think`、`コード`、`長文`、`エラー`、`残高`、`画像`、`xss`、`盗用`
- 工具方式的网页搜索: `検索`、`読んで`
- 技能: `スキル` 会读取列表中的第一个技能
- 使用 skill-creator 的对话: `作って` / `直して` 会调用 save_skill

### 用生产环境的响应头检查

```bash
npm run build
node scripts/serve-with-headers.mjs dist 4173   # 应用 dist/_headers
npx wrangler dev --local                         # 或用 Cloudflare 的本地运行环境
```

## 部署（通过 GitHub 部署到 Cloudflare Workers）

应用作为只提供静态文件的 Worker 运行（`wrangler.jsonc`，没有 Worker 代码）。密钥保管库在同一站点的 `/vault/` 下提供。

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

### 把密钥保管库放在独立的源上（有自定义域名时推荐）

保管库放在独立的源上后，即使应用本体发生 XSS，也读不到你的密钥。

```bash
# 保管库站点（部署 dist-vault/）
VITE_APP_ORIGIN=https://app.example.com npm run build:vault
# 应用站点（保管库的源会自动加入 frame-src）
VITE_VAULT_URL=https://vault.example.com/ npm run build
```

请使用同一自定义域名下的子域名。两个不同的 `*.workers.dev` / `*.pages.dev` 站点被视为不同站点，保管库的存储可能被分区。应用的预览部署也无法嵌入独立的保管库。

### 从网络导入文件

在对话中提出请求后，模型的 `fetch_file` 工具会把 https 地址上的文件或图像导入“文件”标签。应用本身不会连接任意地址：由独立的获取页面（`/fetch/`，有自己的 CSP）获取，并且每次都会先显示地址并征求确认。文本、CSV、代码和 PDF 会成为模型可以读取的文件；图像按图像保存（最大 20 MB，不支持 SVG）。

浏览器只能从允许跨源读取的网站获取（CORS）：文件和图像的分发站点（GitHub raw 文件、Wikimedia、许多 CDN）通常允许，普通网页通常不允许。对于这些网站，可以部署自己的中转服务器（可选）：

```bash
# 在自己的 Cloudflare 上部署中转（relay/worker.js）；在 relay/wrangler.jsonc 的 ALLOWED_ORIGINS 中填写应用的源
cd relay && npx wrangler deploy
# 应用：告诉获取页面中转的位置
VITE_FETCH_RELAY_URL=https://nobackend-fetch-relay.<账户>.workers.dev npm run build
```

中转只连接公开的 https 地址，不转发你的请求头或 Cookie，不保存任何内容，只响应允许的源。通过中转获取的地址中转（你自己的 Worker）也能看到。若要让获取页面与应用内运行的脚本隔离，可像密钥保管库一样把它放在独立的源上：`VITE_APP_ORIGIN=https://app.example.com npm run build:fetch`（部署 `dist-fetch/`），并用 `VITE_FETCH_URL=https://fetch.example.com/` 构建应用。

### 在构建时添加提供商

`VITE_CUSTOM_PROVIDERS` 接收一个 OpenAI 兼容端点的 JSON 数组。它们会自动加入提供商列表、保管库的允许主机以及 CSP。

```bash
VITE_CUSTOM_PROVIDERS='[{"id":"ollama","label":"Ollama","baseUrl":"http://localhost:11434/v1","keyOptional":true}]' npm run build
```

| 字段 | 含义 |
|---|---|
| `id` | 小写字母、数字、连字符 |
| `baseUrl` | https（http 仅限本机） |
| `keyOptional` | 无需密钥即可使用 |
| `publicModels` | 无需密钥即可获取模型列表 |

配置无效时构建会失败。端点必须允许来自你站点的 CORS；Ollama 需要带上 `OLLAMA_ORIGINS=https://<你的站点>` 启动。由于密钥的发送目标在构建时固定，无法在界面中运行时添加提供商。

## 口令（保护密钥和对话）

不需要选择保存方式。

- **没有口令时**，密钥和对话按原样保存。
- **设置口令后**:
  - API 密钥、对话、已保存的提示词和技能都会被加密。
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
