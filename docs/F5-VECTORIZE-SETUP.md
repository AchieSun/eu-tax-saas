# F5 Vectorize Setup — Tax-Law RAG Index

This is the Cloudflare-side setup you need to operate from your own Cloudflare account. The codebase currently keeps the Vectorize binding commented until the index exists remotely.

## What this resource does

Vectorize stores embeddings for official tax-law chunks from:

- BOE / Agencia Tributaria (Spain)
- Portal das Finanças / gov.pt (Portugal)
- HMRC / legislation.gov.uk (UK)
- Belastingdienst / wetten.overheid.nl (Netherlands)
- gesetze-im-internet / BMF (Germany)
- EUR-Lex / Your Europe (EU)

W5-F5 Wave 1 emits JSONL chunks with `vector: null`. Wave 2 will compute Workers AI BGE-M3 embeddings and upsert them into this index.

## One-time Cloudflare commands

Run from `app/` after logging in with `npx wrangler login`:

```bash
npx wrangler vectorize create tax-law --dimensions=1024 --metric=cosine
npx wrangler vectorize list-indexes
```

Why 1024 dimensions: the architecture decision is Workers AI BGE-M3 embeddings, which produce 1024-dimensional vectors. The similarity metric is cosine.

## Wrangler binding to enable after creation

In `wrangler.toml`, uncomment this block only after the index exists:

```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "tax-law"
```

After uncommenting, add this to `src/api/index.ts` when we wire Wave 2 runtime ingestion/query:

```ts
VECTORIZE: VectorizeIndex;
```

Do not uncomment the binding before Cloudflare has the index, because `wrangler deploy --dry-run` can fail when a binding points to a missing resource.

## Local development note

Cloudflare Vectorize is a remote Cloudflare resource. There is no full local Vectorize emulator in this project yet. For Wave 1, use the local JSONL output:

```bash
pnpm ingest:tax-law -- --dry-run --jurisdiction ES --limit 2
pnpm ingest:tax-law -- --jurisdiction ES --limit 1 --out data/tax-law-chunks
```

For real crawling, set a contact email first:

```bash
export EU_TAX_SAAS_BOT_CONTACT="you@example.com"
```

PowerShell:

```powershell
$env:EU_TAX_SAAS_BOT_CONTACT = "you@example.com"
```

## What you need to give me after setup

Please send these values back to me:

| Field | Example | Where to find it |
| --- | --- | --- |
| Vectorize index name | `tax-law` | The name you used in `wrangler vectorize create` |
| Cloudflare account ID | `0123456789abcdef...` | Dashboard right sidebar / Workers overview |
| Confirmation index exists | `yes` | Output of `npx wrangler vectorize list-indexes` |
| Confirmation Workers AI is enabled | `yes` | Workers & Pages → AI / existing `[ai] binding = "AI"` |

## Wave 2 mapping

Each Wave 1 JSONL line already matches the future upsert shape:

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

Wave 2 will replace `vector: null` with `env.AI.run('@cf/baai/bge-m3', { text })` output and call `env.VECTORIZE.upsert(...)`.

## Safety rules

- Do not crawl arbitrary URLs. The crawler only accepts hosts in `src/services/rag/types.ts`.
- Do not upload secrets to Git.
- Keep the source manifest curated and official-only.
- Use one index per semantic embedding model. If we change from BGE-M3 to another model with different dimensions, create a new Vectorize index.
