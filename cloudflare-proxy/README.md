# Index-Translate → Trancy Cloudflare 代理

把本仓库的免费 B 站 Index-Translate API 接入 Trancy 自定义翻译引擎。服务运行在 Cloudflare Workers；使用时无需本机代理、Python 服务或显卡。

## Trancy 配置

在 Trancy「翻译引擎设置 → 自定义引擎」中选择自定义 / OpenAI 兼容协议：

| 字段 | 填写内容 |
| --- | --- |
| 模型 | `Index-Translate-35B-A3B` |
| 名称 | `Index-Translate Cloudflare` |
| API Key | 部署时生成的个人代理密钥 |
| API URL | `https://<Worker 名称>.<账户子域>.workers.dev/v1/chat/completions` |

Trancy 需要完整的 `/v1/chat/completions` 地址；它的输入框不是 OpenAI SDK 的 Base URL 输入框。只填 `/v1` 无法调用 chat completions。

更新配置时 Trancy 会发送 `Hello` 测试请求。保存成功只代表配置已存储；还应在实际网页上选择此引擎，确认译文出现。

官方在线演示的 [translate.html](https://index-translate.bilibili.com/?p=/site/translate.html) 明确使用 `?p=/v1/chat/completions` 查询路由兼容 CDN 白名单。Cloudflare 常规 `fetch` 请求曾返回 HTTP 412，故本代理使用该官方公开路由，并在 412 时通过 Workers 原生 TLS socket 连接同一官方域名。TLS 正常验证证书，不使用其他服务或本机代理。

## 代理行为

- 固定上游为官方在线演示使用的 `https://index-translate.bilibili.com/?p=/v1/chat/completions`，不提供任意 URL 代理。
- 验证个人 Bearer API Key；密钥存储为 Worker secret，缺失时拒绝调用。
- 仅向上游发送必要的请求头，不转发代理密钥或浏览器 Cookie。
- 强制 `temperature: 0`、`chat_template_kwargs.enable_thinking: false`。
- 保留 Trancy 的 system/user 提示词、HTML 标签、`%%` 段落分隔符。
- 支持 JSON 响应和 SSE 流式响应，透传真实 HTTP 错误及 `Retry-After`。
- 常规 `fetch` 遇到 HTTP 412 时，使用 Workers TLS socket 连接同一域名的 443 端口；使用 `http-parser-js` 解析 HTTP 分块传输，维持背压并响应取消和超时。
- 支持 CORS 预检；请求体上限 256 KiB，输出 token 上限 8192，上游超时 120 秒。
- `/health` 仅表示代理就绪；不代表上游翻译可用。`/v1/models` 需要密钥。
- 不缓存译文，不记录请求文本、API Key 或 Cookie。错误日志只记录异常信息。

## 部署与维护

使用 Node.js 22+、官方 `cf` CLI，先完成 `cf auth login`：

```sh
npm ci
npm run typecheck
npm test
npm run build
```

通过你自己的安全方式生成 `.deploy-secrets.json`，格式为：

```json
{"API_KEY":"请替换成随机生成的个人密钥"}
```

该文件已被 `.gitignore` 排除，应设置为仅自己可读。不要将真实密钥提交到 Git。

```sh
cf deploy --prebuilt --secrets-file .deploy-secrets.json
```

修改 `cloudflare.config.ts` 中的 `worker.name` 可使用其他 Worker 名称。重新部署同名 Worker 会更新现有服务。源代码没有 Cloudflare 账户 ID 或访问令牌。

使用 Workers Free 和现有免费上游接口，无需 R2、D1、KV、Workers AI、付费域名或新增付费订阅。Workers 免费请求配额是账户共享的，每日 100,000 次，UTC 00:00（北京时间 08:00）重置；超过后服务受限。上游免费 API 的可用性和限流由 B 站决定。

参考：[上游免费 API](../inference/llm/call_api.py)、[官方代理说明](../docs/immersive_translate_zh.md)、[Workers 免费额度](https://developers.cloudflare.com/workers/platform/limits/)。

## 线上验证记录（2026-10-21）

类型检查、构建和 9 项测试通过。部署版本 `2e86dc16-3821-4f78-af62-e6b19bff2289` 使用 Trancy 网站实际的简体中文 system/user 提示词测试：单句、三段 `%%` 批量翻译、SSE 流式翻译均返回 200；单次请求约 1.1–1.5 秒。浏览器 CORS 预检为 204，缺失密钥为 401。随后在当前用户 Trancy 配置页保存引擎，内置 `Hello` 测试实际经此 Worker 返回 200 与“你好”。在 IANA Example Domains 页面中选中 `Index-Translate Cloudflare`，标题、正文及链接均完成中文翻译，已留存页面截图。
