# Workers integration tests (`@cloudflare/vitest-pool-workers`)

This directory holds Vitest suites that run **inside the Cloudflare Workers
runtime** via Miniflare, with real D1, R2, and KV bindings provisioned per
test run. They are invoked separately from the main pure-Node unit tests:

```bash
pnpm test           # main vitest (vitest.config.ts)
pnpm test:workers   # this directory (vitest.workers.config.ts)
```

## Files

| File | Purpose |
| ---- | ------- |
| `../../vitest.workers.config.ts` | `defineWorkersConfig` with ephemeral D1/R2/KV (`d1Persist: false`, etc.) |
| `../../wrangler.test.toml` | Test-only wrangler config — placeholder binding IDs, Miniflare ignores them |
| `../helpers/workers-env.ts` | `setupTestEnv()`, `seedUser()`, `seedFormMapping()` shared helpers |
| `health.test.ts` | Smoke test: `/api/health` 200, migrations apply, R2 PUT/GET roundtrip |

## Why the AI binding is omitted

`@cloudflare/vitest-pool-workers@0.6.0` paired with `miniflare@3.20241230.1`
cannot wire the `[ai]` binding:

> workerd: wrapped binding module can't be resolved (internal modules only);
> moduleName = miniflare-internal:wrapped:__WRANGLER_EXTERNAL_AI_WORKER

`wrangler.test.toml` therefore intentionally omits `[ai]`. Tests that need
the AI binding must `vi.stubGlobal` / `vi.mock` it. The W4 PDF rendering
endpoint does not call `c.env.AI`, so this restriction is fine for the
Oracle P2#7 use case (real D1+R2 binding verification).

## ⚠️ Windows + non-ASCII project path

**Known limitation:** when the repository lives at a path containing
non-ASCII characters (e.g. `E:\拯救美国五个项目\08-欧洲税务SaaS\app`),
workerd's module-fallback service fails to resolve `node:vm` for the
pool-workers runner worker:

```
workerd/server/server.c++:3319: error: Fallback service failed to fetch module;
  spec = /?specifier=node%3Avm&referrer=%2FE%3A%2F%E6%8B%AF%...
service core:user:vitest-pool-workers-runner-: Uncaught Error: No such module "node:vm".
MiniflareCoreError [ERR_RUNTIME_FAILURE]: The Workers runtime failed to start.
```

Root cause: the URL-encoded UTF-8 path the fallback service hands to Node
does not round-trip through workerd's `cap'n proto` IPC layer on Win32.
This is a workerd/miniflare issue, not a problem with this harness.

### Workarounds (pick one)

1. **Clone the repo to an ASCII-only path** (recommended for local CI):
   ```powershell
   git clone <repo> C:\eutax-saas
   cd C:\eutax-saas\app
   pnpm install
   pnpm test:workers      # passes
   ```
2. **Run in Linux/macOS** (CI default): every supported platform other than
   Windows handles UTF-8 paths correctly through workerd's IPC.
3. **Run in WSL2** on the same Windows machine — the path will be
   `/mnt/e/拯救美国五个项目/...` but WSL's filesystem layer normalises
   the bytes that workerd sees.

Once CI moves to Linux runners (planned), this README's Windows caveat
becomes a developer-experience note only.

## Adding a new workers suite

1. Create `tests/workers/<feature>.test.ts`
2. Import `setupTestEnv` and call it in `beforeAll`
3. Use `SELF.fetch(...)` to hit your Hono routes, or `env.DB.prepare(...)`
   to read/write fixture data directly
4. Use `seedUser()` / `seedFormMapping()` helpers — they satisfy every
   NOT-NULL column in the schema (including app-specific `role`, `locale`,
   `subscription_status`, and the W4 `field_kind` default)
