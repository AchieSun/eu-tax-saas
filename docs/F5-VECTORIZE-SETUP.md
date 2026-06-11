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

W5-F5 Wave 1 只生成 `vector: null` 的 JSONL 文本切块。Wave 2 会用 Workers AI 的 BGE-M3 模型生成 1024 维 embedding，并写入这个 Vectorize index。

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

## 创建成功后再启用 Wrangler binding

确认 Cloudflare 远端已经存在 `tax-law` index 后，再打开 `wrangler.toml` 里的这一段：

```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "tax-law"
```

等我们做 Wave 2 的运行时入库/检索时，再在 `src/api/index.ts` 的 Bindings 里加入：

```ts
VECTORIZE: VectorizeIndex;
```

注意：不要在 Cloudflare index 创建前取消注释。否则 `wrangler deploy --dry-run` 可能因为 binding 指向不存在的远端资源而失败。

## 本地开发说明

Cloudflare Vectorize 是远端 Cloudflare 资源；当前项目还没有完整的本地 Vectorize 模拟器。Wave 1 阶段先使用本地 JSONL 输出验证爬虫和切块：

```bash
pnpm ingest:tax-law -- --dry-run --jurisdiction ES --limit 2
pnpm ingest:tax-law -- --jurisdiction ES --limit 1 --out data/tax-law-chunks
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

## Wave 2 如何使用这些数据

Wave 1 生成的每一行 JSONL 已经接近未来 upsert 的形状：

```json
{
  "id": "sha256...",
  "text": "official tax law chunk",
  "metadata": {
    "jurisdiction": "ES",
    "taxYear": 2025,
    "topic": "irpf-personal-income-tax",
    "sourceUrl": "https://www.boe.es/..."
  },
  "vector": null
}
```

Wave 2 会把 `vector: null` 替换成 `env.AI.run('@cf/baai/bge-m3', { text })` 的输出，然后调用 `env.VECTORIZE.upsert(...)` 写入 Vectorize。

## 安全规则

- 从零开始的 Cloudflare 总流程见 `CLOUDFLARE-SETUP-OVERVIEW.md`。
- 不要爬任意 URL；爬虫只接受 `src/services/rag/types.ts` 里 allow-list 的官方 host。
- 不要把任何 secret、API key、token 提交到 Git。
- `data/tax-law-sources.yml` 只维护官方、公开、可验证来源。
- 一个 embedding 模型对应一个 Vectorize index。如果以后从 BGE-M3 换成不同维度的模型，要新建 index，不要复用旧 index。
