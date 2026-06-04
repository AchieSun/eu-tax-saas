# W4 — PDF Rendering Pipeline

End-to-end guide to the W4 form-rendering stack: how a user's tax data
becomes a downloadable PDF draft, and how each module fits together.

Audience: future engineers extending this to new countries / forms,
and reviewers auditing the audit/legal posture of the render path.

---

## 1. What W4 ships

| Capability | Status |
| --- | --- |
| `pdf-fill` core engine (`fillForm`) | ✅ T3.1a |
| Diagonal `DRAFT - NOT FOR FILING` watermark | ✅ T3.1b |
| WinAnsi-safe transliteration of user data | ✅ T3.1c |
| `POST /api/forms/:c/:y/:form/render` endpoint | ✅ T3.2 |
| Auth-gated render + per-user KV daily rate limit | ✅ T3.2 |
| R2 source PDF lookup with synth dev fallback | ✅ T3.2 |
| SolidJS `FilingDraftView` tab (preview + download) | ✅ T4.1 |
| `GET /api/forms/...` mapping metadata + ETag cache | ✅ T2.1 |
| DE/2024 Mantelbogen YAML mapping (20 fields, BMF cited) | ✅ T1.3b |
| End-to-end in-process pipeline smoke test | ✅ T5.1 |
| Watermark-off admin gate + audit-log (Oracle P0-1) | ✅ W4-G3 |
| `TBD_` placeholder refusal — 422 `mapping_unverified` (P0-2) | ✅ W4-G3 |
| CORS allowlist (APP_URL + dev localhost only) (P0-3) | ✅ W4-G3 |
| PDF metadata provenance (mapping version + hash + userIdHash) (P0-4) | ✅ W4-G3 |
| Typed `eqAllActive` cross-form leak guard (P0-5) | ✅ W4-G3 |
| R2 source PDF size+page caps — 10MiB / 50p (Oracle P1-1) | ✅ W5-A1 |
| Body-limit 256 KiB on `/render` + audit wire-up (P1-2) | ✅ W5-A1 |
| Country path-param as `z.enum` from `FormMappingSchema` (P1-6) | ✅ W5-A1 |
| Dynamic `pdf-lib` import — keeps GET cold-start lean (P1-8) | ✅ W5-A1 |
| Structured `FillWarning[]` + in-PDF footer + `X-Render-Warning-Detail` (P1-3) | ✅ W5-A2 |
| Frontend `issues[]` surfacing + warning panel + `X-Requested-With` (P1-4) | ✅ W5-A2 |
| `computeWatermarkFit` overflow downscale (P1-5) | ✅ W5-A2 |
| D1-atomic rate-limit via `INSERT…ON CONFLICT` (P1-7) | ✅ W5-A3 |
| Per-field `transform` column wired YAML → ingest → render (P2-A) | ✅ W5-A4 |
| NFC-normalize winansi + `getByPath` `__proto__` guard (P2-B) | ✅ W5-A5 |

**Not yet** (deferred):
- Real BMF Mantelbogen PDF acquisition + AcroForm field-name resolution
  (today the YAML mapping uses `TBD_<key>` placeholders, see T1.3b; P0-2
  now refuses to render these — no more silent placeholder leakage).
- Coordinate verification for any flat / scanned forms.
- NotoSans embedded font (W5 Wave B — drops the WinAnsi `?` fallback for CJK).
- Anlage N / KAP / S / G mappings.
- NL / PT / ES / UK forms.
- Paddle billing tier gating (the D1-atomic 10/day cap is hardcoded for free users post P1-7).

---

## 2. Architecture (one-page mental model)

```
                            ┌───────────────────────┐
                            │  Better Auth session  │
                            └──────────┬────────────┘
                                       │
 SolidJS FilingDraftView ──POST──►  rateLimit  ──►  render handler
        (T4.1)                      (T3.2 MW)         (T3.2)
                                                          │
                            ┌─────────────────────────────┼─────────────────────────────┐
                            ▼                             ▼                             ▼
                   currentMappingVersion          R2.get(pdfR2Key)            (none of either?)
                   + active field rows                  │
                   (D1, T2.1 helpers)                   ▼
                            │                  synth dev fallback
                            │                  (src/forms/render/synth.ts)
                            │                            │
                            └──────────► FormMapping + pdfBytes ◄──────────┘
                                                       │
                                                       ▼
                                          fillForm({pdfBytes, mapping, data, watermark?})
                                          (src/forms/render/fill.ts, T3.1a)
                                              │             │              │
                            ┌─────────────────┘             │              └──────────────┐
                            ▼                               ▼                             ▼
                  applyTransform()                  toWinAnsi()                applyWatermark()
                  (transforms.ts)                  (winansi.ts, T3.1c)         (watermark.ts, T3.1b)
                                                       │
                                                       ▼
                                          PDFDocument.save({updateFieldAppearances:true})
                                                       │
                                                       ▼
                                          application/pdf  +  X-Render-* headers
                                                       │
                                                       ▼
                                          <iframe blob:…>  +  Download button
```

Every box is pure (no I/O) **except** the route handler, the D1 query
helpers, and the R2 GET. The render core (`fillForm`, `applyTransform`,
`applyWatermark`, `toWinAnsi`) runs identically in Node, Workers, and
Vitest pool-workers.

---

## 3. Module reference

### 3.1 `src/forms/render/fill.ts` — render core (T3.1a)

```ts
fillForm({
  pdfBytes: Uint8Array;
  mapping: FormMapping;
  data: Record<string, unknown>;
  watermark?: false | WatermarkOptions;
}) -> Promise<{ pdfBytes, warnings: string[], filledFieldCount }>
```

- **Best-effort fill**: a missing data path, an unknown widget name, or
  a transform failure produces a warning and skips the single field —
  never aborts the whole render.
- **Two field kinds** dispatched on the mapping discriminator:
  - `kind: 'acroform'` → `form.getTextField(...).setText(...)` /
    `form.getCheckBox(...).check()/uncheck()`
  - `kind: 'coordinate'` → `page.drawText(text, {x,y,size,font,color})`
- **PDF never flattened** — users can re-edit in Adobe / Preview /
  Foxit. This is an explicit product decision.
- **One embedded Helvetica** (`StandardFonts.Helvetica`) reused for
  every coordinate draw and for the watermark, to avoid the O(n) cost
  of `embedFont` per field.

### 3.2 `src/forms/render/transforms.ts` — value formatters (T3.1a)

Pure `applyTransform(value, transformId): string`, exhaustively covers
the `TransformSchema` enum:

| Transform | Example input | Example output |
| --- | --- | --- |
| `none` | `42` | `'42'` |
| `floor` / `round` | `42.7` | `'42'` / `'43'` |
| `format-currency-eur` | `1234.5` | `'1.234,50 EUR'` |
| `format-currency-no-symbol` | `1234.5` | `'1.234,50'` |
| `format-date-iso` | `Date(2026,5,3)` | `'2026-06-03'` |
| `format-date-de` | `Date(2026,5,3)` | `'03.06.2026'` |
| `boolean-x` | `true` / anything else | `'X'` / `''` |

Currency uses hand-rolled German locale (no `Intl`) for deterministic
output across Node and workerd. An `assertNever` guard fails compilation
if a new enum value is added without a handler.

**Oracle P2-A (W4 review, Wave A4):** the `form_field_mappings` table now
has a `transform` column (migration `0005_form_field_transform`,
`NOT NULL DEFAULT 'none'`). `scripts/ingest-form-mappings.ts` backfills
it from each YAML field's `transform:` key on ingest, and the
`POST /:c/:y/:f/render` handler reads it per-row and passes it into
`fillForm`. Before this landed the route hard-coded `'none'` for every
field, so e.g. `format-date-de` was a silent no-op and German Mantelbogen
dates rendered as ISO timestamps — a legal-correctness bug, not a
cosmetic one. The route defensively coerces any unrecognised string to
`'none'` (`TransformSchema.safeParse`) so future schema drift can never
500 mid-render.

### 3.3 `src/forms/render/watermark.ts` — DRAFT stamp (T3.1b)

```ts
applyWatermark(doc, options?: {
  text?: string;               // default 'DRAFT — NOT FOR FILING'
  opacity?: number;            // default 0.25, throws RangeError outside [0,1]
  color?: { r, g, b };         // default mid-gray
  font?: PDFFont;              // reused from fillForm to avoid double-embed
  rotationDegrees?: number;    // default 45
}): Promise<void>
```

- **Default ON** on every render. Opt-out requires explicit
  `watermark: false` on the route body **and** the caller must have
  `users.role === 'admin'` (Oracle P0-1). Non-admins sending
  `watermark:false` get `403 watermark_off_admin_only`. Every
  successful watermark-off render writes an `audit_log` row with
  `source:'render-watermark-off'` (via `executionCtx.waitUntil`) and
  surfaces `X-Render-Watermark: off` on the response. The
  `FilingDraftView` toggle is hidden for non-admin sessions via the
  new `GET /api/me` resource. There is no global kill switch.
- **Auto-sized** to ~70% of the page diagonal, clamped `[16, 200]` pt.
- **Per-page**, even for 100-page PDFs.
- Internal text is silently transliterated via `toWinAnsi` so the
  em-dash default doesn't crash Helvetica (renders as plain hyphen).

### 3.4 `src/forms/render/winansi.ts` — encoding safety (T3.1c)

```ts
toWinAnsi(input: string): {
  text: string;
  replacements: Array<{ original: string; replacement: string }>;
}
```

pdf-lib's `StandardFonts.Helvetica` is WinAnsi-only (~256 glyphs). Real
European user data (Müller, Größe, Straße, Café, naïve, Łódź, Příliš)
will crash `setText`/`drawText`. Strategy:

1. **Transliteration table** — 80+ entries covering German (ae/oe/ue/ss),
   French/Spanish/Italian accents, Polish, Czech, Scandinavian, typography
   (em-dash → `-`, smart quotes → `'`/`"`, ellipsis → `...`, NBSP → ` `).
2. **WinAnsi-safe codepoint check** — ASCII printable + `0xA0..0xFF` +
   WinAnsi specials (€ at `0x80`, etc.).
3. **Unknown char** → `?` (one replacement entry).

CJK / emoji become `?`. W5 will introduce a NotoSans embedded font to
preserve these characters; until then the `?` fallback ensures the
pipeline **never crashes** on unknown codepoints.

Warnings are deduped per field (`Müller Straße` → one summary line
listing `[ü,ß]`, not five).

### 3.5 `src/forms/render/synth.ts` — dev fallback PDF (T3.2)

Pure builders that generate a synthetic Mantelbogen-style PDF on demand:

- `buildSynthPdfWithAcroForm({pageCount, pageWidth, pageHeight, fields})`
- `buildSynthPdfCoordOnly({pageCount, pageWidth, pageHeight})`
- `defaultMantelStyleFields()` — 5-field A4 preset

Used by the render route when R2 has no real BMF PDF yet (the common
case until T1.3b's `TBD_*` fields are resolved). Originally lived under
`tests/fixtures/` but was promoted to `src/forms/render/` so the
production Worker bundle can import it. `tests/fixtures/pdf-builder.ts`
is now a thin re-export so existing test imports keep working.

### 3.6 `src/api/middleware/rate-limit.ts` — KV rate limiter (T3.2)

```ts
rateLimit({
  windowSeconds: number;       // 86400 for daily
  max: number;                 // 10 for free tier today
  keyPrefix: string;           // 'rl:render'
  requireSession?: boolean;    // default true
}): MiddlewareHandler
```

Fixed-window KV counter:

- `windowStart = floor(now / windowSeconds) * windowSeconds`
- Key: `${keyPrefix}:${userId}:${windowStart}`
- `expirationTtl = max(60, windowSeconds)` (KV minimum)

429 responses include `Retry-After`, `X-RateLimit-{Limit, Remaining, Reset}`,
and a JSON body with `{error, limit, windowSeconds, resetAt}`.

**Not strictly atomic** — KV is eventually consistent and two concurrent
calls can both read N and both write N+1. For free-tier daily caps this
is fine; if we ever need strict atomicity (paid plans, payment-related
limits), we'll either use Durable Objects or move to D1 with a unique
constraint.

### 3.7 `src/api/routes/forms.ts` — HTTP surface (T2.1 + T3.2)

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/forms/:c/:y/:form` | Mapping metadata + active field rows. **ETag = content_hash**, `If-None-Match` short-circuit to 304, `Cache-Control: public, max-age=300, stale-while-revalidate=86400`. Anonymous-allowed. |
| `POST` | `/api/forms/:c/:y/:form/render` | Render PDF. **Auth required**, KV rate-limited (10/day), source PDF from R2 or synth fallback. Returns `application/pdf` with `Cache-Control: no-store, private`. |

POST response headers:

- `X-Render-Filled-Fields` — count of fields actually written
- `X-Render-Warnings` — count of best-effort skip/transliteration warnings
- `X-Render-Mapping-Version` — `form_mapping_versions.version`
- `X-Render-Mapping-Hash` — `form_mapping_versions.content_hash`
- `X-Render-Watermark` — `on` (default) or `off` (admin opt-out, audited)
- `X-Render-Mapping-Status: placeholder` — present only when the render is
  refused (422) because the active mapping still contains `TBD_*`
  acroform `pdfField`s (Oracle P0-2). The body is
  `{error:'mapping_unverified', sampleFields:[…up to 3], message}`.
  Coordinate-kind `TBD_*` names are anchor labels and are allowed.

Embedded PDF metadata (Oracle P0-4), set via pdf-lib's
`doc.setProducer/setCreator/setSubject/setKeywords/setCreationDate/setModificationDate`
before save:

- **Producer**: `eu-tax-saas/<COUNTRY>/<YEAR>/<form> mapping v<N> <shortHash16>`
- **Creator**: `eu-tax-saas render pipeline`
- **Subject**: human-readable form title from the mapping
- **Keywords**: `country:`, `year:`, `form:`, `mapping-version:`,
  `mapping-hash:` (full), `rendered-at:` (ISO), `user-id-hash:`
  (first 16 hex of `sha256(session.user.id)` — never the raw id)
- **CreationDate / ModificationDate**: server clock at render time

These let any downstream auditor reproduce the exact mapping snapshot
used for any rendered PDF, without exposing PII in the metadata.

### 3.8 `src/frontend/FilingDraftView.tsx` — preview tab (T4.1)

3rd top-level tab (`税务草稿`), lazy-loaded via `lazy()` + `<Suspense>`
to keep the initial bundle light. Three stacked panels:

1. **Picker** — country/year/form selects, `Load fields` button calls
   `GET /api/forms/...` for the mapping metadata.
2. **Fields** — dynamic inputs typed off `fieldType`; helper text is
   `field.citation`; state is keyed by `field.dataPath` with a
   `setByPath` helper so nested objects round-trip cleanly into the
   `data` payload the server's `getByPath` expects.
3. **Preview** — `URL.createObjectURL(pdfBlob)` → `<iframe>` + Download
   button. Object URLs revoked on regenerate and on `onCleanup`.

Friendly bilingual errors for `UNAUTHORIZED` / `RATE_LIMITED` (with
`Retry-After`) / `FORM_NOT_FOUND` / `NO_ACTIVE_FIELDS`.

---

## 4. Anti-hallucination guards in the render path

These are **non-negotiable** and any new code adding to the pipeline
must preserve them:

1. **Every field carries a citation** (`FormMappingSchema` enforces a
   non-empty `citation` string for both `acroform` and `coordinate`
   kinds). No anonymous numbers in tax filings.
2. **`form_mapping_versions.content_hash`** ties every rendered PDF to
   the exact mapping snapshot used. The hash is surfaced in both the
   GET response and the POST `X-Render-Mapping-Hash` header so the
   filing draft can be reproduced bit-for-bit.
3. **Watermark default ON.** Every PDF that leaves the pipeline is
   visibly marked DRAFT unless the caller explicitly opts out with
   `watermark: false`. There is **no global kill switch** — the
   decision is per-call.
4. **WinAnsi safety, not WinAnsi crashes.** User data is transliterated,
   never thrown. Replacement warnings surface to the API consumer so
   downstream UI can show "Müller → Mueller" indicators.
5. **No PDF flattening.** Users can always edit the output. The
   pipeline never collapses interactivity.
6. **`TBD_` placeholders refuse to render** (Oracle P0-2). If any
   active acroform `pdfField` starts with `TBD_`, the route returns
   `422 mapping_unverified` instead of producing a PDF with mis-mapped
   data. Coordinate `TBD_*` anchor names are allowed.
7. **Watermark-off is admin-only + audited** (Oracle P0-1). Stripping
   the DRAFT stamp requires `users.role === 'admin'` and writes an
   `audit_log` row tying the user, mapping version, and content hash
   to the moment of release.
8. **CORS allowlist, not echo** (Oracle P0-3). The render endpoint
   only accepts cross-origin credentialed requests from `env.APP_URL`
   in production (`+ localhost:3000/8787` in dev). Echo-origin with
   `credentials:true` was the prior posture and is permanently banned
   — see `src/api/index.ts` `allowOrigin()`.
9. **Provenance baked into the PDF** (Oracle P0-4). Mapping version,
   full content hash, render timestamp, and the SHA-256 prefix of the
   user id are written to the PDF's Producer/Keywords metadata. Any
   filed PDF is reproducible bit-for-bit from those four values.
10. **Cross-form leak guard at the type level** (Oracle P0-5). All D1
    reads of `form_field_mappings` go through `eqAllActive(predicates[])`
    which throws on an empty predicate list — making it impossible to
    accidentally return rows for the wrong country/year/form when one
    of the URL params is omitted.

---

## 5. Test architecture

| Layer | Lives in | Asserts |
| --- | --- | --- |
| Unit | `src/forms/render/*.test.ts` | One module at a time, every code path |
| Schema | `src/forms/{types,hash,load}.test.ts` | YAML round-trip + hash determinism |
| DB queries | `src/db/queries/form-mappings.test.ts` | Version lookup, soft-delete filter |
| Route integration | `src/api/routes/forms.test.ts` | GET + POST with mocked D1 / R2 / KV |
| Middleware | `src/api/middleware/rate-limit.test.ts` | Window math, 429 headers, KV TTL clamp |
| Synth fixture | `tests/fixtures/pdf-builder.test.ts` | Builders produce valid PDFs |
| End-to-end | `tests/e2e/w4-pdf-pipeline.test.ts` | Full pipeline in-process, byte-level + AcroForm round-trip |

Run locally:

```bash
pnpm test          # whole suite (~31 files, ~474 tests, post-Oracle-P0+P1+P2)
pnpm test:e2e      # just the e2e smoke test
pnpm typecheck     # tsc --noEmit
pnpm lint          # biome check src
```

No CI today. The pre-commit hook (`lint-staged` + `biome check --write`)
catches formatting; the human running the commit is responsible for
running `pnpm test` before pushing.

---

## 6. Curl reference

```bash
# GET metadata
curl -i https://eu-tax.example.dev/api/forms/DE/2024/mantelbogen

# POST render (cookie-authenticated)
curl -X POST https://eu-tax.example.dev/api/forms/DE/2024/mantelbogen/render \
  -H 'Cookie: better-auth.session_token=<your-session-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "data": {
      "user": {
        "profile": {
          "firstName": "Anna",
          "lastName": "Mustermann",
          "steuernummer": "11/123/45678"
        }
      },
      "userResidency": {
        "finanzamt": "Finanzamt Berlin-Mitte"
      }
    }
  }' \
  --output draft.pdf

# POST render WITHOUT watermark (final filing copy — ADMIN ONLY, audited)
curl -X POST https://eu-tax.example.dev/api/forms/DE/2024/mantelbogen/render \
  -H 'Cookie: better-auth.session_token=...' \
  -H 'Content-Type: application/json' \
  -d '{"data":{...},"watermark":false}' \
  --output final.pdf
# Non-admin → 403 {"error":"watermark_off_admin_only"}
# Admin    → 200 application/pdf, X-Render-Watermark: off, audit_log row written

# GET caller role (for FilingDraftView toggle gating)
curl -i https://eu-tax.example.dev/api/me \
  -H 'Cookie: better-auth.session_token=...'
# → {"userId":"...","role":"admin"|"user"}  (401 if not authed)
```

---

## 7. Extending: add a new country/form

Three places to touch, in order:

1. **YAML mapping** — `src/forms/<COUNTRY>/<YEAR>/<form>.yml` with
   `country`, `year`, `form`, `formTitle`, `sourceUrl`, `sourceVersion`,
   and `fields[]`. Every field needs a non-empty `citation`.
2. **Ingest** — `pnpm ingest:form-mappings` (runs
   `scripts/ingest-form-mappings.ts`) which reads the YAML via
   `import.meta.glob`, validates against `FormMappingSchema`,
   computes `content_hash`, and upserts into `form_mapping_versions`
   + `form_field_mappings`. Idempotent on hash.
3. **Frontend picker** — add an entry to `SUPPORTED_FORMS` in
   `src/frontend/filing/types.ts`. One line.

If the real PDF has fillable widgets, run `pnpm extract:acroform <path>`
first to dump widget names + page coords; copy those into the YAML's
`pdfField` slots.

If the PDF is flat (scanned), set `kind: coordinate` for each field and
measure pixel positions in a PDF viewer that shows mm/pt rulers
(Acrobat Pro, PDF-XChange).

---

## 8. W5 Wave A — Oracle P1+P2 closure summary

W4 shipped GREEN minus 5 P0 (closed in W4-G3 → `a61e7c5`). Oracle's
follow-up review listed 8 P1 + 10 P2 items. W5 Wave A landed **8 of 8
P1 + 2 of 10 P2** in five atomic per-wave commits:

| Wave | Commit | Findings | Tests delta |
| --- | --- | --- | --- |
| A1 | `ccf34ca` | P1-1 R2 caps · P1-2 body-limit+audit · P1-6 country enum · P1-8 dynamic pdf-lib | +9 |
| A2 | `0d66bde` | P1-3 structured warnings+footer · P1-4 frontend UX · P1-5 watermark fit | +22 |
| A3 | `5e2c26b` | P1-7 D1-atomic rate-limit (migration 0004) | +12 |
| A4 | `24078fb` | P2-A transform column (migration 0005) | +12 |
| A5 | `e4f7c34` | P2-B NFC normalize + `__proto__` guard | +9 |

Total: 410 → **474 tests** (+64 across W4-G3 + W5-A), tsc 0 errors,
biome 0 new errors. The remaining 8 P2 items are minor (per-finding
classification: doc drift, log redaction, opaque error paths,
non-exploitable footguns) and are tracked as standalone tickets for
W5 Wave B+ rather than a single sweep.

W5-A closes the Oracle gate. Render pipeline is now hardened against:
PDF bombs, body OOM, atomic-burst rate-limit bypass, hardcoded-`none`
transform leakage, NFD copy-paste corruption, prototype-pollution paths,
and frontend error-shape divergence.

Next surfaces (W5 Wave B+): NotoSans embedded font, Paddle billing,
Anlage N/KAP/S/G mappings, real BMF PDF acquisition.
