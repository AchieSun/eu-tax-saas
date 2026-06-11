# F5 AI Gateway Setup — DeepSeek Routing

AI Gateway is Cloudflare's proxy layer in front of DeepSeek. It gives us request logs, caching, rate controls, and provider routing without putting provider-specific URLs throughout the codebase.

Workers AI and AI Gateway are different:

- **Workers AI (`env.AI`)**: used for embeddings, e.g. BGE-M3 for Vectorize.
- **AI Gateway**: used for LLM calls to DeepSeek, already supported by `src/services/deepseek.ts`.

## What the code already does

`src/services/deepseek.ts` builds this base URL when both fields are configured:

```text
https://gateway.ai.cloudflare.com/v1/{AI_GATEWAY_ACCOUNT_ID}/{AI_GATEWAY_NAME}/deepseek
```

If those fields are missing, the client falls back to direct DeepSeek API:

```text
https://api.deepseek.com/v1
```

So AI Gateway is recommended for production, but not required for local testing.

## Create the AI Gateway

Use the Cloudflare dashboard if the CLI command is unavailable in your Wrangler version:

1. Open Cloudflare Dashboard.
2. Go to **AI → AI Gateway**.
3. Create a gateway named `eu-tax-saas`.
4. Copy the gateway slug/name shown in the dashboard.
5. Copy your Cloudflare Account ID.

If your Wrangler supports the command, the equivalent is:

```bash
npx wrangler ai-gateway create eu-tax-saas
```

## Secrets / vars to set

Run from `app/`:

```bash
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put AI_GATEWAY_ACCOUNT_ID
npx wrangler secret put AI_GATEWAY_NAME
```

For staging or production, use the matching environment flag if needed:

```bash
npx wrangler secret put DEEPSEEK_API_KEY --env production
npx wrangler secret put AI_GATEWAY_ACCOUNT_ID --env production
npx wrangler secret put AI_GATEWAY_NAME --env production
```

## What each field means

| Field | Meaning | Example |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | Your DeepSeek provider key. Do not paste it into code or docs. | `sk-...` |
| `AI_GATEWAY_ACCOUNT_ID` | Your Cloudflare account ID, not an API key. | `0123456789abcdef...` |
| `AI_GATEWAY_NAME` | The gateway slug/name you created. | `eu-tax-saas` |

## What you need to give me

Please give me only these non-secret values:

- `AI_GATEWAY_ACCOUNT_ID`
- `AI_GATEWAY_NAME`
- Confirm that `DEEPSEEK_API_KEY` was set with `wrangler secret put`

Do **not** send the actual DeepSeek API key again unless you intentionally want me to test something live in the local environment.

## Verification

After setting secrets, deploy or run a remote dev session:

```bash
npx wrangler dev --remote
```

Then trigger an AI route. The Cloudflare dashboard should show requests under **AI Gateway → eu-tax-saas**.

## Relationship to Vectorize

AI Gateway does not create embeddings and does not store vectors. For F5 RAG:

1. Workers AI BGE-M3 creates embeddings.
2. Vectorize stores/query embeddings.
3. DeepSeek via AI Gateway answers the final user question using retrieved context.

See also: `docs/F5-VECTORIZE-SETUP.md`.
