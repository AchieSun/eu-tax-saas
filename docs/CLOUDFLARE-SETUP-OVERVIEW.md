# Cloudflare 从零设置总入口

这份文档是你真正应该先看的 Cloudflare 操作入口。它按顺序说明：先注册账号和登录 Wrangler，再创建本项目需要的 D1、KV、R2、Queue、Vectorize、AI Gateway，最后设置 secrets、准备域名/环境、执行迁移并验证部署。

> `../../CLOUDFLARE_WORKERS_REFERENCE.md` 是工程实现参考，不是从零操作手册。你现在先按本文档和两份 F5 专项文档操作即可。

## 0. 你需要准备什么

- 一个 Cloudflare 账号。没有账号就不能创建 Workers、D1、R2、Vectorize 或 AI Gateway。
- 本机已有 Node.js 和 pnpm。本项目已把 Wrangler 放在依赖里，所以优先使用 `npx wrangler ...` 或项目脚本，不需要全局安装 Wrangler。
- 一个 DeepSeek API key。它只通过 `wrangler secret put DEEPSEEK_API_KEY` 输入，不要发到聊天或提交到 Git。
- 一个正式域名或准备购买/接入 Cloudflare 的域名。没有正式域名也可以先用 `workers.dev` 验证，但生产登录回调和支付 webhook 最好使用固定自定义域名。

## 1. 注册 / 登录 Cloudflare

1. 打开 Cloudflare Dashboard：<https://dash.cloudflare.com/>
2. 如果没有账号，点击注册并完成邮箱验证。免费套餐即可开始。
3. 登录后进入你的 Cloudflare Account。
4. 找到 Cloudflare Account ID，后面 AI Gateway、CI token 和文档回传都要用。

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
| 8 | 自定义域名 / route | 例如 `eu-tax-saas.com` | 登录回调、支付 webhook、正式访问入口 | 生产前必须 |

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

如果你后面要严格区分 staging/production，建议再创建一个 preview 或 staging namespace，并在 `wrangler.toml` 的 `[env.staging]` 下单独配置，避免测试缓存污染生产环境。

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

## 11. 准备域名、DNS 和 APP_URL

生产部署前要决定正式访问地址，因为登录回调、cookie domain、支付 webhook 和邮件链接都会依赖它。

推荐准备：

| 环境 | Worker name | 推荐 URL | 当前 `wrangler.toml` |
| --- | --- | --- | --- |
| 本地 | `eu-tax-saas` | `http://localhost:8787` | `[vars].APP_URL` |
| Staging | `eu-tax-saas-staging` | `https://staging.eu-tax-saas.com` | `[env.staging.vars].APP_URL` |
| Production | `eu-tax-saas-prod` | `https://eu-tax-saas.com` | `[env.production.vars].APP_URL` |

你需要在 Cloudflare Dashboard 里完成其中一种方式：

1. **先用 workers.dev 验证**：适合早期 smoke test，不需要立刻配置 DNS，但 URL 后面可能要换。
2. **添加 Custom Domain**：Workers & Pages → 你的 Worker → Settings → Domains & Routes → Add Custom Domain，适合 `staging.eu-tax-saas.com` / `eu-tax-saas.com`。
3. **配置 Route**：适合已有 zone 且希望路径级路由，例如 `eu-tax-saas.com/*`。

如果域名不在 Cloudflare：先把域名接入 Cloudflare DNS，或至少把需要的子域名 CNAME 到 Cloudflare 指定目标。最终生产前，`APP_URL` 必须和真实访问域名一致；否则 Better Auth 回调、cookie、CORS 或支付 webhook 可能出现“本地能用、线上登录/支付失败”的问题。

## 12. 设置 secrets

在 `app/` 目录运行。开发默认环境：

```bash
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put AI_GATEWAY_ACCOUNT_ID
npx wrangler secret put AI_GATEWAY_NAME
npx wrangler secret put BETTER_AUTH_SECRET
```

Staging 环境要单独设置：

```bash
npx wrangler secret put DEEPSEEK_API_KEY --env staging
npx wrangler secret put AI_GATEWAY_ACCOUNT_ID --env staging
npx wrangler secret put AI_GATEWAY_NAME --env staging
npx wrangler secret put BETTER_AUTH_SECRET --env staging
```

Production 环境也要单独设置：

```bash
npx wrangler secret put DEEPSEEK_API_KEY --env production
npx wrangler secret put AI_GATEWAY_ACCOUNT_ID --env production
npx wrangler secret put AI_GATEWAY_NAME --env production
npx wrangler secret put BETTER_AUTH_SECRET --env production
```

后续接入支付后，还需要按实际支付供应商设置：

```bash
npx wrangler secret put PADDLE_API_KEY --env production
npx wrangler secret put PADDLE_WEBHOOK_SECRET --env production
npx wrangler secret put CREEM_API_KEY --env production
```

注意：

- `BETTER_AUTH_SECRET` 建议使用 32 字符以上随机字符串，并且 staging/production 不要共用。
- 不要把 secret 值直接写进命令、文档、截图或 Git。`wrangler secret put` 会让你在交互提示里粘贴密钥值。
- `.dev.vars`、`.env`、`.env.local` 已在 `.gitignore`，只能用于本地，不要提交。

## 13. 部署前迁移和验证顺序

建议每次上线都按这个顺序走，避免“代码已部署但数据库结构没跟上”：

1. 确认 `wrangler.toml` 里的 D1/KV/R2/Queue/Vectorize binding 都已指向正确环境。
2. 运行类型检查和 dry-run bundle：

```bash
pnpm build
```

当前 `pnpm build` 会执行：

```bash
tsc --noEmit && wrangler deploy --dry-run --outdir=dist
```

3. 应用远端 D1 migrations：

```bash
pnpm db:migrate:remote
```

4. 先部署 staging：

```bash
pnpm deploy:staging
```

5. 用 staging 域名做 smoke test：打开首页、登录/退出、调用一次 AI 问答或健康路径、确认 Cloudflare Dashboard 没有明显错误。
6. 再部署 production：

```bash
npx wrangler deploy --env production
```

目前 `package.json` 只有 `deploy:staging`，没有 `deploy:production` 脚本，所以生产部署先用上面的 Wrangler 命令。后面如果你希望统一脚本，可以再加 `deploy:production`。

## 14. 观测、日志和回滚准备

上线前至少知道怎么排错和回滚：

- Workers 日志：Cloudflare Dashboard → Workers & Pages → 对应 Worker → Logs / Observability。
- 终端实时日志：

```bash
npx wrangler tail --env staging
npx wrangler tail --env production
```

- AI Gateway 日志：Dashboard → AI → AI Gateway → `eu-tax-saas`，查看 DeepSeek 请求、错误、缓存和用量。
- D1 数据：Dashboard → Workers & Pages → D1，或用 `npx wrangler d1 execute ... --remote` 只读检查。
- 回滚：Dashboard → 对应 Worker → Deployments / Versions，选择上一个稳定版本 rollback。回滚代码不等于回滚 D1 schema，所以生产 migrations 要谨慎。

## 15. CI/CD token 准备（可选但建议）

本地部署可以先不用 CI/CD。准备自动部署时，在 Cloudflare Dashboard 创建 API token：

1. 打开 **My Profile → API Tokens → Create Token**。
2. 使用 Edit Cloudflare Workers 模板，或自定义最小权限 token。
3. 至少需要 Workers deploy 相关权限；如果 CI 还要执行 D1 migrations、KV/R2 操作，需要额外授权对应资源。
4. 把 token 存到 GitHub Actions secrets，建议名称：`CLOUDFLARE_API_TOKEN`。
5. 同时保存非密钥 `CLOUDFLARE_ACCOUNT_ID`。

不要把 Cloudflare API token 发到聊天或写进仓库。等我们要做 GitHub Actions 自动部署时，再把 workflow 单独补上。

## 16. 成本、限额和告警

Cloudflare 免费/低价资源都有配额。上线前建议在 Dashboard 看一遍：

- Workers requests / CPU time：当前 `wrangler.toml` 有 `cpu_ms = 50`，复杂 AI/RAG 请求不要在单次 Worker 里做过多同步工作。
- D1 reads/writes/storage：RAG ingest、用户会话和支付回调都可能增加写入。
- R2 storage / Class A/B operations：PDF 上传和下载会产生成本。
- Queues operations：异步任务量上来后要看消费失败和重试。
- Vectorize dimensions/storage/query：`tax-law` 使用 1024 维 cosine，后续批量 ingest 前先估算 chunk 数。
- Workers AI / AI Gateway / DeepSeek：Cloudflare 侧看 Gateway 日志，DeepSeek 侧看实际账单。

建议生产前设置账单提醒或预算提醒，避免 RAG/AI 调用异常放大费用。

## 17. 你完成后需要发给我的信息

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
| Staging URL | `https://staging.eu-tax-saas.com` 或 workers.dev URL |
| Production URL | `https://eu-tax-saas.com` 或暂定 workers.dev URL |
| 确认 secrets 已设置 | `DEEPSEEK_API_KEY / BETTER_AUTH_SECRET 已设置` |

不要发：DeepSeek API key、Cloudflare API token、R2 Secret Access Key、Better Auth secret、支付平台 secret。

## 18. 上线前最终 checklist

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
- [ ] staging / production 域名或 workers.dev URL 已决定
- [ ] `APP_URL` 已和真实 staging / production URL 对齐
- [ ] `DEEPSEEK_API_KEY` / `AI_GATEWAY_ACCOUNT_ID` / `AI_GATEWAY_NAME` 已按环境设置为 secrets
- [ ] `BETTER_AUTH_SECRET` 已按环境设置为 secrets
- [ ] 支付相关 secrets 已在接入支付前设置
- [ ] `pnpm build` 通过
- [ ] `pnpm db:migrate:remote` 已在部署前执行
- [ ] `pnpm deploy:staging` 通过，staging smoke test 通过
- [ ] `npx wrangler deploy --env production` 通过
- [ ] 知道如何查看 Workers logs / AI Gateway logs
- [ ] 知道如何在 Dashboard 回滚 Worker 版本
- [ ] 已检查 Cloudflare / DeepSeek 成本和限额

## 19. 相关文档

- `F5-VECTORIZE-SETUP.md`：Vectorize / 税法 RAG index 专项步骤。
- `F5-AI-GATEWAY-SETUP.md`：AI Gateway / DeepSeek 路由专项步骤。
- `../../CLOUDFLARE_WORKERS_REFERENCE.md`：工程实现参考，不是从零操作入口。
- `../../docs/12-deployment-guide.md`：更大的部署规划文档，部分资源名可能早于当前 `wrangler.toml`，以本文档为准。

---

## 20. 上线就绪补充项（Launch Readiness）

> 以下章节不是 Cloudflare 资源创建本身，而是上线前后必须考虑的工程与合规项。基础 Cloudflare 资源（1–19 节）做完后，再按下面逐项推进。状态标记说明：
>
> - `[必需]`：上线前必须完成，否则线上会出现严重问题（数据丢失、合规风险、无法收款等）。
> - `[推荐]`：上线后近期内应完成，影响可观测性、可维护性、应急能力。
> - `[计划中]`：目前未实现，后续 milestone 才会接入，记录在此避免遗漏。

### 20.1 监控与告警：Sentry / PostHog `[推荐]` / `[计划中]`

- Sentry：用于 Workers 端错误聚合、source map 解析、告警通知。当前代码尚未接入 `@sentry/cloudflare`，属于 `[计划中]`。接入时需要新增 secret `SENTRY_DSN`（通过 `wrangler secret put SENTRY_DSN` 设置，按 env 分别设置 staging / production）。
- PostHog：用于前端事件、漏斗、留存分析。如果走前端直连，公开 key 通过 `[vars]` 注入即可；如果走后端代理，则需要 `POSTHOG_API_KEY` 作为 secret，目前同样属于 `[计划中]`。
- 在没有 Sentry 之前，错误观测先依赖 `npx wrangler tail`、Cloudflare Dashboard Logs 和 AI Gateway 日志（见 14 节）。

### 20.2 上线相关 Secrets 补充 `[必需]` / `[推荐]`

第 12 节列出了核心 secrets。下列为上线节奏中要陆续追加的：

| Secret | 用途 | 状态 | 设置方式 |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | Resend 发送邮件（验证码、通知、PDF 邮件投递） | `[必需]` 上线前 | `npx wrangler secret put RESEND_API_KEY --env production` |
| `SENTRY_DSN` | Sentry 错误上报 | `[推荐]` 接入 Sentry 时 | `npx wrangler secret put SENTRY_DSN --env production` |
| `PADDLE_API_KEY` / `PADDLE_WEBHOOK_SECRET` | Paddle 支付 | `[必需]` 接入支付前 | 见 20.6 |

> 不要把上面任何值写进文档、提交到 Git、或贴到聊天。所有 secret 仅通过 `wrangler secret put` 在本机交互输入。

### 20.3 D1 备份与恢复 `[必需]`

- 定期 export：使用 `npx wrangler d1 export eu-tax-saas-db --remote --output=backups/eu-tax-saas-db-YYYYMMDD.sql`，把导出文件放到安全的离线存储（不要进 Git）。
- 建议至少每天一次 production 导出，重大 schema 迁移前手动导出一次。
- 恢复演练：在 staging D1 上执行一次 `wrangler d1 execute eu-tax-saas-db --remote --file=backups/xxx.sql` 验证可用，避免真正故障时第一次才用。
- 迁移注意：D1 schema 变更通过 `drizzle/migrations` 管理，应用前确认 migration 不会丢失列或破坏已有数据；回滚 Worker 代码不会自动回滚 D1 schema。

### 20.4 R2 生命周期与对象治理 `[推荐]`

- 在 Cloudflare Dashboard → R2 → `eu-tax-saas-pdfs` → **Object lifecycle** 配置规则。建议：
  - `tmp/` 前缀：保留 7 天后自动删除（临时上传、未完成的解析任务）。
  - `generated/` 前缀：根据业务保留期（例如 90 天或按计费方案）后归档或删除。
  - 失败任务残留：用统一前缀（如 `failed/`）并设置较短保留期。
- 大文件统一走 multipart upload；不要把 R2 当无限网盘，关注 Class A / Class B 操作次数（见 16 节）。

### 20.5 CI/CD 与 GitHub Actions Token `[推荐]`

15 节已说明手动准备 Cloudflare API token。落地 GitHub Actions 时补充：

- Repository → Settings → Secrets and variables → Actions 中存放：
  - `CLOUDFLARE_API_TOKEN`：最小权限（Workers Scripts Edit；如需 D1/KV/R2 操作再分别授权）。
  - `CLOUDFLARE_ACCOUNT_ID`：非密钥，但同样建议放 Secrets。
- workflow 中区分 staging / production job，只有 `main` 分支或带 release tag 才允许部署到 production。
- D1 migrations 在部署 step 之前执行：`pnpm db:migrate:remote`（按 env 切换 wrangler 参数）。
- 不要在 workflow 日志里 echo 任何 secret；token 一旦泄漏立即在 Dashboard 撤销并重建。

### 20.6 Paddle Sandbox → Production 切换 `[必需]`

接入支付按下面顺序，避免线上误扣或 webhook 静默失败：

1. **Sandbox 阶段**：先在 Paddle Sandbox 注册产品、价格、Webhook endpoint（指向 staging Worker，例如 `https://staging.eu-tax-saas.com/api/webhooks/paddle`）。
2. Secret 设置：
   ```bash
   npx wrangler secret put PADDLE_API_KEY --env staging
   npx wrangler secret put PADDLE_WEBHOOK_SECRET --env staging
   ```
3. Webhook 测试：使用 Paddle Dashboard 的 “Send test event” 触发 `subscription.created` / `transaction.completed` 等事件，确认 staging Worker 200 响应且写入 D1。配合 `npx wrangler tail --env staging` 观察日志。
4. 校验签名：webhook handler 必须用 `PADDLE_WEBHOOK_SECRET` 校验签名，不要只看请求来源 IP。
5. **切到 Production**：在 Paddle 切换为 Live 模式，重新生成正式 API key 和 webhook secret，分别 `--env production` 写入；webhook URL 指向 `https://eu-tax-saas.com/api/webhooks/paddle`。
6. 小额真实交易验证：用真实卡完成一笔最低价订单，确认订阅状态、发票、退款流程，再开放给用户。

### 20.7 应急响应流程 `[必需]`

线上出问题时按这个顺序，不要边查边猜：

1. **判断影响面**：通过 Dashboard Logs / `wrangler tail` / AI Gateway 日志 / 用户反馈，确认是全量故障还是局部。
2. **决定回滚 vs 修复**：
   - 全量、关键路径（登录、支付、AI 核心）故障 → 立即 Dashboard → Worker → Deployments → Rollback 到上一个稳定版本。
   - 局部、非关键问题 → 评估能否在 30 分钟内 hotfix，否则也回滚。
3. **数据一致性检查**：回滚 Worker 不会回滚 D1 schema。如果故障期间已发生 schema 迁移，需要单独评估是否要手动修复数据或前向兼容。
4. **对外沟通**：影响付费用户时，发布 status 公告（邮件 / 站内 / status page）。
5. **事后复盘**：24 小时内写 post-mortem，记录 timeline、根因、改进项，并把改进项放进下一个 sprint。
6. **支付侧特别注意**：Paddle webhook 重试机制存在，回滚或修复完成后检查未处理事件，避免漏单或重复入账。

### 20.8 法律合规与同意管理 `[必需]`

面向欧洲用户必须具备：

- **Privacy Policy（隐私政策）**：明确数据收集范围、保留期、第三方处理者（Cloudflare / DeepSeek / Resend / Paddle 等）、用户权利（访问、删除、可携带）。
- **Terms of Service（服务条款）**：服务边界、SLA（如有）、AI 输出免责声明（"非法律或税务专业意见，仅供参考"）、退款政策。
- **Cookie / 同意管理**：欧洲 GDPR 要求严格意义上的明确同意（opt-in）。至少区分必要 cookie（登录 session）与分析/广告 cookie；分析类（如 PostHog）需要用户同意后再加载。
- **数据处理协议（DPA）**：与 Cloudflare、DeepSeek、Resend、Paddle 等签署或确认其标准 DPA，公司主体在 EEA 外时还要关注 SCC（Standard Contractual Clauses）。
- 上述法律文本建议律师 review，不要直接复制其他网站。

### 20.9 端到端测试与 AI 验证 `[推荐]`

- **E2E**：使用 Playwright 覆盖关键用户路径（注册/登录、上传 PDF、生成报告、订阅支付）。在 CI 中针对 staging 跑 smoke E2E；本地用 `pnpm test:e2e`（脚本接入后再补）。
- **F4 / 幻觉验证**：RAG + AI 输出需要持续验证答案是否引用了正确的税法条款，避免幻觉对用户造成实际损失。建议建立：
  - 一份固定的 evaluation set（典型问题 + 期望引用 + 期望结论方向）。
  - 每次模型或 prompt 改动后跑一遍，回归对比。
  - 生产抽样审查：定期人工抽查 AI Gateway 日志中的一部分回答。
- 测试和评估通过前，不要把新模型/新 prompt 推到 production 默认路径。

### 20.10 本节定位

> 20.x 系列是**上线就绪补充项**，不属于"创建 Cloudflare 资源"这一基础范畴。1–19 节做完只能保证项目能跑起来，20.x 做完才能让项目以可观测、可恢复、可合规、可收款的状态正式对外。

