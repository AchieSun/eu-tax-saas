# F5 AI Gateway 设置指南 — DeepSeek 路由

AI Gateway 是 Cloudflare 放在 DeepSeek 前面的代理层。它可以提供请求日志、缓存、速率控制和模型供应商路由，避免我们在代码里到处写 DeepSeek 的供应商 URL。

如果你还没有 Cloudflare 账号、还没登录 Wrangler，先看总入口：`CLOUDFLARE-SETUP-OVERVIEW.md`。

Workers AI 和 AI Gateway 是两个不同的东西：

- **Workers AI (`env.AI`)**：用于生成 embedding，例如给 Vectorize 使用的 BGE-M3。
- **AI Gateway**：用于把 LLM 请求转发给 DeepSeek，当前 `src/services/deepseek.ts` 已经支持。

## 代码现在已经做了什么

当下面两个字段都配置好时，`src/services/deepseek.ts` 会生成这个 base URL：

```text
https://gateway.ai.cloudflare.com/v1/{AI_GATEWAY_ACCOUNT_ID}/{AI_GATEWAY_NAME}/deepseek
```

如果这些字段缺失，客户端会自动 fallback 到 DeepSeek 官方 API：

```text
https://api.deepseek.com/v1
```

所以生产环境建议使用 AI Gateway；但本地测试不强制依赖 AI Gateway。

## 创建 AI Gateway

推荐使用 Cloudflare Dashboard 操作。当前官方稳定路径是 Dashboard 或 REST API，不要把 `wrangler ai-gateway create` 当作必定可用的命令。

1. 打开 Cloudflare Dashboard：<https://dash.cloudflare.com/>
2. 进入 **AI → AI Gateway**。
3. 点击创建 Gateway。
4. 名称建议使用 `eu-tax-saas`。
5. 复制 Dashboard 里显示的 gateway slug/name。
6. 复制你的 Cloudflare Account ID。

如果你只想先用 Cloudflare 自动创建的默认 gateway，也可以在后续代码里用 `default`。但本项目文档和 env 命名按自定义 gateway `eu-tax-saas` 记录，方便日志和生产排查。

## 需要设置的 secrets / vars

在 `app/` 目录运行：

```bash
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put AI_GATEWAY_ACCOUNT_ID
npx wrangler secret put AI_GATEWAY_NAME
```

如果是 staging 或 production 环境，按需加上对应的 `--env`：

```bash
npx wrangler secret put DEEPSEEK_API_KEY --env production
npx wrangler secret put AI_GATEWAY_ACCOUNT_ID --env production
npx wrangler secret put AI_GATEWAY_NAME --env production
```

## 每个字段是什么意思

| 字段 | 含义 | 示例 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 你的 DeepSeek provider key。不要粘贴到代码、文档或聊天里。 | `sk-...` |
| `AI_GATEWAY_ACCOUNT_ID` | 你的 Cloudflare account ID，不是 API key。 | `0123456789abcdef...` |
| `AI_GATEWAY_NAME` | 你创建的 gateway slug/name。 | `eu-tax-saas` |

## 你设置完后需要发给我的信息

请只发下面这些非密钥信息：

- `AI_GATEWAY_ACCOUNT_ID`
- `AI_GATEWAY_NAME`
- 确认 `DEEPSEEK_API_KEY` 已经通过 `wrangler secret put` 设置完成

不要把真实 DeepSeek API key 发给我，除非你明确希望我在本地环境做 live 测试。

## 验证方式

设置 secrets 后，先跑一次构建 dry-run：

```bash
pnpm build
```

如需连接远端 Cloudflare 资源调试，可以启动远端 dev session：

```bash
npx wrangler dev --remote
```

然后触发一个 AI 路由。Cloudflare Dashboard 里应该能在 **AI Gateway → eu-tax-saas** 下看到请求记录。

## 和 Vectorize 的关系

AI Gateway 不生成 embedding，也不存储向量。F5 RAG 的分工是：

1. Workers AI BGE-M3 生成 embedding。
2. Vectorize 存储和查询 embedding。
3. DeepSeek 通过 AI Gateway，基于检索出来的上下文回答用户问题。

另见：`F5-VECTORIZE-SETUP.md` 和 `CLOUDFLARE-SETUP-OVERVIEW.md`。
