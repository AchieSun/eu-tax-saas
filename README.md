# `app/` — EU Tax SaaS

> Standard MVP target: **F1 + F2 + F3 + F4 + F6** in 9-10 weeks.
> Stack: SolidStart + Hono + Cloudflare Workers + D1 + Better Auth.
> **Current status: W4–W5 in progress** (code ahead of README; see table below).

## What's shipped so far

| Layer | Status | Path | Notes |
|-------|--------|------|-------|
| Project scaffolding (pnpm, biome, tsconfig, wrangler.toml) | ✅ | `package.json`, `wrangler.toml`, `biome.json`, `tsconfig.json` | — |
| Drizzle schema + 6 migrations | ✅ | `src/db/schema.ts`, `drizzle/migrations/` | Includes W3/W4 migrations |
| Better Auth (v1.6+) | ✅ | `src/auth/auth.ts` | Per-request instance + KV session store |
| Hono API + middleware | ✅ | `src/api/index.ts`, `src/api/routes/*`, `src/api/middleware/*` | CORS allowlist, audit, rate-limit, admin guards |
| **F1 tax calculator — DE / NL / PT / ES / UK** | ✅ | `src/rules/{de,nl,pt,es,uk}/calculator.ts` | 5 countries, all with legal citations |
| **F2 residency assessment** | ✅ | `src/rules/residency/`, `src/rules/uk/srt-ties.ts` | Decision tree + UK Statutory Residence Test |
| **F3 filing assistant — PDF render** | ✅ | `src/forms/`, `src/api/routes/forms.ts` | Overlay + AcroForm fill, watermark, transforms |
| **F4 strategy library — A/B/C tiers** | 🔄 | `src/strategies/` | 22 strategies registered; C-tier seeds pending |
| **F4 LLM harness prompts** | ✅ | `src/prompts/f4-harness/`, `src/services/f4-llm.ts` | 6-layer prompt runtime + adversarial tests |
| **F5 RAG crawler (Wave 1)** | 🔄 | `src/services/rag/`, `scripts/ingest-tax-law.ts` | HTML crawl + chunk + JSONL emit; embeddings pending |
| **F6 days tracker + calendar UI** | ✅ | `src/frontend/calendar/`, `src/api/routes/days.ts` | Drag-to-paint, bulk POST, colour legend |
| Admin routes + audit log | ✅ | `src/api/routes/admin.ts`, `src/db/schema.ts` | SHA-256 hash-only audit (GDPR-safe) |
| Vitest unit tests | ✅ | `**/*.test.ts` | **61 files / 669 tests passing** |

**Legend:** ✅ shipped & tested 🔄 partial / WIP ⏳ not started

## Cloudflare setup

如果你是从零开始配置 Cloudflare，先看中文总入口：`docs/CLOUDFLARE-SETUP-OVERVIEW.md`。
它会按顺序带你完成 Cloudflare 账号、Wrangler 登录、D1、KV、R2、Queue、Vectorize、AI Gateway、secrets 和 `pnpm build` 验证。

## Quick start

```powershell
# Install
pnpm install

# Run unit tests (rule engines, pure Node)
pnpm test

# Typecheck
pnpm typecheck

# Generate Drizzle migration after schema edits
pnpm db:generate

# Local Workers dev server (needs `wrangler login` once)
pnpm dev
```

## Better Auth — what we did differently from `docs/06`

The legacy doc lists 4 workarounds. Librarian intelligence (2026-05-28) showed 3 of 4 are
out-of-date as of Better Auth 1.6.12+:

| # | Original assumption | Current reality |
|---|---|---|
| 1 | Custom `node:crypto` scrypt override | OBSOLETE since 1.6.12 (auto-picks node export condition) |
| 2 | Disable `cookieCache` | WRONG — keep enabled, set `storeSessionInDatabase: true` |
| 3 | Clamp KV TTL ≥ 60s | STILL REQUIRED |
| 4 | Per-request auth instance | STILL REQUIRED |

See `src/auth/auth.ts` for the production-ready implementation.

## F1 calculator — source-of-truth table

Every rate / threshold has a citation in code comments. Summary:

| Country | Year | Source | Status |
|---|---|---|---|
| 🇩🇪 DE | 2025 | § 32a EStG (Steuerfortentwicklungsgesetz BGBl. I 2024 Nr. 449) | Locked |
| 🇩🇪 DE | 2026 | § 32a EStG (esth.bmf 2026) | Locked (SolZ thresholds provisional) |
| 🇳🇱 NL Box 1/2/3 | 2025/2026 | Belastingdienst + Deloitte Belastingplan 2026 | Locked (Box 3 bank/debt rates provisional) |
| 🇵🇹 PT | 2025 | PwC Guia Fiscal 2025 (Lei 55-A/2025) | Locked |
| 🇵🇹 PT | 2026 | § 68.º CIRS (Lei 73-A/2025) | Provisional — parcela a abater derived, awaiting AT folheto Q1 2026 |
| 🇵🇹 IFICI | both | Art. 58.º-A EBF | Locked |

## Test fixtures provenance

`src/rules/de/calculator.test.ts` uses **pure-tariff** fixtures (T(zvE)), not BMF
Grundtabelle lookups. The Grundtabelle pre-applies Werbungskostenpauschale (€1,230) +
Sonderausgabenpauschbetrag (€36) before invoking the tariff; our calculator is the pure
tariff. Gross→zvE conversion will be added in W4 (deduction module).

## Next steps

| Week | Tasks | Status |
|---|---|---|
| W2 | F1 ES (4 autonomous communities) + UK SRT, F2 residency decision tree | ✅ Done |
| W3 | F6 calendar UI, R2 PDF template ingestion | ✅ Done |
| W4 | F3 field guide engine + overlay PDF preview | ✅ Done |
| W5 | F4 strategy library — A/B tier (22 strategies) | 🔄 A/B done; C-tier seeds pending |
| W6 | F4 C tier + 6 harness layers wired end-to-end | 🔄 Harness prompts done; wiring TBD |
| W7 | Integration, dashboard, mobile responsive | ⏳ Not started |
| W8 | E2E tests (Playwright), bug bash | ⏳ Not started |
| W9 | Paddle production + Reddit/PH launch | ⏳ Not started |
