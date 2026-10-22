# Index-Translate on Cloudflare

将 **Index-Translate 免费 API 代理部署到 Cloudflare Workers**，为 Trancy 等浏览器插件和 OpenAI Chat Completions 兼容客户端提供可直接使用的 HTTPS 翻译接口。使用时无需在本机运行代理服务，也不需要本地 GPU。

本项目基于 [bilibili/Index-Translate](https://github.com/bilibili/Index-Translate) fork，主要实现位于 [`cloudflare-proxy/`](cloudflare-proxy/)。翻译由上游 Index-Translate 模型完成，Cloudflare Workers 负责请求适配、鉴权、跨域处理和转发。这是社区代理项目；上游模型与免费 API 由 Index-Translate 团队提供和维护。

公开的是源码和部署方法。请部署到自己的 Cloudflare 账户，并使用自己生成的代理密钥；本仓库不提供公共共享密钥。

[部署方法](#部署方法) · [Trancy 配置](#trancy-配置) · [验证服务](#验证服务) · [给 AI Agent](#给-ai-agent) · [上游项目](https://github.com/bilibili/Index-Translate)

## 项目功能

- 提供 OpenAI Chat Completions 兼容的文本翻译接口，支持普通 JSON 和 SSE 流式响应。
- 处理浏览器 CORS 预检，适配 Trancy 自定义引擎。
- 使用 Worker secret 保存个人代理密钥，校验 Bearer Token 或 `X-API-Key`，不向上游转发该密钥或浏览器 Cookie。
- 自动设置 `temperature: 0` 和 `chat_template_kwargs.enable_thinking: false`，关闭模型思考输出。
- 保留客户端提示词、HTML 标签和 Trancy 的 `%%` 段落分隔符。
- 使用官方在线演示的查询路由；常规 `fetch` 遇到 HTTP 412 时，尝试通过 Workers 原生 TLS socket 连接同一官方域名，保持正常证书校验。
- 不缓存译文，代码不记录请求文本、API Key 或 Cookie。

当前代理仅接受 `system`、`user`、`assistant` 角色的**文本消息**。上游模型的图片、音频等能力不在此代理的实现范围内。

```text
Trancy / OpenAI 兼容客户端
          ↓ HTTPS + 个人代理密钥
Cloudflare Workers
          ↓ HTTPS
Index-Translate 官方免费 API
```

## 部署方法

### 1. 准备环境并获取代码

需要一个 Cloudflare 账户、Git 和 **Node.js 24 或更新版本**。项目使用 npm 发布的官方 `cf` CLI；安装依赖后可以通过 `npx cf` 调用项目锁定的版本。

```sh
git clone https://github.com/bestmenet/Index-Translate-on-Cloudflare.git
cd Index-Translate-on-Cloudflare/cloudflare-proxy
npm ci
```

后续命令都在 `cloudflare-proxy/` 目录中运行。仓库保留了上游模型和评测目录，部署本代理不需要安装其中的 Python、CUDA 或模型推理依赖。

### 2. 登录 Cloudflare 并设置 Worker 名称

```sh
npx cf auth login
```

按 CLI 提示完成登录。已有可用登录时可直接复用。

打开 [`cloudflare-proxy/cloudflare.config.ts`](cloudflare-proxy/cloudflare.config.ts)，按需修改 `worker.name`：

```ts
name: "index-translate-trancy",
```

如果你的账户中已有同名 Worker，请先改为新的名称，避免覆盖已有服务。默认开启 `workers.dev` 地址，无需购买域名或配置自定义域名。

### 3. 生成个人代理密钥

在当前目录执行以下命令，生成随机密钥并写入 `.deploy-secrets.json`，不会在终端打印密钥：

```sh
node -e "const fs=require('node:fs');const crypto=require('node:crypto');fs.writeFileSync('.deploy-secrets.json',JSON.stringify({API_KEY:'it_'+crypto.randomBytes(32).toString('base64url')})+'\n',{flag:'wx',mode:0o600})"
```

`flag: 'wx'` 会拒绝覆盖已有文件。重新部署时复用现有密钥即可；如果提示文件已存在，不需要重新生成。在支持 POSIX 文件权限的系统上，该文件仅当前用户可读写。

密钥文件已被 `.gitignore` 排除。请将真实密钥留在自己的本机和 Cloudflare Worker secret 中，不要写入 README、截图、提交记录或公开日志。客户端使用的 API Key 就是该文件中的 `API_KEY` 值；它是你自己的代理密钥，上游 API 不需要这个密钥。

### 4. 检查并构建

```sh
npm run typecheck
npm test
npm run build
```

类型检查、测试及构建通过后再部署。

### 5. 发布到 Cloudflare Workers

```sh
npx cf deploy --prebuilt --secrets-file .deploy-secrets.json
```

CLI 会输出部署地址，例如：

```text
https://<worker-name>.<account-subdomain>.workers.dev
```

复制这次部署实际输出的地址。不同客户端的填写方式如下：

| 客户端字段 | 地址格式 |
| --- | --- |
| Trancy 的 API 接口地址 | `https://<worker-name>.<account-subdomain>.workers.dev/v1/chat/completions` |
| OpenAI SDK 的 Base URL | `https://<worker-name>.<account-subdomain>.workers.dev/v1` |

后续更新时进入同一目录，执行 `git pull --ff-only`、`npm ci`，再重新检查、构建和部署。复用相同 Worker 名称与密钥会更新已有服务。

## Trancy 配置

在 Trancy 的「翻译引擎设置 → 自定义引擎」中添加或编辑一个 OpenAI 兼容引擎：

| 配置项 | 填写内容 |
| --- | --- |
| 提供商 / 协议 | 自定义引擎 / OpenAI 兼容 |
| 引擎名称 | `Index-Translate on Cloudflare`，也可自定义 |
| 模型名称 | `Index-Translate-35B-A3B` |
| API Key | 你生成的 `.deploy-secrets.json` 中的 `API_KEY` |
| API 接口地址 | 你的 Worker 地址，加上 `/v1/chat/completions` |

Trancy 的这个输入框需要**完整接口地址**，只填写 `/v1` 不会自动补全 Chat Completions 路径。

保存时 Trancy 会发送 `Hello` 测试请求。随后在实际网页的翻译引擎列表中选中该自定义引擎，并开启沉浸翻译，确认译文出现。

## 验证服务

### 健康检查

```sh
curl "https://<worker-name>.<account-subdomain>.workers.dev/health"
```

预期返回 HTTP 200 和 `status: "ready"`。健康检查只说明 Worker 正常响应，上游翻译是否可用还需通过真实翻译请求确认。

### 真实翻译请求

下面的 Node.js 示例在本机读取密钥，只打印 HTTP 状态与响应正文，不打印密钥。将 `base` 替换为你自己的部署地址后，在 `cloudflare-proxy/` 中运行：

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';

const base = 'https://<worker-name>.<account-subdomain>.workers.dev';
const { API_KEY } = JSON.parse(readFileSync('.deploy-secrets.json', 'utf8'));
const response = await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: 'Index-Translate-35B-A3B',
    messages: [{ role: 'user', content: '请将 Hello, world! 翻译为中文，只输出译文。' }],
    stream: false,
  }),
  signal: AbortSignal.timeout(125000),
});
console.log('HTTP', response.status);
console.log(await response.text());
if (!response.ok) process.exitCode = 1;
JS
```

此处 heredoc 示例适用于 Bash、Zsh 等 shell；Windows 用户可将 `JS` 标记之间的代码保存为 `verify.mjs`，再执行 `node verify.mjs`。

预期返回 HTTP 200，译文位于 `choices[0].message.content`。验证批量翻译时，可在输入中加入 `%%` 分隔的多个段落，并在提示词中要求保留分隔符。验证流式调用时，将 `stream` 设为 `true`，检查 SSE 内容和最终的 `data: [DONE]`。

## 接口与限制

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/health` 或 `/` | GET | Worker 健康状态，无需鉴权 |
| `/v1/models` | GET | 模型列表，需要个人代理密钥 |
| `/v1/chat/completions` | POST | 文本翻译，需要个人代理密钥 |
| 任意路径 | OPTIONS | 浏览器跨域预检 |

默认模型为 `Index-Translate-35B-A3B`。代理允许的模型名称还包括 `Index-Translate-9B` 和 `Index-Translate-2B`，实际可用性以上游服务为准。

请求体上限为 256 KiB，输出 token 上限为 8192，上游请求超时为 120 秒。上游限流错误和 `Retry-After` 会透传给客户端，不会伪装成成功译文。

本项目不依赖 R2、D1、KV、Workers AI、付费域名或额外服务器，可使用 Workers 免费额度。Cloudflare 的免费额度按账户共享，实际限额和计费以 [Workers 官方定价](https://developers.cloudflare.com/workers/platform/pricing/)及[平台限制](https://developers.cloudflare.com/workers/platform/limits/)为准。上游免费 API 的服务时间、限流及后续政策由 Index-Translate 团队决定。

翻译文本会经过你部署的 Cloudflare Worker 并发送至 B 站上游 API，请根据实际数据使用要求选择输入内容。

## 常见问题

- **404 或接口无法识别**：检查 Trancy 中填写的是完整 `/v1/chat/completions` 地址。
- **401**：检查客户端 API Key 是否与部署到 Worker 的 `API_KEY` 一致；不要填写示例字符串。
- **412**：代理会尝试 TLS socket 连接同一上游。若最终仍返回 412，说明本次请求仍被上游拒绝，需要等待上游恢复或检查其服务策略。
- **429**：遵循上游 `Retry-After`，降低请求频率和并发。
- **502 / 504**：检查上游是否正常；502 也可能表示上游返回了非 JSON / SSE 内容，504 表示超时或取消。
- **健康检查正常但翻译失败**：健康接口不访问上游，应继续执行真实翻译测试。
- **修改 Worker 名称后找不到旧服务**：新名称会对应新的地址，需要更新客户端配置。

## 给 AI Agent

如果你希望 AI Agent 帮你部署，可直接发送以下任务说明：

> 请阅读这个仓库的 README，将 `cloudflare-proxy/` 中的 Index-Translate 文本翻译代理部署到我自己的 Cloudflare 账户，并验证其可用于 Trancy。使用项目现有的 `cloudflare.config.ts`、官方 `cf` CLI 和锁定的 npm 依赖。保护所有真实密钥；已有同名 Worker 或密钥文件时先确认其归属与用途，保留已有配置。完成检查、构建、部署、真实翻译及浏览器跨域验证后，提供完整 Trancy API URL、模型名称、密钥保存位置和实际验证结果。

Agent 执行此任务时应遵循以下步骤：

1. 读取 README、`cloudflare-proxy/package.json`、`cloudflare.config.ts`、`src/` 和相关测试；先检查 `git status`，保留用户已有修改。代理工作目录是 `cloudflare-proxy/`，不是上游模型训练或推理目录。
2. 复用已有登录和用户指定的 Cloudflare 账户。确需交互登录时使用 `npx cf auth login`，让用户完成登录；不要读取、打印或上传 CLI 的原始认证文件。
3. 使用 `cf` 工作流。此项目使用 `cloudflare.config.ts`，不要无故改成 Wrangler 配置；命令不确定时查阅 `cf --help`、`cf cli search` 或已发现命令的帮助。
4. 检查目标 Worker 名称以及已有密钥文件。新部署生成随机个人密钥；更新部署优先复用现有密钥。不要覆盖无关 Worker、泄露密钥，或将密钥上传 GitHub。
5. 执行 `npm ci`、`npm run typecheck`、`npm test`、`npm run build`。用户已授权部署时，继续执行 `npx cf deploy --prebuilt --secrets-file .deploy-secrets.json`，不要新增付费依赖或付费订阅。
6. 使用部署命令实际返回的地址验证：`/health` 返回 200；缺失密钥的受保护请求返回 401；浏览器 OPTIONS 预检返回 204 且允许所需请求头；真实翻译返回 200 和有效译文。
7. 如果需要验证流式和批量调用，检查 SSE 的 `[DONE]`、`%%` 段落数量与非空译文。不要把健康检查、模拟测试、成功上传代码当作真实翻译成功的证据。
8. 用户要求配置浏览器插件时，在 Trancy 填写完整 `/v1/chat/completions` 地址和个人代理密钥，选中该引擎并验证实际网页。交付时说明已验证的路径和无法验证的部分，不宣称未做过的浏览器、字幕或 PDF 测试已通过。

## 项目结构与上游来源

```text
cloudflare-proxy/
├── src/index.ts             # 鉴权、CORS、请求适配和上游转发
├── src/tls-request.ts       # TLS socket 与 HTTP 流式解析
├── test/                   # 代理及 TLS 解析测试
├── cloudflare.config.ts    # Worker 配置与 secret 声明
└── package.json            # 依赖和检查 / 构建命令
```

本仓库保留上游模型、浏览器扩展与评测相关文件，方便查阅来源。原始说明见 [上游英文 README](README.upstream.md) 和 [上游中文 README](README_zh.upstream.md)；模型本身、模型权重和其他工具请参阅 [bilibili/Index-Translate](https://github.com/bilibili/Index-Translate)。

项目沿用仓库的 [Apache-2.0 许可证](LICENSE)。感谢 Index-Translate 团队提供模型、免费 API 和官方调用示例。
