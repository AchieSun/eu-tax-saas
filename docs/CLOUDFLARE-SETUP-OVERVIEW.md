# Cloudflare 从零设置总入口

这份文档是你真正应该先看的 Cloudflare 操作入口。它按顺序说明：先注册账号和登录 Wrangler，再创建本项目需要的 D1、KV、R2、Queue、Vectorize、AI Gateway，最后设置 secrets 并验证部署。

> `../../CLOUDFLARE_WORKERS_REFERENCE.md` 是工程实现参考，不是从零操作手册。你现在先按本文档和两份 F5 专项文档操作即可。

## 0. 你需要准备什么

- 一个 Cloudflare 账号。没有账号就不能创建 Workers、D1、R2、Vectorize 或 AI Gateway。
- 本机已有 Node.js 和 pnpm。本项目已把 Wrangler 放在依赖里，所以优先使用 `npx wrangler ...` 或项目脚本，不需要全局安装 Wrangler。
- 一个 DeepSeek API key。它只通过 `wrangler secret put DEEPSEEK_API_KEY` 输入，不要发到聊天或提交到 Git。

## 1. 注册 / 登录 Cloudflare

1. 打开 Cloudflare Dashboard：<https://dash.cloudflare.com/>
2. 如果没有账号，点击注册并完成邮箱验证。免费套餐即可开始。
3. 登录后进入你的 Cloudflare Account。
4. 找到 Cloudflare Account ID，后面 AI Gateway 和文档回传都要用。

获取 Account ID 的常见方式：

- Dashboard 账户首页：账户名称右侧菜单通常有 **Copy account ID**。
- Workers & Pages 页面：右侧或概览区域通常会显示 Account details。
- Wrangler 登录后运行：

```bash
npx wrangler whoami
```

## 2. 登录 Wrangler

在项目的 `app/` 目录运行：

```bash
npx wrangler login
```

Wrangler 会打开浏览器进行 Cloudflare OAuth 授权。授权成功后回到终端，运行下面命令确认登录状态：

```bash
npx wrangler whoami
```

如果浏览器没有自动打开，复制终端输出的登录 URL 到浏览器手动授权。

## 3. 本项目需要创建哪些 Cloudflare 资源

| 顺序 | 资源 | 本项目名称 | 用途 | 是否现在必须 |
| --- | --- | --- | --- | --- |
| 1 | D1 database | `eu-tax-saas-db` | 主数据库 | 部署前必须 |
| 2 | KV namespace | `KV` binding | Better Auth / rate limit 缓存 | 部署前必须 |
| 3 | R2 bucket | `eu-tax-saas-pdfs` | PDF 模板和生成文件 | PDF 功能必须 |
| 4 | Queue | `eu-tax-saas-jobs` | 异步任务 | 部署前建议创建 |
| 5 | Workers AI binding | `AI` | BGE-M3 embedding / Workers AI | 已在 `wrangler.toml` 配好 binding |
| 6 | Vectorize index | `tax-law` | 税法 RAG 向量索引 | F5 Wave 2 前必须 |
| 7 | AI Gateway | `eu-tax-saas` | DeepSeek 请求代理、日志、缓存 | 生产建议 |

## 4. 创建 D1 database

在 `app/` 目录运行：

```bash
npx wrangler d1 create eu-tax-saas-db
```

Cloudflare 会返回一个 `database_id`。把它填进 `app/wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "eu-tax-saas-db"
database_id = "这里替换成 Cloudflare 返回的 database_id"
migrations_dir = "drizzle/migrations"
```

创建后应用远端 migrations：

```bash
npx wrangler d1 migrations apply eu-tax-saas-db --remote
```

本地开发如果需要本地 D1，也可以运行：

```bash
npx wrangler d1 migrations apply eu-tax-saas-db --local
```

## 5. 创建 KV namespace

在 `app/` 目录运行：

```bash
npx wrangler kv namespace create KV
```

Cloudflare 会返回一个 `id`。把它填进 `app/wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "KV"
id = "这里替换成 Cloudflare 返回的 id"
```

注意：`binding = "KV"` 不要改，因为代码里按 `env.KV` 使用。

## 6. 创建 R2 bucket

在 `app/` 目录运行：

```bash
npx wrangler r2 bucket create eu-tax-saas-pdfs
```

`app/wrangler.toml` 里已经有 binding：

```toml
[[r2_buckets]]
binding = "R2"
bucket_name = "eu-tax-saas-pdfs"
```

如果你要使用 `scripts/ingest-pdf.ts` 这类本地上传脚本，还需要在 Cloudflare Dashboard 里创建 R2 API token：

1. 打开 Cloudflare Dashboard。
2. 进入 **R2 → Manage R2 API Tokens**。
3. 创建 token，权限选择 Object Read & Write，并限制到 `eu-tax-saas-pdfs` bucket。
4. 保存 `Access Key ID` 和 `Secret Access Key`。这些是本地环境变量，不要提交到 Git。

## 7. 创建 Queue

在 `app/` 目录运行：

```bash
npx wrangler queues create eu-tax-saas-jobs
```

`app/wrangler.toml` 已经配置了 producer 和 consumer：

```toml
[[queues.producers]]
binding = "QUEUE"
queue = "eu-tax-saas-jobs"

[[queues.consumers]]
queue = "eu-tax-saas-jobs"
```

## 8. Workers AI binding

`app/wrangler.toml` 已经配置：

```toml
[ai]
binding = "AI"
```

代码里会通过 `env.AI` 使用 Workers AI。后续 F5 Wave 2 会用 Workers AI BGE-M3 生成 embedding，再写入 Vectorize。

## 9. 创建 Vectorize index

详细步骤见：`F5-VECTORIZE-SETUP.md`。

最关键命令是：

```bash
npx wrangler vectorize create tax-law --dimensions=1024 --metric=cosine
npx wrangler vectorize list
```

确认 `tax-law` 存在后，再取消 `app/wrangler.toml` 里的 Vectorize binding 注释：

```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "tax-law"
```

不要在 index 创建前取消注释，否则 `wrangler deploy --dry-run` 可能失败。

## 10. 创建 AI Gateway

详细步骤见：`F5-AI-GATEWAY-SETUP.md`。

推荐走 Dashboard：

1. 打开 Cloudflare Dashboard。
2. 进入 **AI → AI Gateway**。
3. 点击创建 Gateway。
4. 名称建议用 `eu-tax-saas`。
5. 保存 gateway name/slug 和 Cloudflare Account ID。

注意：AI Gateway 不等于 Workers AI。AI Gateway 负责代理 DeepSeek 请求；Workers AI 负责生成 embedding。

## 11. 设置 secrets

在 `app/` 目录运行：

```bash
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put AI_GATEWAY_ACCOUNT_ID
npx wrangler secret put AI_GATEWAY_NAME
```

如果要部署生产环境，使用：

```bash
npx wrangler secret put DEEPSEEK_API_KEY --env production
npx wrangler secret put AI_GATEWAY_ACCOUNT_ID --env production
npx wrangler secret put AI_GATEWAY_NAME --env production
```

后续生产还会需要其他业务 secret，例如：

```bash
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put PADDLE_API_KEY
npx wrangler secret put PADDLE_WEBHOOK_SECRET
npx wrangler secret put CREEM_API_KEY
```

不要把 secret 值直接写进命令、文档、截图或 Git。`wrangler secret put` 会让你在交互提示里粘贴密钥值。

## 12. 验证

先验证构建和 binding 配置：

```bash
pnpm build
```

当前 `pnpm build` 会执行 TypeScript 检查和 `wrangler deploy --dry-run --outdir=dist`。

如果只是想直接跑 Wrangler dry-run：

```bash
npx wrangler deploy --dry-run --outdir=dist
```

本地开发：

```bash
pnpm dev
```

如果需要连接远端 Cloudflare 资源，可以使用：

```bash
npx wrangler dev --remote
```

## 13. 你完成后需要发给我的信息

请只发非密钥信息：

| 信息 | 示例 |
| --- | --- |
| Cloudflare Account ID | `0123456789abcdef...` |
| D1 database name / id | `eu-tax-saas-db` / `...` |
| KV namespace id | `...` |
| R2 bucket name | `eu-tax-saas-pdfs` |
| Queue name | `eu-tax-saas-jobs` |
| Vectorize index name | `tax-law` |
| AI Gateway name | `eu-tax-saas` |
| 确认 DeepSeek secret 已设置 | `DEEPSEEK_API_KEY 已设置` |

不要发：DeepSeek API key、Cloudflare API token、R2 Secret Access Key、Better Auth secret、支付平台 secret。

## 14. 快速 checklist

- [ ] 已注册 / 登录 Cloudflare Dashboard
- [ ] 已在 `app/` 运行 `npx wrangler login`
- [ ] `npx wrangler whoami` 能看到账号
- [ ] D1 `eu-tax-saas-db` 已创建，`database_id` 已填入 `wrangler.toml`
- [ ] D1 migrations 已执行
- [ ] KV namespace 已创建，`id` 已填入 `wrangler.toml`
- [ ] R2 bucket `eu-tax-saas-pdfs` 已创建
- [ ] Queue `eu-tax-saas-jobs` 已创建
- [ ] Vectorize index `tax-law` 已创建
- [ ] AI Gateway `eu-tax-saas` 已创建
- [ ] `DEEPSEEK_API_KEY` / `AI_GATEWAY_ACCOUNT_ID` / `AI_GATEWAY_NAME` 已设置为 secrets
- [ ] `pnpm build` 通过

## 15. 相关文档

- `F5-VECTORIZE-SETUP.md`：Vectorize / 税法 RAG index 专项步骤。
- `F5-AI-GATEWAY-SETUP.md`：AI Gateway / DeepSeek 路由专项步骤。
- `../../CLOUDFLARE_WORKERS_REFERENCE.md`：工程实现参考，不是从零操作入口。
- `../../docs/12-deployment-guide.md`：更大的部署规划文档，部分资源名可能早于当前 `wrangler.toml`，以本文档为准。
