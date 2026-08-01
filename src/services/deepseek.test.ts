/**
 * DeepSeek client unit tests — all mocked via fetch mock.
 * No real network calls; safe for CI.
 */

import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../api/index';
import {
  DeepSeekClient,
  DeepSeekError,
  DeepSeekRateLimitError,
  DeepSeekTimeoutError,
  DeepSeekValidationError,
} from './deepseek';

// Replace global fetch with a fresh mock per test. We use `vi.fn()` rather
// than `vi.spyOn(globalThis, 'fetch')` because the spy's type collides with
// Workers' overloaded fetch signature in strict mode.
type FetchMock = Mock & { _restore: () => void };

function installFetchMock(): FetchMock {
  const mock = vi.fn();
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = mock as unknown as typeof fetch;
  return Object.assign(mock, {
    _restore: () => {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    },
  }) as FetchMock;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const DIRECT_ENV: Pick<
  Bindings,
  'DEEPSEEK_API_KEY' | 'AI_GATEWAY_ACCOUNT_ID' | 'AI_GATEWAY_NAME' | 'AI_GATEWAY_API_TOKEN'
> = {
  DEEPSEEK_API_KEY: 'sk-test-direct',
};

const GATEWAY_ENV: Pick<
  Bindings,
  'DEEPSEEK_API_KEY' | 'AI_GATEWAY_ACCOUNT_ID' | 'AI_GATEWAY_NAME' | 'AI_GATEWAY_API_TOKEN'
> = {
  DEEPSEEK_API_KEY: 'sk-test-gw',
  AI_GATEWAY_ACCOUNT_ID: 'acct-abc',
  AI_GATEWAY_NAME: 'tax-saas-gw',
  AI_GATEWAY_API_TOKEN: 'cf-token-gw',
};

function makeOkResponse(
  opts: {
    model?: string;
    content?: string | null;
    toolCalls?: Array<{ name: string; args: string }>;
  } = {},
): Response {
  const body = {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: opts.model ?? 'deepseek-v4-flash',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: opts.content ?? 'Hello!',
          ...(opts.toolCalls
            ? {
                tool_calls: opts.toolCalls.map((tc, i) => ({
                  id: `call_${i}`,
                  type: 'function',
                  function: { name: tc.name, arguments: tc.args },
                })),
              }
            : {}),
        },
        finish_reason: opts.toolCalls ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DeepSeekClient — baseURL resolution', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = installFetchMock();
  });
  afterEach(() => {
    fetchMock._restore();
  });

  it('chat() resolves baseURL to direct API when no gateway env', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse());
    const client = new DeepSeekClient(DIRECT_ENV);
    await client.chat([{ role: 'user', content: 'hi' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('chat() resolves baseURL to gateway URL when env present', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse());
    const client = new DeepSeekClient(GATEWAY_ENV);
    await client.chat([{ role: 'user', content: 'hi' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(
      'https://gateway.ai.cloudflare.com/v1/acct-abc/tax-saas-gw/deepseek/chat/completions',
    );
  });
});

describe('DeepSeekClient — headers & auth', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = installFetchMock();
  });
  afterEach(() => {
    fetchMock._restore();
  });

  it('chat() includes Authorization Bearer header for direct API', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse());
    const client = new DeepSeekClient(DIRECT_ENV);
    await client.chat([{ role: 'user', content: 'hi' }]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test-direct');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('chat() sends AI_GATEWAY_API_TOKEN when using AI Gateway', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse());
    const client = new DeepSeekClient(GATEWAY_ENV);
    await client.chat([{ role: 'user', content: 'hi' }]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer cf-token-gw');
  });
});

describe('DeepSeekClient — retry behavior', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = installFetchMock();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    fetchMock._restore();
    vi.useRealTimers();
  });

  it('chat() retries on 503, succeeds on 3rd attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
      .mockResolvedValueOnce(makeOkResponse({ content: 'success' }));

    const client = new DeepSeekClient(DIRECT_ENV);
    const result = await client.chat([{ role: 'user', content: 'hi' }]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.choices[0].message.content).toBe('success');
  });

  it('chat() throws DeepSeekRateLimitError on 429 after exhausting retries', async () => {
    fetchMock.mockResolvedValue(new Response('Too Many Requests', { status: 429 }));

    const client = new DeepSeekClient(DIRECT_ENV);
    await expect(client.chat([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      DeepSeekRateLimitError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('DeepSeekClient — tool calling', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = installFetchMock();
  });
  afterEach(() => {
    fetchMock._restore();
  });

  it('chat() parses tool_calls in response correctly', async () => {
    fetchMock.mockResolvedValueOnce(
      makeOkResponse({
        content: null,
        toolCalls: [
          {
            name: 'calculate_tax',
            args: JSON.stringify({ country: 'ES', tax_year: 2025, gross_income: 100_000 }),
          },
        ],
      }),
    );

    const client = new DeepSeekClient(DIRECT_ENV);
    const result = await client.chat([{ role: 'user', content: 'compute tax' }], {
      tools: [
        {
          type: 'function',
          function: {
            name: 'calculate_tax',
            description: 'compute tax',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    });

    expect(result.choices[0].finish_reason).toBe('tool_calls');
    const toolCalls = result.choices[0].message.tool_calls;
    expect(toolCalls).toBeDefined();
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls?.[0].function.name).toBe('calculate_tax');
    const args = JSON.parse(toolCalls?.[0].function.arguments ?? '{}') as {
      country: string;
      gross_income: number;
    };
    expect(args.country).toBe('ES');
    expect(args.gross_income).toBe(100_000);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const reqBody = JSON.parse(init.body as string) as { tools: unknown[]; tool_choice: string };
    expect(reqBody.tools).toHaveLength(1);
    expect(reqBody.tool_choice).toBe('auto');
  });
});

describe('DeepSeekClient — model selection', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = installFetchMock();
  });
  afterEach(() => {
    fetchMock._restore();
  });

  it('selfCheck() uses deepseek-v4-flash model with thinking enabled', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse({ model: 'deepseek-v4-flash' }));

    const client = new DeepSeekClient(DIRECT_ENV);
    await client.selfCheck([{ role: 'user', content: 'audit this' }]);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const reqBody = JSON.parse(init.body as string) as { model: string; thinking?: { type: string } };
    expect(reqBody.model).toBe('deepseek-v4-flash');
    expect(reqBody.thinking).toEqual({ type: 'enabled' });
  });

  it('chat() uses deepseek-v4-flash model with thinking disabled', async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse({ model: 'deepseek-v4-flash' }));

    const client = new DeepSeekClient(DIRECT_ENV);
    await client.chat([{ role: 'user', content: 'hi' }]);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const reqBody = JSON.parse(init.body as string) as { model: string; thinking?: { type: string } };
    expect(reqBody.model).toBe('deepseek-v4-flash');
    expect(reqBody.thinking).toEqual({ type: 'disabled' });
  });
});

describe('DeepSeekClient — timeout', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = installFetchMock();
  });
  afterEach(() => {
    fetchMock._restore();
  });

  it('chat() throws DeepSeekTimeoutError when fetch exceeds timeout', async () => {
    fetchMock.mockImplementation((_url: unknown, init: unknown) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal) {
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }
      });
    });

    const client = new DeepSeekClient(DIRECT_ENV);
    await expect(
      client.chat([{ role: 'user', content: 'hi' }], { timeoutMs: 1 }),
    ).rejects.toBeInstanceOf(DeepSeekTimeoutError);
  }, 15_000);
});

describe('DeepSeekClient — validation', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = installFetchMock();
  });
  afterEach(() => {
    fetchMock._restore();
  });

  it('chat() throws DeepSeekValidationError on malformed response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'x', object: 'wrong-type' }), { status: 200 }),
    );

    const client = new DeepSeekClient(DIRECT_ENV);
    await expect(client.chat([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      DeepSeekValidationError,
    );
  });
});

describe('DeepSeekClient — config errors', () => {
  it('constructor throws when DEEPSEEK_API_KEY is missing', () => {
    expect(
      () =>
        new DeepSeekClient(
          {} as Pick<
            Bindings,
            'DEEPSEEK_API_KEY' | 'AI_GATEWAY_ACCOUNT_ID' | 'AI_GATEWAY_NAME' | 'AI_GATEWAY_API_TOKEN'
          >,
        ),
    ).toThrow(DeepSeekError);
  });

  it('constructor falls back to DEEPSEEK_API_KEY for unauthenticated gateway', () => {
    const client = new DeepSeekClient({
      DEEPSEEK_API_KEY: 'sk-test',
      AI_GATEWAY_ACCOUNT_ID: 'acct-abc',
      AI_GATEWAY_NAME: 'tax-saas-gw',
    } as Pick<
      Bindings,
      'DEEPSEEK_API_KEY' | 'AI_GATEWAY_ACCOUNT_ID' | 'AI_GATEWAY_NAME' | 'AI_GATEWAY_API_TOKEN'
    >);
    expect(client).toBeDefined();
  });
});
