# F5 Vectorize 设置指南 — 税法 RAG 索引

这份文档只讲 F5 税法 RAG 的 Vectorize index 设置。如果你还没有 Cloudflare 账号、还没登录 Wrangler，先看总入口：`CLOUDFLARE-SETUP-OVERVIEW.md`。当前代码里 `wrangler.toml` 的 Vectorize binding 先保持注释状态，等远端索引创建成功后再打开，避免部署时绑定到不存在的资源。

## 这个资源做什么

Vectorize 用来存储官方税法文本切块后的 embedding，来源包括：

- BOE / Agencia Tributaria（西班牙）
- Portal das Finanças / gov.pt（葡萄牙）
- HMRC / legislation.gov.uk（英国）
- Belastingdienst / wetten.overheid.nl（荷兰）
- gesetze-im-internet / BMF（德国）
- EUR-Lex / Your Europe（欧盟）

W5-F5 Wave 1 生成 `vector: null` 的 JSONL 文本切块。Wave 2 已经实现：使用 `src/services/rag/embedding.ts` 调用 Workers AI BGE-M3 生成 1024 维 embedding，通过 `src/services/rag/vectorize-store.ts` 写入 Vectorize，完整文本同时存入 KV。

## 一次性 Cloudflare 操作命令

先在 `app/` 目录登录 Wrangler：

```bash
npx wrangler login
```

然后创建并确认 Vectorize index：

```bash
npx wrangler vectorize create tax-law --dimensions=1024 --metric=cosine
npx wrangler vectorize list
```

为什么是 1024 维：当前架构决定使用 Workers AI BGE-M3 embedding，它输出 1024 维向量；相似度指标使用 cosine。

## 创建 metadata 索引（过滤必需）

`POST /api/rag/qa` 会按 `jurisdiction`、`taxYear`、`topic`、`lang`、`authority` 过滤向量。Vectorize 的 metadata filtering 要求这些字段在向量插入前就已经建立 metadata index，否则过滤查询会返回空结果。

在插入任何向量之前，一次性创建以下 metadata indexes：

```bash
npx wrangler vectorize create-metadata-index tax-law --property-name=jurisdiction --type=string
npx wrangler vectorize create-metadata-index tax-law --property-name=taxYear --type=number
npx wrangler vectorize create-metadata-index tax-law --property-name=topic --type=string
npx wrangler vectorize create-metadata-index tax-law --property-name=lang --type=string
npx wrangler vectorize create-metadata-index tax-law --property-name=authority --type=string
```

> 注意：metadata index 是异步生效的，创建后可以用 `npx wrangler vectorize info tax-law` 观察 `processedUpToMutation` 是否推进到最新 changeset。如果过滤查询仍然返回空，通常是因为 metadata index 还没处理完，等待几秒到几分钟后重试即可。

## 创建成功后再启用 Wrangler binding

确认 Cloudflare 远端已经存在 `tax-law` index 后，再打开 `wrangler.toml` 里的这一段：

```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "tax-law"
```

创建成功后，`wrangler.toml` 中对应的 binding 已经启用，`src/api/index.ts` 的 `Bindings` 也已包含 `VECTORIZE: VectorizeIndex`。

注意：如果重新创建 index 或换账号，需要同步更新 `wrangler.toml` 里的 `index_name`，否则 `wrangler deploy --dry-run` 会因为 binding 指向不存在的远端资源而失败。

## 本地开发说明

Cloudflare Vectorize 是远端 Cloudflare 资源；本地开发通过 unit test 中的 stub 验证入库/检索逻辑。Wave 1 的本地 JSONL 输出仍然可用：

```bash
pnpm ingest:tax-law -- --dry-run --jurisdiction ES --limit 2
pnpm ingest:tax-law -- --jurisdiction ES --limit 1 --out data/tax-law-chunks
```

Wave 2 已经把 chunk 直接 upsert 到 Vectorize：

```bash
pnpm dev
# 在另一个终端以 admin 登录并保存 cookie 后
pnpm ingest:tax-law -- --upsert --jurisdiction ES --limit 1 \
  --worker-url http://localhost:8787 \
  --admin-cookie-file ./.tmp/admin.cookie
```

如果要进行真实网页爬取，先设置机器人联系邮箱，方便官方站点识别请求来源：

```bash
export EU_TAX_SAAS_BOT_CONTACT="you@example.com"
```

PowerShell：

```powershell
$env:EU_TAX_SAAS_BOT_CONTACT = "you@example.com"
```

## 你设置完后需要发给我的信息

请把下面这些非密钥信息发给我：

| 字段 | 示例 | 在哪里找 |
| --- | --- | --- |
| Vectorize index name | `tax-law` | 你运行 `wrangler vectorize create` 时使用的名字 |
| Cloudflare account ID | `0123456789abcdef...` | Cloudflare Dashboard 右侧栏 / Workers 概览页 |
| 确认 index 已存在 | `yes` | `npx wrangler vectorize list` 的输出 |
| 确认 Workers AI 已启用 | `yes` | Workers & Pages → AI，或当前已有 `[ai] binding = "AI"` |

不要把 API key、token、secret 发到文档或聊天里。

## Wave 2 架构

入库链路：

```
data/tax-law-sources.yml
  → scripts/ingest-tax-law.ts
    → src/services/rag/crawler.ts (HTML 归一化 + 分块)
      → POST /api/admin/rag/upsert
        → src/services/rag/embedding.ts (BGE-M3)
          → KV (完整文本) + Vectorize (向量 + 元数据)
```

检索/问答链路：

```
POST /api/rag/qa
  → src/services/rag/retrieve.ts
    → embedding query → Vectorize.query → KV.get
      → DeepSeek via AI Gateway
```

核心文件：

- `src/services/rag/embedding.ts` — BGE-M3 embedding 客户端（批量 + 重试）
- `src/services/rag/vectorize-store.ts` — `upsertChunks` / `queryTopK`
- `src/services/rag/chunk-store.ts` — KV 完整文本存储
- `src/services/rag/retrieve.ts` — 检索并拼装上下文
- `src/api/routes/rag-admin.ts` — `POST /api/admin/rag/upsert`
- `src/api/routes/rag.ts` — `POST /api/rag/qa`

## 安全规则

- 从零开始的 Cloudflare 总流程见 `CLOUDFLARE-SETUP-OVERVIEW.md`。
- 不要爬任意 URL；爬虫只接受 `src/services/rag/types.ts` 里 allow-list 的官方 host。
- 不要把任何 secret、API key、token 提交到 Git。
- `data/tax-law-sources.yml` 只维护官方、公开、可验证来源。
- 一个 embedding 模型对应一个 Vectorize index。如果以后从 BGE-M3 换成不同维度的模型，要新建 index，不要复用旧 index。
