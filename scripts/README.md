# ingest-pdf — Tax Form PDF Ingestion CLI

Upload tax form PDFs to Cloudflare R2 and register them in the `form_field_mappings` D1 table.

## Prerequisites

### 1. Install dependencies

```bash
pnpm add -D @aws-sdk/client-s3 tsx
```

### 2. Set environment variables

Get these from your [Cloudflare Dashboard → R2 → Manage R2 API Tokens](https://dash.cloudflare.com/?to=/:account/r2/api-tokens):

| Variable | Description |
|---|---|
| `CF_ACCOUNT_ID` | Your Cloudflare account ID (12+ hex chars) |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET` | R2 bucket name (e.g. `eu-tax-saas-pdfs`) |

> **Note**: The script does NOT validate these variables. If they're missing, it will fail with a clear error message when attempting to upload.

## Usage

### Dry-run (recommended first)

Preview the SHA-256 hash, R2 key, page count, and file size without uploading:

```bash
tsx scripts/ingest-pdf.ts \
  --country DE \
  --year 2024 \
  --form mantelbogen \
  --pdf ./tax-forms/DE/2024/mantelbogen.pdf \
  --dry-run
```

Output:

```json
{
  "sha256": "e3b0c44298fc1c149afbf4c...",
  "r2Key": "tax-forms/DE/2024/mantelbogen.pdf",
  "pageCount": 12,
  "sizeBytes": 284736
}
Dry-run: true
```

### Real upload

Remove `--dry-run` to upload to R2:

```bash
tsx scripts/ingest-pdf.ts \
  --country DE \
  --year 2024 \
  --form mantelbogen \
  --pdf ./tax-forms/DE/2024/mantelbogen.pdf
```

After a successful upload, the script prints a `wrangler d1 execute` command. Copy and run it to register the PDF in the D1 database.

### Examples

#### Germany — Mantelbogen (2024)

```bash
tsx scripts/ingest-pdf.ts \
  --country DE --year 2024 --form mantelbogen \
  --pdf ./tax-forms/DE/2024/mantelbogen.pdf
```

#### Portugal — Modelo 3 (2024)

```bash
tsx scripts/ingest-pdf.ts \
  --country PT --year 2024 --form modelo3 \
  --pdf ./tax-forms/PT/2024/modelo3.pdf
```

#### Netherlands — Aangifte (2024)

```bash
tsx scripts/ingest-pdf.ts \
  --country NL --year 2024 --form aangifte \
  --pdf ./tax-forms/NL/2024/aangifte.pdf
```

## Complete Workflow

1. **Dry-run** — verify the PDF is readable and see its metadata
2. **Upload** — run without `--dry-run` to push to R2
3. **Register** — copy and run the `wrangler d1 execute` command printed by the script
4. **Verify** — check the D1 database:

   ```bash
   npx wrangler d1 execute eu-tax-saas-db --remote \
     --command="SELECT country, form_type, tax_year, pdf_r2_key, pdf_sha256, page_count FROM form_field_mappings WHERE field_name = '__pdf__'"
   ```

## SQL Injection Warning

The generated SQL uses values from CLI arguments. This is a **controlled ingestion tool** run by developers on known PDF files — SQL injection is not a practical risk. However, single quotes in values are escaped (`'` → `''`) as a safety measure.

## Directory Structure

```
tax-forms/
├── DE/
│   └── 2024/
│       └── mantelbogen.pdf
├── PT/
│   └── 2024/
│       └── modelo3.pdf
└── NL/
    └── 2024/
        └── aangifte.pdf
```

The R2 key follows the pattern: `tax-forms/{country}/{year}/{form}.pdf`

## Script Arguments

| Argument | Required | Description |
|---|---|---|
| `--country` | Yes | ISO 3166-1 alpha-2 country code (DE, PT, NL, ES, UK) |
| `--year` | Yes | Tax year (e.g. 2024) |
| `--form` | Yes | Form identifier (e.g. mantelbogen, modelo3, aangifte) |
| `--pdf` | Yes | Path to the local PDF file |
| `--dry-run` | No | Preview metadata without uploading or registering |

## Running Tests

```bash
cd app
npx vitest run scripts/
```

---

# ingest-form-mappings — YAML → D1 Sync (W4 T1.4)

Synchronises every production YAML form mapping
(`app/src/forms/{COUNTRY}/{YEAR}/{form}.yml`) into the `form_field_mappings`
D1 table. Pure SQL emitter: prints idempotent SQL to stdout (or a file).
Does **not** connect to D1 — `wrangler` runs the SQL.

## Usage

```bash
# Print SQL to stdout
pnpm ingest:form-mappings

# Write to a file (status line goes to stderr; stdout stays pure SQL when piped)
pnpm ingest:form-mappings -- --out drizzle/seeds/form-mappings.sql

# Apply to D1 (local)
pnpm ingest:form-mappings -- --out /tmp/forms.sql
npx wrangler d1 execute eu-tax-saas-db --local --file=/tmp/forms.sql

# Apply to D1 (remote) — manual gating, no auto-deploy
npx wrangler d1 execute eu-tax-saas-db --remote --file=/tmp/forms.sql
```

### Flags

| Flag | Default | Description |
|---|---|---|
| `--out <file>` | (stdout) | Write SQL to a file instead of stdout |
| `--forms-root <dir>` | `<scripts>/../src/forms` | Override YAML root (mainly for tests) |

## Workflow

1. Author or edit a YAML mapping at `app/src/forms/<COUNTRY>/<YEAR>/<form>.yml`
2. Run `pnpm test` — the Zod schema in `src/forms/types.ts` validates everything
3. Generate SQL: `pnpm ingest:form-mappings -- --out /tmp/forms.sql`
4. Inspect the SQL (it's small and readable)
5. Apply via `wrangler d1 execute`

## Idempotency

The emitter wraps every run in a single `BEGIN TRANSACTION` / `COMMIT` and
issues one `INSERT ... ON CONFLICT(country, form_type, tax_year, field_name)
DO UPDATE` per field. The conflict key matches the `idx_form_field_unique`
unique index defined in `src/db/schema.ts`. Re-running:

- Inserts new fields
- Updates `data_path`, `field_type`, `page_number`, `x_coord`, `y_coord`,
  `font_size`, `field_kind` from the YAML
- Sets `deleted_at = NULL` so soft-deleted rows are revived
- **Never** touches `pdf_r2_key`, `pdf_sha256`, `page_count` — those are
  owned by the `ingest-pdf` CLI above

## Field-name convention

- AcroForm fields use the YAML `pdfField` value verbatim
- Coordinate fields synthesise `coord_<sourcePath sanitised>` (every
  non-`[a-zA-Z0-9]` char becomes `_`), so they remain addressable under the
  unique index

The row `id` is deterministic: `<country>-<year>-<form>-<fieldName>`.

---

# ingest-tax-law — F5 RAG seed crawler (W5-F5 Wave 1)

Curated official tax-law crawler for the W5-F5 RAG knowledge base. It reads
`data/tax-law-sources.yml`, fetches only allowlisted official sources, normalises
HTML into plain text, chunks it deterministically, and emits JSONL files ready
for the future Vectorize upsert wave.

Wave 1 is **HTML-first**. PDF entries are intentionally skipped until the PDF
parser/upsert wave lands.

## Required environment for real crawls

Real network crawls require a contact email so official sites can identify the
bot operator:

```bash
export EU_TAX_SAAS_BOT_CONTACT="you@example.com"
```

PowerShell:

```powershell
$env:EU_TAX_SAAS_BOT_CONTACT = "you@example.com"
```

Dry-runs do not require this variable and do not make network calls.

## Usage

```bash
# Dry-run first: schema-valid local JSONL, no network
pnpm ingest:tax-law -- --dry-run --jurisdiction ES --limit 2

# Emit dry-run chunks to stdout for inspection
pnpm ingest:tax-law -- --dry-run --jurisdiction EU --limit 1 --out -

# Real crawl of one source into data/tax-law-chunks/ES.jsonl
pnpm ingest:tax-law -- --jurisdiction ES --limit 1 --out data/tax-law-chunks
```

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--jurisdiction ES\|PT\|UK\|NL\|DE\|EU\|ALL` | `ALL` | Filter manifest sources |
| `--out <dir>` | `data/tax-law-chunks` | Output directory; use `-` for stdout |
| `--manifest <path>` | `data/tax-law-sources.yml` | Override source manifest |
| `--dry-run` | `false` | No network; writes one schema-valid stub chunk per source |
| `--limit N` | unlimited | Limit number of selected sources |

## Output schema

Each JSONL line validates against `src/services/rag/types.ts` →
`TaxLawChunkSchema`:

```json
{
  "id": "sha256...",
  "jurisdiction": "ES",
  "sourceUrl": "https://www.boe.es/...",
  "sourceTitle": "Ley 35/2006...",
  "authority": "BOE",
  "taxYear": 2025,
  "topic": "irpf-personal-income-tax",
  "lang": "es",
  "chunkIndex": 0,
  "charCount": 1234,
  "text": "official source text",
  "contentHash": "sha256...",
  "fetchedAt": "2026-06-11T00:00:00.000Z",
  "vector": null
}
```

`vector: null` is intentional in Wave 1. Wave 2 will compute Workers AI BGE-M3
embeddings and call `VECTORIZE.upsert()`.

## Safety

- Do not point this script at arbitrary URLs.
- Only edit `data/tax-law-sources.yml` with public official government sources.
- The runtime host allow-list lives in `src/services/rag/types.ts`.
- No secrets are required for Wave 1 dry-runs.

