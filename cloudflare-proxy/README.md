# Index-Translate on Cloudflare — Worker

此目录是部署到 Cloudflare Workers 的 Index-Translate 免费 API 文本翻译代理。

完整的项目介绍、首次部署步骤、Trancy 配置、接口验证及 AI Agent 操作说明，请阅读仓库根目录的 [README.md](../README.md)。

已有配置时，在本目录执行：

```sh
npm ci
npm run typecheck
npm test
npm run build
npx cf deploy --prebuilt --secrets-file .deploy-secrets.json
```

`.deploy-secrets.json` 保存个人代理密钥，已被 Git 忽略。更新服务时复用已有密钥；不要将真实密钥或个人 CLI 登录文件提交到仓库。

代理支持文本消息、普通 JSON 和 SSE 响应，固定转发到 Index-Translate 官方域名。上游返回 412 时使用 Workers 原生 TLS socket 连接同一域名，并维持正常的证书校验。

2026-10-21 的部署验证覆盖：类型检查、构建、9 项测试、真实单句翻译、三段批量翻译、SSE、CORS 预检、Trancy 内置测试及实际网页翻译。此记录不代替每个新部署自身的连通性验证。
