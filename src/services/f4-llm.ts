/**
 * F4 — LLM service: wires 6-layer Harness to live DeepSeek client.
 *
 * Pipeline per call:
 *   H1 (time gating)          → drop A/B strategies whose lastVerified > 12mo
 *                                or whose country regime is end-of-life
 *   H4 (rule injection)       → injects A/B-tier baseline + remaining strategies
 *                                into system prompt as ground truth
 *   chat() w/ H3 tools        → LLM may call calculate_tax tool; we loop
 *                                tool_calls up to MAX_TOOL_ROUNDS
 *   H2 (Zod validation)       → parse LLM JSON output via strategyArraySchema
 *   H5 (numeric validation)   → if any estimatedSavingsEur deviates > 5% from
 *                                calculator, OVERRIDE with calculator value
 *   H6 (self-check)           → deepseek-reasoner audits primary output;
 *                                if critical issues → downgrade or reject
 *
 * Every surviving recommendation receives a `[AI建议·未经确定性验证]` prefix
 * on its action_steps[0] per G2 anti-hallucination rule.
 *
 * Spec: docs/15-ai-prompts/w6-f4-harness/README.md
 *       docs/16-ai-agent-workflow.md G2
 */

import { z } from 'zod';
import type { Bindings } from '../api/index';
import {
  type RuleEngineResult,
  type StrategyRecommendation,
  TOOL_DEFINITIONS,
  buildRuleInjection,
  buildSelfCheckPrompt,
  buildSystemPrompt,
  strategyArraySchema,
  strategyRecommendationSchema,
  validateAgainstRuleEngine,
} from '../prompts/f4-harness/index';
import { calculateTax } from '../rules';
import type { CalculatorInput } from '../rules/common/types';
import type { BaselineTax, Strategy, StrategyEvaluation } from '../strategies/types';
import {
  type ChatMessage,
  DeepSeekClient,
  DeepSeekError,
  type DeepSeekToolCall,
  type DeepSeekUsage,
  type ToolDefinition,
} from './deepseek';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** Hard cap on H1 freshness: drop strategies whose lastVerified is > 12mo old. */
const H1_MAX_AGE_DAYS = 365;

/** Hard cap LLM-proposed confidence; A-tier 0.85+, B-tier 0.5-0.75, C-tier ≤ 0.7. */
const C_TIER_CONFIDENCE_CAP = 0.7;

/** Confidence downgrade applied when H6 finds non-fatal warnings. */
const H6_DOWNGRADE_CAP = 0.5;

/** Max rounds of tool-calls within a single chat() session. */
const MAX_TOOL_ROUNDS = 3;

/** Default DeepSeek per-1M-token pricing (USD; approximate, used only for cost meter). */
const COST_PER_MILLION_INPUT_USD = 0.27;
const COST_PER_MILLION_OUTPUT_USD = 1.1;

/** Default max LLM strategies returned. */
const DEFAULT_MAX_LLM_STRATEGIES = 5;

/** End-of-life regime sentinels — never recommended even if LLM proposes. */
const FORBIDDEN_STRATEGY_IDS = new Set([
  'pt.nhr',
  'uk.remittance_basis',
  'uk.non_dom_remittance',
  'nl.30pct_sliding_2024',
]);

/** Hard prefix mandated by G2 for any AI-derived recommendation. */
const AI_PREFIX = '[AI建议·未经确定性验证]';

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Output shape — combines the LLM-derived StrategyRecommendation with our
 * deterministic StrategyEvaluation fields (so callers can render uniformly
 * alongside A/B-tier results).
 */
export interface LlmStrategyEvaluation extends StrategyEvaluation {
  /** Slug or AI-proposed id. */
  id: string;
  tier: 'C';
  titleZh: string;
  /** The full LLM-emitted recommendation for downstream UI inspection. */
  raw: StrategyRecommendation;
}

export interface RecommendStrategiesOptions {
  env: Bindings;
  input: CalculatorInput;
  baseline: BaselineTax;
  existingStrategies: Strategy[];
  /** Default: 5. Caps the count of LLM recommendations returned. */
  maxLlmStrategies?: number;
  /** Test-only DI hook for the DeepSeek client. */
  client?: DeepSeekClient;
}

export interface RecommendStrategiesResult {
  llmRecommendations: LlmStrategyEvaluation[];
  /** H1-H6 override / drop notes — surfaces transparency to the UI. */
  warnings: string[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    cost: number;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// H1 — Time gating
// ────────────────────────────────────────────────────────────────────────────

/**
 * Drop strategies whose `lastVerified` is older than H1_MAX_AGE_DAYS OR whose
 * id is in the forbidden set. Returns the surviving subset plus a list of
 * drop reasons (one per dropped strategy).
 */
export function applyH1TimeGating(
  strategies: Strategy[],
  now: Date = new Date(),
): { kept: Strategy[]; warnings: string[] } {
  const warnings: string[] = [];
  const kept: Strategy[] = [];
  const cutoff = now.getTime() - H1_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  for (const s of strategies) {
    if (FORBIDDEN_STRATEGY_IDS.has(s.id)) {
      warnings.push(`H1 dropped forbidden regime: ${s.id}`);
      continue;
    }
    const verified = new Date(`${s.citation.lastVerified}T00:00:00Z`).getTime();
    if (Number.isNaN(verified) || verified < cutoff) {
      warnings.push(`H1 dropped stale strategy ${s.id} (verified ${s.citation.lastVerified})`);
      continue;
    }
    kept.push(s);
  }
  return { kept, warnings };
}

// ────────────────────────────────────────────────────────────────────────────
// H3 — Tool calling loop
// ────────────────────────────────────────────────────────────────────────────

interface ToolDispatchResult {
  toolMessages: ChatMessage[];
  toolErrors: string[];
}

function dispatchToolCalls(toolCalls: DeepSeekToolCall[]): ToolDispatchResult {
  const toolMessages: ChatMessage[] = [];
  const toolErrors: string[] = [];

  for (const call of toolCalls) {
    if (call.function.name !== 'calculate_tax') {
      toolErrors.push(`H3 unknown tool: ${call.function.name}`);
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({ error: 'unknown_tool' }),
      });
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch (err) {
      toolErrors.push(`H3 invalid tool args: ${(err as Error).message}`);
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({ error: 'invalid_arguments' }),
      });
      continue;
    }
    try {
      // Map LLM tool schema → CalculatorInput shape
      const calcInput = {
        country: parsed.country,
        taxYear: parsed.tax_year ?? parsed.taxYear ?? 2025,
        incomeType: parsed.income_type ?? parsed.incomeType ?? 'salary',
        grossIncome: parsed.gross_income ?? parsed.grossIncome,
        specialStatus: parsed.special_status ?? parsed.specialStatus ?? 'none',
        filingStatus: parsed.filing_status ?? parsed.filingStatus ?? 'single',
        region: parsed.region,
      };
      const result = calculateTax(calcInput);
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({
          country: result.country,
          taxYear: result.taxYear,
          grossIncome: result.grossIncome,
          taxOwed: result.taxOwed,
          netIncome: result.netIncome,
          effectiveRate: result.effectiveRate,
          marginalRate: result.marginalRate,
        }),
      });
    } catch (err) {
      toolErrors.push(`H3 calculate_tax failed: ${(err as Error).message}`);
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({ error: (err as Error).message }),
      });
    }
  }
  return { toolMessages, toolErrors };
}

// ────────────────────────────────────────────────────────────────────────────
// H5 — Output validation against deterministic calculator
// ────────────────────────────────────────────────────────────────────────────

/**
 * For each LLM recommendation with a numeric `estimated_savings_eur`, attempt
 * to validate by re-running the calculator with the same input + the strategy's
 * implied special_status (if extractable from id). If deviation > 5%, OVERRIDE
 * with the calculator value (don't just warn).
 *
 * Limitation: we can only validate strategies that map cleanly to a calculator
 * invocation (i.e. specialStatus opt-in regimes). Pure deduction strategies
 * are left as-is; the H4 rule injection is the primary anchor there.
 */
export function applyH5NumericValidation(
  recommendations: StrategyRecommendation[],
  input: CalculatorInput,
  baseline: BaselineTax,
): { validated: StrategyRecommendation[]; warnings: string[] } {
  const warnings: string[] = [];
  const validated = recommendations.map((rec) => {
    if (rec.estimated_savings_eur === null || rec.estimated_savings_eur === undefined) {
      return rec;
    }

    // Try to infer special_status from id. Conservative — only validate the
    // 5 known regime IDs we have calculators for.
    const regimeMap: Record<string, CalculatorInput['specialStatus']> = {
      'es.beckham': 'beckham',
      'pt.ifici': 'ifici',
      'uk.fig': 'fig',
      'nl.30percent': '30pct_ruling',
      'de.forschungspauschale': 'forschungspauschale',
    };
    const specialStatus = regimeMap[rec.strategy_id];
    if (!specialStatus) {
      // No way to deterministically validate — leave unchanged (H6 will catch)
      return rec;
    }

    try {
      const regimeInput: CalculatorInput = { ...input, specialStatus };
      const regimeResult = calculateTax(regimeInput);
      const deterministicSavings = baseline.taxOwed - regimeResult.taxOwed;
      const llmSavings = rec.estimated_savings_eur;
      const denom = Math.max(1, Math.abs(deterministicSavings));
      const deviation = Math.abs(llmSavings - deterministicSavings) / denom;
      if (deviation > 0.05) {
        warnings.push(
          `H5 OVERRIDE ${rec.strategy_id}: LLM €${llmSavings.toFixed(0)} vs calculator €${deterministicSavings.toFixed(0)} (Δ ${(deviation * 100).toFixed(1)}%)`,
        );
        return { ...rec, estimated_savings_eur: Math.round(deterministicSavings) };
      }
      return rec;
    } catch (err) {
      warnings.push(`H5 validator failed for ${rec.strategy_id}: ${(err as Error).message}`);
      return rec;
    }
  });
  return { validated, warnings };
}

// ────────────────────────────────────────────────────────────────────────────
// H6 — Self-check via deepseek-reasoner
// ────────────────────────────────────────────────────────────────────────────

const selfCheckResponseSchema = z.object({
  issues: z
    .array(
      z.object({
        recommendation_index: z.number().int().nonnegative(),
        issue: z.string(),
        severity: z.enum(['error', 'warning']),
      }),
    )
    .default([]),
  overall_verdict: z.enum(['pass', 'fail']).default('pass'),
});

export async function applyH6SelfCheck(
  client: DeepSeekClient,
  recommendations: StrategyRecommendation[],
): Promise<{
  adjusted: StrategyRecommendation[];
  rejectedIndices: Set<number>;
  warnings: string[];
  usage: DeepSeekUsage | undefined;
}> {
  const warnings: string[] = [];
  if (recommendations.length === 0) {
    return { adjusted: [], rejectedIndices: new Set(), warnings, usage: undefined };
  }

  const prompt = buildSelfCheckPrompt(recommendations);
  let raw: string;
  let usage: DeepSeekUsage | undefined;
  try {
    const res = await client.selfCheck([
      { role: 'system', content: 'You are a strict tax-compliance auditor.' },
      { role: 'user', content: prompt },
    ]);
    raw = res.choices[0]?.message.content ?? '';
    usage = res.usage;
  } catch (err) {
    warnings.push(`H6 self-check call failed: ${(err as Error).message}`);
    return { adjusted: recommendations, rejectedIndices: new Set(), warnings, usage: undefined };
  }

  const json = extractJsonObject(raw);
  if (!json) {
    warnings.push('H6 self-check returned non-JSON; preserving primary output');
    return { adjusted: recommendations, rejectedIndices: new Set(), warnings, usage };
  }
  const parsed = selfCheckResponseSchema.safeParse(json);
  if (!parsed.success) {
    warnings.push('H6 self-check response failed schema; preserving primary output');
    return { adjusted: recommendations, rejectedIndices: new Set(), warnings, usage };
  }

  const rejectedIndices = new Set<number>();
  // Bucket issues per recommendation
  const perIdx = new Map<number, Array<{ issue: string; severity: 'error' | 'warning' }>>();
  for (const it of parsed.data.issues) {
    if (it.recommendation_index >= recommendations.length) continue;
    const arr = perIdx.get(it.recommendation_index) ?? [];
    arr.push({ issue: it.issue, severity: it.severity });
    perIdx.set(it.recommendation_index, arr);
  }

  const adjusted = recommendations.map((rec, i) => {
    const issues = perIdx.get(i) ?? [];
    const errorIssues = issues.filter((x) => x.severity === 'error');
    if (errorIssues.length > 0) {
      // Reject: H6 found a critical error
      rejectedIndices.add(i);
      warnings.push(`H6 REJECT ${rec.strategy_id}: ${errorIssues.map((e) => e.issue).join('; ')}`);
      return rec;
    }
    if (issues.length > 0) {
      // Warning-only: downgrade confidence
      const downgraded = Math.min(rec.confidence, H6_DOWNGRADE_CAP);
      warnings.push(
        `H6 DOWNGRADE ${rec.strategy_id} confidence ${rec.confidence}→${downgraded}: ${issues.map((i2) => i2.issue).join('; ')}`,
      );
      const merged = [...rec.warnings, ...issues.map((i2) => i2.issue)];
      return { ...rec, confidence: downgraded, warnings: merged };
    }
    return rec;
  });

  return { adjusted, rejectedIndices, warnings, usage };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  // Try direct parse first
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try to extract from markdown code fence
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence?.[1]) {
      try {
        return JSON.parse(fence[1].trim());
      } catch {
        return null;
      }
    }
    // Try to extract first JSON object
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function strategyToRuleEngineResult(s: Strategy, ev: StrategyEvaluation): RuleEngineResult | null {
  if (s.tier !== 'A' && s.tier !== 'B') return null;
  return {
    strategy_id: s.id,
    tier: s.tier,
    eligible: ev.applicable,
    estimated_savings_eur: ev.estimatedSavingsEur ?? null,
    reasoning_seed: ev.reason,
    citations: [{ law_reference: s.citation.source, url: s.citation.url }],
  };
}

function computeCost(usage: { prompt_tokens: number; completion_tokens: number }): number {
  return (
    (usage.prompt_tokens / 1_000_000) * COST_PER_MILLION_INPUT_USD +
    (usage.completion_tokens / 1_000_000) * COST_PER_MILLION_OUTPUT_USD
  );
}

function buildUserPrompt(input: CalculatorInput, baseline: BaselineTax): string {
  return `# Taxpayer profile
- Country: ${input.country}
- Tax year: ${input.taxYear}
- Income type: ${input.incomeType}
- Gross income: €${input.grossIncome}
- Special status: ${input.specialStatus}
- Filing status: ${input.filingStatus}
- Region: ${input.region ?? '(none)'}
- Age: ${input.age ?? '(not provided)'}

# Baseline (deterministic — no strategy applied)
- Tax owed: €${baseline.taxOwed.toFixed(2)}
- Net income: €${baseline.netIncome.toFixed(2)}
- Effective rate: ${(baseline.effectiveRate * 100).toFixed(2)}%
- Marginal rate: ${(baseline.marginalRate * 100).toFixed(2)}%

# Task
Propose up to 5 creative C-tier tax-saving strategies for this profile that
are NOT already covered by the rule-engine results above. For each one:
- Pick a unique strategy_id (e.g. eu.holding_company_structuring).
- Mark tier = "C".
- Provide a clear chain-of-reasoning + at least one statute citation.
- Use the calculate_tax tool for any numeric figure — do not compute manually.
- Cap confidence at ${C_TIER_CONFIDENCE_CAP}.
- Action steps array: 2-6 practical items.

Output ONLY the strategyArraySchema JSON.`;
}

// ────────────────────────────────────────────────────────────────────────────
// Main entry
// ────────────────────────────────────────────────────────────────────────────

export async function recommendStrategies(
  opts: RecommendStrategiesOptions,
): Promise<RecommendStrategiesResult> {
  const client = opts.client ?? new DeepSeekClient(opts.env);
  const warnings: string[] = [];
  const maxLlm = opts.maxLlmStrategies ?? DEFAULT_MAX_LLM_STRATEGIES;

  // ── H1: drop stale / forbidden strategies ─────────────────────────────────
  const { kept: h1Kept, warnings: h1Warnings } = applyH1TimeGating(opts.existingStrategies);
  warnings.push(...h1Warnings);

  // ── H4: build rule-injection from surviving A/B strategies ────────────────
  const ruleResults: RuleEngineResult[] = [];
  for (const s of h1Kept) {
    try {
      const ev = s.evaluate(opts.input, opts.baseline);
      const r = strategyToRuleEngineResult(s, ev);
      if (r) ruleResults.push(r);
    } catch (err) {
      warnings.push(`H4 strategy eval failed ${s.id}: ${(err as Error).message}`);
    }
  }
  const ruleInjection = buildRuleInjection(ruleResults);

  // ── Build prompts ──────────────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt({
    taxYear: opts.input.taxYear,
    countries: [opts.input.country],
  });
  const userPrompt = buildUserPrompt(opts.input, opts.baseline);

  const messages: ChatMessage[] = [
    { role: 'system', content: `${systemPrompt}\n\n${ruleInjection}` },
    { role: 'user', content: userPrompt },
  ];

  // ── H3: chat() with tool calling loop ─────────────────────────────────────
  let promptTokens = 0;
  let completionTokens = 0;
  let finalContent = '';

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let response: Awaited<ReturnType<DeepSeekClient['chat']>> | undefined;
    try {
      response = await client.chat(messages, {
        tools: TOOL_DEFINITIONS as unknown as ToolDefinition[],
        temperature: 0.2,
      });
    } catch (err) {
      if (err instanceof DeepSeekError) {
        warnings.push(`H3 chat failed: ${err.message}`);
      } else {
        warnings.push(`H3 chat failed: ${(err as Error).message}`);
      }
      return {
        llmRecommendations: [],
        warnings,
        usage: { promptTokens, completionTokens, cost: 0 },
      };
    }
    if (response.usage) {
      promptTokens += response.usage.prompt_tokens;
      completionTokens += response.usage.completion_tokens;
    }
    const choice = response.choices[0];
    const message = choice.message;

    if (message.tool_calls && message.tool_calls.length > 0) {
      // Append assistant message (with tool_calls) so the next round has context
      messages.push({
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.tool_calls,
      });
      const { toolMessages, toolErrors } = dispatchToolCalls(message.tool_calls);
      warnings.push(...toolErrors);
      messages.push(...toolMessages);

      if (round === MAX_TOOL_ROUNDS) {
        warnings.push(`H3 max tool rounds (${MAX_TOOL_ROUNDS}) reached; aborting`);
        break;
      }
      continue;
    }

    // Final content
    finalContent = message.content ?? '';
    break;
  }

  // ── H2: Zod validation of LLM output ──────────────────────────────────────
  const json = extractJsonObject(finalContent);
  if (!json) {
    warnings.push('H2 rejected: LLM output is not valid JSON');
    return {
      llmRecommendations: [],
      warnings,
      usage: {
        promptTokens,
        completionTokens,
        cost: computeCost({ prompt_tokens: promptTokens, completion_tokens: completionTokens }),
      },
    };
  }
  const arrParse = strategyArraySchema.safeParse(json);
  let recommendations: StrategyRecommendation[];
  if (arrParse.success) {
    recommendations = arrParse.data.recommendations;
  } else {
    // Fallback: try schema on a bare array
    const arrayOnly = z.array(strategyRecommendationSchema).safeParse(json);
    if (arrayOnly.success) {
      recommendations = arrayOnly.data;
    } else {
      warnings.push(
        `H2 rejected: schema validation failed (${arrParse.error.issues.length} issues)`,
      );
      return {
        llmRecommendations: [],
        warnings,
        usage: {
          promptTokens,
          completionTokens,
          cost: computeCost({ prompt_tokens: promptTokens, completion_tokens: completionTokens }),
        },
      };
    }
  }

  // Filter out any recommendation matching a forbidden id (defence in depth)
  recommendations = recommendations.filter((rec) => {
    if (FORBIDDEN_STRATEGY_IDS.has(rec.strategy_id)) {
      warnings.push(`H1 post-filter dropped forbidden id from LLM: ${rec.strategy_id}`);
      return false;
    }
    return true;
  });

  // ── Cross-check vs rule-engine (uses existing harness helper) ─────────────
  const { issues: ruleIssues, corrected } = validateAgainstRuleEngine(recommendations, ruleResults);
  for (const issue of ruleIssues) {
    warnings.push(`H5(rule) ${issue.kind} @${issue.recommendation_index}: ${issue.detail}`);
  }
  recommendations = corrected;

  // ── H5: numeric deviation re-validation against fresh calculator ──────────
  const { validated, warnings: h5Warnings } = applyH5NumericValidation(
    recommendations,
    opts.input,
    opts.baseline,
  );
  warnings.push(...h5Warnings);
  recommendations = validated;

  // ── H6: self-check via deepseek-reasoner ──────────────────────────────────
  const h6 = await applyH6SelfCheck(client, recommendations);
  warnings.push(...h6.warnings);
  if (h6.usage) {
    promptTokens += h6.usage.prompt_tokens;
    completionTokens += h6.usage.completion_tokens;
  }
  const surviving = h6.adjusted.filter((_, i) => !h6.rejectedIndices.has(i));

  // ── Cap confidence + apply G2 prefix; convert to public output shape ──────
  const llmRecommendations: LlmStrategyEvaluation[] = surviving.slice(0, maxLlm).map((rec) => {
    const cappedConfidence = Math.min(rec.confidence, C_TIER_CONFIDENCE_CAP);
    const prefixedSteps =
      rec.action_steps.length === 0
        ? [AI_PREFIX]
        : [`${AI_PREFIX} ${rec.action_steps[0]}`, ...rec.action_steps.slice(1)];
    const finalRec: StrategyRecommendation = {
      ...rec,
      confidence: cappedConfidence,
      action_steps: prefixedSteps,
      tier: 'C',
    };
    return {
      id: rec.strategy_id,
      tier: 'C' as const,
      titleZh: `${AI_PREFIX} ${rec.strategy_id}`,
      applicable: rec.eligible,
      reason: rec.reasoning,
      estimatedSavingsEur: rec.estimated_savings_eur,
      confidence: cappedConfidence,
      raw: finalRec,
    };
  });

  if (surviving.length > maxLlm) {
    warnings.push(`Capped LLM recommendations at ${maxLlm} (received ${surviving.length})`);
  }

  return {
    llmRecommendations,
    warnings,
    usage: {
      promptTokens,
      completionTokens,
      cost: computeCost({
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      }),
    },
  };
}
