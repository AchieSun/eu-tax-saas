/**
 * DeepSeek V4 client — Cloudflare Workers native fetch wrapper.
 *
 * Supports:
 *   - Direct API or AI Gateway baseURL resolution
 *   - chat()   → deepseek-chat (tool calling, structured output)
 *   - selfCheck() → deepseek-reasoner (CoT self-audit, longer timeout)
 *   - Retry with exponential backoff (5xx / 429 / network errors)
 *   - Configurable timeout per-call
 *   - Zod-validated response parsing
 *   - Typed error classes
 *
 * Spec: docs/15-ai-prompts/w6-f4-harness/README.md
 */

import { z } from 'zod';
import type { Bindings } from '../api/index';

// ────────────────────────────────────────────────────────────────────────────
// Typed error classes
// ────────────────────────────────────────────────────────────────────────────

export class DeepSeekError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DeepSeekError';
  }
}

export class DeepSeekRateLimitError extends DeepSeekError {
  constructor(message = 'DeepSeek API rate-limited') {
    super(message);
    this.name = 'DeepSeekRateLimitError';
  }
}

export class DeepSeekTimeoutError extends DeepSeekError {
  constructor(message = 'DeepSeek API request timed out') {
    super(message);
    this.name = 'DeepSeekTimeoutError';
  }
}

export class DeepSeekValidationError extends DeepSeekError {
  constructor(
    message: string,
    public readonly zodIssues?: z.ZodIssue[],
  ) {
    super(message);
    this.name = 'DeepSeekValidationError';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Zod schemas for API response parsing
// ────────────────────────────────────────────────────────────────────────────

export const deepSeekToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string(), // JSON string — caller must JSON.parse
  }),
});

export const deepSeekChoiceMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable(),
  tool_calls: z.array(deepSeekToolCallSchema).optional(),
});

export const deepSeekUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

export const deepSeekChoiceSchema = z.object({
  index: z.number().int().nonnegative(),
  message: deepSeekChoiceMessageSchema,
  finish_reason: z.enum(['stop', 'tool_calls', 'length', 'content_filter']),
});

export const deepSeekResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number().int().nonnegative(),
  model: z.string(),
  choices: z.array(deepSeekChoiceSchema).min(1),
  usage: deepSeekUsageSchema.optional(),
});

export type DeepSeekResponse = z.infer<typeof deepSeekResponseSchema>;
export type DeepSeekToolCall = z.infer<typeof deepSeekToolCallSchema>;
export type DeepSeekUsage = z.infer<typeof deepSeekUsageSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Message types (OpenAI-compatible)
// ────────────────────────────────────────────────────────────────────────────

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: DeepSeekToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  timeoutMs?: number;
  signal?: AbortSignal;
  responseFormat?: { type: 'json_object' } | { type: 'json_schema'; json_schema: Record<string, unknown> };
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const DIRECT_BASE_URL = 'https://api.deepseek.com/v1';
const MODEL_CHAT = 'deepseek-chat';
const MODEL_REASONER = 'deepseek-reasoner';
const DEFAULT_TIMEOUT_CHAT = 30_000;
const DEFAULT_TIMEOUT_REASONER = 90_000;
const RETRY_DELAYS = [200, 800, 2000]; // exponential backoff ms

// ────────────────────────────────────────────────────────────────────────────
// Client
// ────────────────────────────────────────────────────────────────────────────

export class DeepSeekClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    env: Pick<Bindings, 'DEEPSEEK_API_KEY' | 'AI_GATEWAY_ACCOUNT_ID' | 'AI_GATEWAY_NAME' | 'AI_GATEWAY_API_TOKEN'>,
  ) {
    const key = env.DEEPSEEK_API_KEY;
    if (!key) {
      throw new DeepSeekError('DEEPSEEK_API_KEY is not configured');
    }

    if (env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_NAME) {
      this.baseUrl = `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_NAME}/deepseek`;
      // When AI Gateway has authenticated gateway enabled, use the Cloudflare
      // API token. Otherwise fall back to the DeepSeek provider key, which the
      // gateway forwards to DeepSeek (or uses as the BYOK provider key).
      this.apiKey = env.AI_GATEWAY_API_TOKEN || key;
    } else {
      this.baseUrl = DIRECT_BASE_URL;
      this.apiKey = key;
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** For introspection: which model alias is used for primary chat calls. */
  get chatModel(): string {
    return MODEL_CHAT;
  }

  /** For introspection: which model alias is used for self-check / H6 calls. */
  get reasonerModel(): string {
    return MODEL_REASONER;
  }

  /**
   * Chat completion (deepseek-chat). Supports tool calling.
   */
  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<DeepSeekResponse> {
    return this.complete(messages, {
      ...opts,
      model: opts.model ?? MODEL_CHAT,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_CHAT,
    });
  }

  /**
   * Self-check / reasoning call (deepseek-reasoner). Longer default timeout
   * for chain-of-thought processing.
   *
   * NOTE: As of 2026-06, DeepSeek's `deepseek-reasoner` alias resolves to the
   * same `deepseek-v4-flash` model as `deepseek-chat`. The H6 audit layer is
   * therefore a same-model self-check with a different system prompt and
   * temperature, not a true independent CoT reviewer. See also:
   * `scripts/ping-deepseek.ts` for live alias resolution diagnostics.
   */
  async selfCheck(messages: ChatMessage[], opts: ChatOptions = {}): Promise<DeepSeekResponse> {
    return this.complete(messages, {
      ...opts,
      model: opts.model ?? MODEL_REASONER,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_REASONER,
    });
  }

  // ── Core implementation ─────────────────────────────────────────────────

  private async complete(
    messages: ChatMessage[],
    opts: Required<Pick<ChatOptions, 'model' | 'timeoutMs'>> & ChatOptions,
  ): Promise<DeepSeekResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: opts.model,
      messages,
      temperature: opts.temperature ?? 0.2,
    };
    if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
    if (opts.responseFormat !== undefined) body.response_format = opts.responseFormat;
    if (opts.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
      body.tool_choice = opts.toolChoice ?? 'auto';
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, body, opts.timeoutMs, opts.signal);

        // Parse + validate via Zod
        const parsed = deepSeekResponseSchema.safeParse(response);
        if (!parsed.success) {
          throw new DeepSeekValidationError(
            'DeepSeek response failed Zod validation',
            parsed.error.issues,
          );
        }
        return parsed.data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Determine if retryable
        if (!this.isRetryable(lastError, attempt)) {
          throw lastError;
        }

        // Wait before retry
        const delay = RETRY_DELAYS[attempt];
        await this.sleep(delay);
      }
    }

    // Should not reach here, but TypeScript safety
    throw lastError ?? new DeepSeekError('Unexpected error in DeepSeek client');
  }

  private async fetchWithTimeout(
    url: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Combine external signal + timeout signal
      const combinedSignal = signal
        ? this.combineSignals(signal, controller.signal)
        : controller.signal;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: combinedSignal,
      });

      // Handle HTTP errors
      if (res.status === 429) {
        throw new DeepSeekRateLimitError(
          `DeepSeek API rate-limited (attempt exceeded): ${res.status}`,
        );
      }
      if (res.status >= 500) {
        throw new DeepSeekError(`DeepSeek API server error: ${res.status} ${res.statusText}`);
      }
      if (!res.ok) {
        throw new DeepSeekError(`DeepSeek API error: ${res.status} ${res.statusText}`);
      }

      const data: unknown = await res.json();
      return data;
    } catch (err) {
      if (err instanceof DeepSeekError) throw err;
      // AbortController timeout produces an 'AbortError' DOMException
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Determine if it was our timeout or external signal
        throw new DeepSeekTimeoutError(`DeepSeek API request timed out after ${timeoutMs}ms`);
      }
      // Network errors
      throw new DeepSeekError(`DeepSeek API network error: ${(err as Error).message}`, err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private isRetryable(err: Error, attempt: number): boolean {
    if (attempt >= RETRY_DELAYS.length) return false;
    // Retry on: rate limit, server errors, timeouts, network errors
    if (err instanceof DeepSeekRateLimitError) return true;
    if (err instanceof DeepSeekTimeoutError) return true;
    if (err instanceof DeepSeekError && err.message.includes('server error')) return true;
    if (err instanceof DeepSeekError && err.message.includes('network error')) return true;
    return false;
  }

  private combineSignals(...signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    for (const sig of signals) {
      if (sig.aborted) {
        controller.abort(sig.reason);
        return controller.signal;
      }
      sig.addEventListener('abort', () => controller.abort(sig.reason), { once: true });
    }
    return controller.signal;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
