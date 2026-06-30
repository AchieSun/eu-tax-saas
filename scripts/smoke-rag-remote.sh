#!/usr/bin/env bash
set -euo pipefail

# RAG remote smoke test.
# Runs wrangler dev --remote and exercises the real AI Gateway + Vectorize pipeline.
# Requires: pnpm, wrangler login, .dev.vars with DEEPSEEK_API_KEY + AI_GATEWAY_*.

HOST="http://localhost:8787"
EMAIL="smoke-rag-$(date +%s)@example.com"
PASSWORD="SmokeTest123!"
COOKIE_JAR=$(mktemp)
LOG_FILE=$(mktemp)
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Stopping wrangler dev (pid $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$COOKIE_JAR" "$LOG_FILE"
}
trap cleanup EXIT

# 1. Start wrangler dev with remote bindings.
echo "Starting wrangler dev --remote..."
pnpm exec wrangler dev --remote > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

# 2. Wait for /api/health.
echo "Waiting for server on $HOST..."
for i in {1..60}; do
  if curl -fs "$HOST/api/health" > /dev/null 2>&1; then
    echo "Server ready."
    break
  fi
  sleep 1
done
if ! curl -fs "$HOST/api/health" > /dev/null 2>&1; then
  echo "Server failed to start. Logs:" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

# 3. Sign up a test user.
echo "Signing up test user $EMAIL..."
curl -fs -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "$HOST/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -H "Origin: $HOST" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Smoke Test\"}" \
  > /dev/null

# 4. Promote to admin via D1.
echo "Promoting test user to admin..."
pnpm exec wrangler d1 execute eu-tax-saas-db --remote \
  --command "UPDATE users SET role = 'admin' WHERE email = '$EMAIL';" > /dev/null

# 5. Sign in to obtain session cookie.
echo "Signing in..."
curl -fs -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "$HOST/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -H "Origin: $HOST" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  > /dev/null

# 6. Upsert a single test chunk.
echo "Upserting test chunk..."
UPSERT_RESPONSE=$(curl -fs -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "$HOST/api/admin/rag/upsert" \
  -H "Content-Type: application/json" \
  -H "Origin: $HOST" \
  -d '{
    "chunks": [{
      "id": "0000000000000000000000000000000000000000000000000000000000000001",
      "jurisdiction": "ES",
      "sourceUrl": "https://boe.es/smoke-test",
      "sourceTitle": "Smoke Test Source",
      "authority": "BOE",
      "taxYear": 2025,
      "topic": "smoke-test",
      "lang": "en",
      "chunkIndex": 0,
      "charCount": 42,
      "text": "For smoke testing only: the special tax rate for researchers is 24%.",
      "contentHash": "0000000000000000000000000000000000000000000000000000000000000001",
      "fetchedAt": "2026-06-30T00:00:00.000Z",
      "vector": null
    }]
  }')
echo "Upsert response: $UPSERT_RESPONSE"

# 7. Query QA with a question that should match the chunk.
echo "Querying QA endpoint..."
QA_RESPONSE=$(curl -fs -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "$HOST/api/rag/qa" \
  -H "Content-Type: application/json" \
  -H "Origin: $HOST" \
  -d '{"question":"What is the special tax rate for researchers?"}')
echo "QA response: $QA_RESPONSE"

# 8. Validate QA response has expected JSON fields.
if echo "$QA_RESPONSE" | grep -q '"ok":true' && echo "$QA_RESPONSE" | grep -q '"confidence"'; then
  echo "Smoke test PASSED: QA returned ok=true with confidence field."
else
  echo "Smoke test FAILED: QA response missing expected fields." >&2
  exit 1
fi

# 9. Off-topic question should return no-context.
echo "Querying off-topic question..."
OFFTOPIC_RESPONSE=$(curl -fs -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "$HOST/api/rag/qa" \
  -H "Content-Type: application/json" \
  -H "Origin: $HOST" \
  -d '{"question":"What is the capital of France?"}')
echo "Off-topic response: $OFFTOPIC_RESPONSE"
if echo "$OFFTOPIC_RESPONSE" | grep -q '"error":"no-context"'; then
  echo "Off-topic test PASSED."
else
  echo "Off-topic test FAILED: expected no-context." >&2
  exit 1
fi
