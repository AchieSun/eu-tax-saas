# Rate limiting

This app has TWO rate-limit backends. Pick the right one for the endpoint
you're mounting.

## TL;DR

| Backend       | File                              | Use for                             | Race-free?   |
| ------------- | --------------------------------- | ----------------------------------- | ------------ |
| **D1 atomic** | `src/api/middleware/rate-limit-d1.ts` | Critical caps (billing, paid PDF render, anything with a hard quota) | YES |
| **KV soft**   | `src/api/middleware/rate-limit.ts`    | Advisory caps where ±1 overshoot is fine | NO (eventually consistent) |

## Why two?

Oracle's W4 review flagged that the KV-based limiter has a read-then-write
race: two concurrent requests can both read `count=N` and both write
`count=N+1`, silently bypassing the cap. For the daily free-tier render
quota that's a real revenue / abuse vector — see Oracle P1-7.

The fix is `rateLimitD1`, which uses SQLite's atomic upsert:

```sql
INSERT INTO rate_limit_counters (key, window_start, count, expires_at)
VALUES (?, ?, 1, ?)
ON CONFLICT (key, window_start) DO UPDATE
  SET count = count + 1
RETURNING count
```

The composite primary key `(key, window_start)` is what makes this safe —
D1 serialises mutations to a single row, so even an arbitrary burst of
parallel requests produces a strict monotonic count sequence.

## Currently mounted

- `POST /api/forms/:c/:y/:f/render` → `rateLimitD1({ max: 10, windowSeconds: 86400 })`

No endpoint currently uses `rateLimitKv` (a.k.a. `rateLimit`), but the
export remains for future low-criticality endpoints (e.g. anonymous
healthcheck pings, advisory soft-throttles).

## Failure modes

- **`rateLimitD1`**: fails CLOSED. If D1 throws we return
  `503 rate_limit_unavailable` rather than default-allowing — the render
  endpoint costs real money per request and a silent cap-bypass would
  blow the monthly D1 + R2 budget.
- **`rateLimit` (KV)**: fails OPEN. KV errors let the request through;
  caps are advisory.

## Migrations

The D1 backend uses table `rate_limit_counters` (migration `0004`).
Run locally:

```bash
npx wrangler d1 migrations apply <DB_NAME> --local
```

A future sweeper job can prune rows where `expires_at < now`:

```sql
DELETE FROM rate_limit_counters WHERE expires_at < unixepoch();
```

Until that job lands the table just grows by one row per (user, window),
which for the current 10/day render cap is bounded at ~365 rows per user
per year — trivial.
