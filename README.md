# `app/` — EU Tax SaaS

> Standard MVP target: **F1 + F2 + F3 + F4 + F6** in 9-10 weeks.
> Stack: SolidStart + Hono + Cloudflare Workers + D1 + Better Auth.

## What ships in this W1 commit

| Layer | Status | Path |
|-------|--------|------|
| Project scaffolding (pnpm, biome, tsconfig, wrangler.toml) | ✅ | `package.json`, `wrangler.toml`, `biome.json`, `tsconfig.json` |
| Drizzle schema + initial migration | ✅ | `src/db/schema.ts`, `drizzle/migrations/0000_init.sql` |
| Better Auth (v1.6+ with 4 verified workarounds) | ✅ | `src/auth/auth.ts` |
| Hono API + per-request auth middleware | ✅ | `src/api/index.ts`, `src/api/routes/*` |
| **F1 tax calculator — DE / NL / PT** with citations | ✅ | `src/rules/{de,nl,pt}/calculator.ts` |
| Vitest unit tests (33 passing) | ✅ | `src/rules/**/*.test.ts` |
| F4 6-layer Harness prompts (runtime) | ✅ | `src/prompts/f4-harness/` |
| Frontend skeleton (SolidStart placeholder) | ✅ | `src/frontend/App.tsx` |

**ES / UK calculators, F2 residency, F3 field guide, F4 strategy library, F6 calendar UI** all
arrive in W2-W6 per `docs/14-mvp-task-breakdown.md` and the matching AI Prompt library at
`docs/15-ai-prompts/`.

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

| Week | Tasks | AI Prompt directory |
|---|---|---|
| W2 | F1 ES (4 autonomous communities) + UK SRT, F2 residency decision tree | `docs/15-ai-prompts/w2-f1-esuk-f2/` |
| W3 | F6 calendar UI, R2 PDF template ingestion | `docs/15-ai-prompts/w3-f6-f3templates/` |
| W4 | F3 field guide engine + overlay PDF preview | `docs/15-ai-prompts/w4-f3-fieldguide/` |
| W5 | F4 strategy library — A/B tier (22 strategies) | `docs/15-ai-prompts/w5-f4-strategy/` |
| W6 | F4 C tier + 6 harness layers wired end-to-end | `docs/15-ai-prompts/w6-f4-harness/` |
| W7 | Integration, dashboard, mobile responsive | `docs/15-ai-prompts/w7-integration/` |
| W8 | E2E tests (Playwright), bug bash | `docs/15-ai-prompts/w8-testing/` |
| W9 | Paddle production + Reddit/PH launch | `docs/15-ai-prompts/w9-launch/` |
