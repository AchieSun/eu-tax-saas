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

## Cost model (per `/render` call)

Oracle's W5-A audit (P1-NEW-3) asked for an explicit accounting because
Cloudflare D1's free tier is 1k writes/day and the render path is a
multi-write endpoint. Per successful render, the call costs:

| Op                                 | Reads | Writes |
| ---------------------------------- | ----- | ------ |
| `formVersions` lookup              | 1     | 0      |
| `formFields` SELECT for the version | 1     | 0      |
| `rateLimitD1` upsert (always)      | 0     | 1      |
| `auditMiddleware` insert (POST only) | 0     | 1      |
| `requireAdminIfWatermarkOff` audit row (if `watermark:false`) | 0   | 1      |

**Worst case per render: 2 reads + 3 writes.** A refused-by-rate-limit
call still consumes the rate-limit write (correct: that's how the cap
gets enforced) but skips the audit row (the audit middleware only fires
on 2xx responses). A refused-by-admin-gate call (P0-1, non-admin
hitting `watermark:false`) consumes the gate's audit-fail row but
skips rate-limit (P0-1 ordering invariant) and skips the success-path
audit row.

Steady-state rough math: 30 DAU × 10 renders/day × 3 writes/render
= 900 writes/day → comfortably within the 1k/day free tier. Above
~33 DAU at full quota usage we exceed free-tier and need the paid plan
(currently $5/mo for 25M writes/mo), so this is the inflection point
that justifies actually charging for the SaaS.

### Cap counter at `max + 1`

Oracle P1-NEW-3 (W5-A followup): the upsert's `SET count = ...` clause
no longer naively writes `count + 1`. It uses a `CASE WHEN` to ceiling
the stored value at `max + 1`:

```sql
SET count = CASE
  WHEN rate_limit_counters.count >= ?  -- max
  THEN ?                                -- max + 1
  ELSE rate_limit_counters.count + 1
END
```

Without the cap, a user holding a long-running tab (or a misconfigured
client retrying tight-loop) would write `count = 10_000+` over a 24h
window. The cap means the stored value stays in `{1..max+1}` regardless
of upstream traffic shape — keeps the column's distinct-values low and
makes the row physically tiny. The middleware still compares against
`max` (so the user still gets exactly `max` successes per window before
being 429'd); the cap is purely about column hygiene.

See `src/api/middleware/rate-limit-d1.ts` for the drizzle expression.

## Sweeper

Oracle P1-NEW-4 (W5-A followup): the table now self-prunes on the hot
path. Every upsert has a `1%` probability of also firing a
fire-and-forget `DELETE` for at most 10 expired rows:

```ts
if (Math.random() < SWEEP_PROBABILITY) {       // 0.01
  void db
    .delete(rateLimitCounters)
    .where(lt(rateLimitCounters.expiresAt, nowSec))
    .limit(SWEEP_BATCH_SIZE)                   // 10
    .catch(() => {});                          // swallowed
}
```

Steady-state expectation: at 30 DAU × 10 renders/day = 300 upserts/day,
the sweeper fires ~3 times/day and can delete up to 30 expired rows/day.
Each user contributes 1 row/day (one (user, window) pair), so the table
naturally stays at O(N_users) under normal traffic.

**Why fire-and-forget?** The hot path must NOT pay a second D1
round-trip per request — the upsert is the only blocking write on the
critical path. The sweep promise is `void`-discarded so:
1. A slow sweep doesn't stall the response.
2. A failed sweep doesn't fail the rate-limit decision (which has
   already been made from the upsert's `RETURNING` result).
3. An unhandled-rejection from the sweep is caught by `.catch(()=>{})`.

**Why bounded `limit(10)`?** A worst-case run after a long traffic
quiet period could see thousands of expired rows. A single
unconstrained `DELETE` would be a heavy mutation that blocks subsequent
writes on the same shard. The 10-row cap means each sweep is small and
cheap; the next 99 upserts also each get a 1% shot, so the table drains
in O(N_expired / 10) sweep events.

**Why probabilistic instead of every-N upserts?** A counter-based
approach (`if (upsertCount % 100 === 0)`) needs shared in-memory state
that doesn't exist in Workers' request-isolated runtime. Random
probability is stateless and gives the same expected sweep rate without
cross-request coordination.

See `src/api/middleware/rate-limit-d1.test.ts` tests 13–15 for the
behavioural pins (sweep fires + deletes expired rows; sweep skipped when
RNG > probability; sweep failure swallowed without failing the limiter).
