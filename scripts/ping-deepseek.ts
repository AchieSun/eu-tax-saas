/**
 * Manual ping script for DeepSeek API verification.
 *
 * Usage (PowerShell):
 *   $env:DEEPSEEK_API_KEY='sk-...'; npx tsx scripts/ping-deepseek.ts
 *
 * NOT included in vitest suite — would consume real API credits in CI.
 * Run ONCE during development to confirm models exist and key works.
 *
 * Verifies:
 *   - deepseek-chat responds (returns actual model ID)
 *   - deepseek-reasoner responds (CoT — may take 30+ seconds)
 */

const API_KEY: string | undefined = process.env.DEEPSEEK_API_KEY;
const BASE_URL = 'https://api.deepseek.com/v1';

if (!API_KEY) {
  console.error('ERROR: DEEPSEEK_API_KEY env var not set');
  process.exit(1);
}
const KEY: string = API_KEY;

interface ChatResp {
  id: string;
  model: string;
  choices: Array<{ message: { role: string; content: string | null } }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

async function ping(model: string, timeoutMs: number): Promise<void> {
  const t0 = Date.now();
  console.log(`\n→ Pinging ${model} ...`);

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly one word: hello' }],
        max_tokens: 16,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    const elapsed = Date.now() - t0;

    if (!res.ok) {
      const text = await res.text();
      console.error(`  ✗ HTTP ${res.status} after ${elapsed}ms`);
      console.error(`    body: ${text}`);
      return;
    }

    const data = (await res.json()) as ChatResp;
    console.log(`  ✓ ${elapsed}ms`);
    console.log(`    requested model: ${model}`);
    console.log(`    response model:  ${data.model}`);
    console.log(`    content: ${(data.choices[0]?.message.content ?? '<null>').slice(0, 80)}`);
    if (data.usage) {
      console.log(
        `    tokens: prompt=${data.usage.prompt_tokens} completion=${data.usage.completion_tokens} total=${data.usage.total_tokens}`,
      );
    }
  } catch (err) {
    const elapsed = Date.now() - t0;
    if ((err as Error).name === 'AbortError') {
      console.error(`  ✗ TIMEOUT after ${elapsed}ms (timeout was ${timeoutMs}ms)`);
    } else {
      console.error(`  ✗ ERROR after ${elapsed}ms:`, (err as Error).message);
    }
  } finally {
    clearTimeout(tid);
  }
}

async function main(): Promise<void> {
  console.log('DeepSeek API ping — checking key + model aliases');
  console.log(`base URL: ${BASE_URL}`);
  console.log(`key prefix: ${KEY.slice(0, 8)}…`);

  await ping('deepseek-chat', 30_000);
  await ping('deepseek-reasoner', 120_000);

  console.log('\nDone.');
}

void main();
