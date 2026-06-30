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
7. 进入 Gateway 详情页 → **提供程序密钥** → 找到 **DeepSeek** → 点击 `+` → 选择 **自带密钥 (BYOK)** → 填入你的 DeepSeek API Key。

如果你只想先用 Cloudflare 自动创建的默认 gateway，也可以在后续代码里用 `default`。但本项目文档和 env 命名按自定义 gateway `eu-tax-saas` 记录，方便日志和生产排查。

### 关于"已验证的网关"

创建 Gateway 时有一个 **"已验证的网关" / "Authenticated Gateway"** 开关：

- **关闭**：任何请求都可以访问 Gateway，DeepSeekClient 用 DeepSeek API Key 作为 `Authorization` 透传即可。
- **开启**：Cloudflare 要求请求头 `Authorization: Bearer {Cloudflare API Token}`，DeepSeek 的 provider key 只在 Dashboard 的 provider 配置里使用。

本项目的代码已支持开启验证：只要配置了 `AI_GATEWAY_API_TOKEN`，DeepSeekClient 就会把 Cloudflare API Token 发给 Gateway。

## 需要设置的 secrets / vars

在 `app/` 目录运行：

```bash
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put AI_GATEWAY_ACCOUNT_ID
npx wrangler secret put AI_GATEWAY_NAME
```

`AI_GATEWAY_API_TOKEN` 是**可选的**，只有你在 Gateway 设置里开启了 **"已验证的网关"** 时才需要设置：

```bash
npx wrangler secret put AI_GATEWAY_API_TOKEN
```

- 如果开启验证：请求头使用 Cloudflare API Token，DeepSeek provider key 只在 Dashboard 的 provider 配置里使用。
- 如果关闭验证：请求头使用 DeepSeek API Key，Gateway 会把它透传给 DeepSeek（或作为 BYOK provider key 使用）。

创建 `AI_GATEWAY_API_TOKEN` 的方式：

1. Cloudflare Dashboard → **我的个人资料** → **API 令牌**
2. 点击 **创建令牌** → **自定义令牌**
3. 权限选择：**AI Gateway → 编辑**
4. 账户范围选择你的账号
5. 创建并复制 token

> 注意：Cloudflare AI Gateway 的"已验证的网关"在某些账号上可能出现 token 被拒绝的情况（`Authentication Fails (governor)`）。如果反复配置 token 仍无法通过，可以直接关闭该选项，代码会自动回退到用 DeepSeek key 访问 Gateway。

如果是 staging 或 production 环境，按需加上对应的 `--env`：

```bash
npx wrangler secret put DEEPSEEK_API_KEY --env production
npx wrangler secret put AI_GATEWAY_ACCOUNT_ID --env production
npx wrangler secret put AI_GATEWAY_NAME --env production
# 仅在开启验证时设置
npx wrangler secret put AI_GATEWAY_API_TOKEN --env production
```

## 每个字段是什么意思

| 字段 | 含义 | 示例 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 你的 DeepSeek provider key。不要粘贴到代码、文档或聊天里。 | `sk-...` |
| `AI_GATEWAY_ACCOUNT_ID` | 你的 Cloudflare account ID，不是 API key。 | `0123456789abcdef...` |
| `AI_GATEWAY_NAME` | 你创建的 gateway slug/name。 | `eu-tax-saas` |
| `AI_GATEWAY_API_TOKEN` | 当 Gateway 开启"已验证的网关"时使用。Cloudflare API Token，不是 DeepSeek key。 | `eyJ...` 或长串随机字符 |

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

## 用户问答端点 `POST /api/rag/qa`

Wave 2 新增的 `/api/rag/qa` 会：

1. 用 BGE-M3 把用户问题 embedding。
2. 从 Vectorize 检索相关税法 chunk（按 jurisdiction/taxYear 过滤）。
3. 从 KV 读取完整文本。
4. 把上下文塞进 system prompt，通过 AI Gateway 调用 DeepSeek。
5. 返回 `{ ok, answer, citations[], usage }`。

请求示例：

```bash
curl -X POST http://localhost:8787/api/rag/qa \
  -H 'Content-Type: application/json' \
  -H "Cookie: <your-session-cookie>" \
  -d '{
    "question": "What is the Spanish IRPF general tax base?",
    "jurisdiction": "ES",
    "taxYear": 2025
  }'
```

约束：

- 必须登录（`session` cookie）。
- 每用户 60 秒最多 5 次请求（D1 限流）。
- 如果检索不到相关上下文，返回 `422 { ok: false, error: "no-context" }`，避免无根据回答。

## 和 Vectorize 的关系

AI Gateway 不生成 embedding，也不存储向量。F5 RAG 的分工是：

1. Workers AI BGE-M3 生成 embedding。
2. Vectorize 存储和查询 embedding。
3. DeepSeek 通过 AI Gateway，基于检索出来的上下文回答用户问题。

另见：`F5-VECTORIZE-SETUP.md` 和 `CLOUDFLARE-SETUP-OVERVIEW.md`。
