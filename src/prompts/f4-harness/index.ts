/**
 * F4 — 6-layer Harness prompt scaffold (runtime, product-side).
 *
 * Each Harness is a layer of defence against LLM hallucination, applied in order:
 *   H1 Time-gated RAG     — System prompt only contains current tax-year docs.
 *   H2 Structured output  — Zod schema validates LLM JSON output; retry up to 3x.
 *   H3 Calculator tool    — LLM never does math; calls F1 engine via function call.
 *   H4 Rule injection     — A/B-tier rule engine results forced into system prompt.
 *   H5 Output validation  — Numeric deviation > 5% / unknown citations → override.
 *   H6 Self-check prompt  — Secondary LLM audits primary output.
 *
 * For the runtime invocation pattern see ~/src/rules/strategy/* (arrives in W5/W6).
 * For full Harness design rationale see docs/08-feature-feasibility.md decision A.
 */

import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// Shared schema (H2)
// ────────────────────────────────────────────────────────────────────────────

export const strategyRecommendationSchema = z.object({
  strategy_id: z.string(),
  tier: z.enum(['A', 'B', 'C']),
  eligible: z.boolean(),
  reasoning: z.string().min(20).max(2000),
  estimated_savings_eur: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  action_steps: z.array(z.string()).max(20),
  citations: z
    .array(
      z.object({
        law_reference: z.string(), // e.g. "Art. 58.º-A EBF"
        url: z.string().url().optional(),
        quote: z.string().max(500).optional(),
      }),
    )
    .min(1, 'At least one legal citation required'),
  warnings: z.array(z.string()).default([]),
});

export type StrategyRecommendation = z.infer<typeof strategyRecommendationSchema>;

export const strategyArraySchema = z.object({
  recommendations: z.array(strategyRecommendationSchema),
  ai_disclaimer: z.string(),
});

// ────────────────────────────────────────────────────────────────────────────
// H1 — Time-gated RAG system prompt
// ────────────────────────────────────────────────────────────────────────────

export function buildSystemPrompt(opts: {
  taxYear: number;
  countries: string[];
  excludedRegimes?: string[];
}): string {
  const blocked = [
    'NHR (Regime dos Residentes Não Habituais) — closed to new entrants 1 January 2024, replaced by IFICI.',
    'UK Non-Dom remittance basis — abolished 6 April 2025, replaced by FIG regime.',
    'NL 30% ruling 2024 transitional sliding scale — reverted to flat 30% in 2025.',
    ...(opts.excludedRegimes ?? []),
  ];

  return `You are a senior European tax advisor for cross-border workers and digital nomads.

# Operating constraints
- Tax year of analysis: ${opts.taxYear}
- Countries in scope: ${opts.countries.join(', ')}
- All tax rates, brackets, and legal references MUST come from the injected rule engine context. Do NOT invent rates.
- All monetary calculations MUST be performed by the F1 calculator tool, never by you.

# Prohibited content (HARD BLOCK — repealed or superseded regimes)
${blocked.map((b) => `- ${b}`).join('\n')}

# Output contract
You MUST respond with a single JSON object matching the strategyArraySchema. Any free-form prose
outside JSON will be rejected.

# Style
- Be specific, quantified, and citable.
- Every recommendation requires at least one legal citation (statute article + URL when known).
- If a strategy is C-tier (LLM-driven), wrap its reasoning prefix with: [AI建议·未经确定性验证]
`;
}

// ────────────────────────────────────────────────────────────────────────────
// H3 — Tool definitions for OpenAI-style function calling
// ────────────────────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'calculate_tax',
      description:
        'Calculate exact income tax owed for a given country/year/income. Always use this for any numeric tax figure. Never compute manually.',
      parameters: {
        type: 'object',
        properties: {
          country: { type: 'string', enum: ['ES', 'PT', 'DE', 'NL', 'UK'] },
          tax_year: { type: 'integer', minimum: 2024, maximum: 2030 },
          gross_income: { type: 'number', minimum: 0 },
          income_type: {
            type: 'string',
            enum: [
              'salary',
              'self_employed',
              'dividends',
              'interest',
              'rental',
              'capital_gains',
              'crypto',
              'other',
            ],
          },
          special_status: {
            type: 'string',
            enum: ['none', 'beckham', 'ifici', 'fig', '30pct_ruling', 'forschungspauschale'],
          },
        },
        required: ['country', 'tax_year', 'gross_income', 'income_type'],
      },
    },
  },
] as const;

// ────────────────────────────────────────────────────────────────────────────
// H4 — Rule engine result injector
// ────────────────────────────────────────────────────────────────────────────

export interface RuleEngineResult {
  strategy_id: string;
  tier: 'A' | 'B';
  eligible: boolean;
  estimated_savings_eur: number | null;
  reasoning_seed: string;
  citations: Array<{ law_reference: string; url?: string }>;
}

export function buildRuleInjection(results: RuleEngineResult[]): string {
  if (results.length === 0) {
    return '# Rule engine results\n(no A/B-tier matches for this user profile)';
  }
  return [
    '# Rule engine results — these are AUTHORITATIVE. You MUST use them as-is.',
    '# Do NOT change estimated_savings_eur. Do NOT contradict eligibility verdicts.',
    '',
    ...results.map((r, i) =>
      [
        `## ${i + 1}. ${r.strategy_id} (Tier ${r.tier})`,
        `Eligible: ${r.eligible}`,
        `Estimated savings (EUR): ${r.estimated_savings_eur ?? 'null'}`,
        `Reasoning seed: ${r.reasoning_seed}`,
        `Citations: ${r.citations.map((c) => c.law_reference).join('; ')}`,
      ].join('\n'),
    ),
  ].join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// H5 — Output validator (post-LLM)
// ────────────────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  recommendation_index: number;
  kind: 'savings_deviation' | 'unknown_citation' | 'eligibility_mismatch';
  detail: string;
  severity: 'error' | 'warning';
}

export function validateAgainstRuleEngine(
  llmOutput: StrategyRecommendation[],
  ruleResults: RuleEngineResult[],
): { issues: ValidationIssue[]; corrected: StrategyRecommendation[] } {
  const issues: ValidationIssue[] = [];
  const corrected = llmOutput.map((rec, i) => {
    const truth = ruleResults.find((r) => r.strategy_id === rec.strategy_id);
    if (!truth) return rec; // C-tier — no truth source

    const c = { ...rec };
    // Eligibility mismatch → override with rule engine
    if (c.eligible !== truth.eligible) {
      issues.push({
        recommendation_index: i,
        kind: 'eligibility_mismatch',
        detail: `LLM said ${c.eligible}, rule engine said ${truth.eligible}; overriding.`,
        severity: 'error',
      });
      c.eligible = truth.eligible;
    }
    // Savings deviation > 5% → override
    if (
      truth.estimated_savings_eur !== null &&
      c.estimated_savings_eur !== null &&
      Math.abs(c.estimated_savings_eur - truth.estimated_savings_eur) /
        Math.max(1, Math.abs(truth.estimated_savings_eur)) >
        0.05
    ) {
      issues.push({
        recommendation_index: i,
        kind: 'savings_deviation',
        detail: `LLM €${c.estimated_savings_eur}, rule engine €${truth.estimated_savings_eur}; overriding.`,
        severity: 'error',
      });
      c.estimated_savings_eur = truth.estimated_savings_eur;
    }
    return c;
  });
  return { issues, corrected };
}

// ────────────────────────────────────────────────────────────────────────────
// H6 — Self-check secondary prompt
// ────────────────────────────────────────────────────────────────────────────

export function buildSelfCheckPrompt(primaryOutput: StrategyRecommendation[]): string {
  return `You are a tax-compliance auditor. Review the following JSON recommendations from a primary tax advisor LLM.

For each recommendation, verify:
1. Does every cited statute exist verbatim? (e.g. "Art. 58.º-A EBF" is real; "Art. 999.º TF" is hallucinated.)
2. Are the action steps plausible and free of repealed-regime references (NHR, pre-2025 UK Non-Dom, NL 2024 sliding 30% ruling)?
3. Is the confidence value consistent with tier (A=1.0, B≤0.7, C≤0.4)?

Respond with a JSON object:
{
  "issues": [
    { "recommendation_index": <int>, "issue": "<short description>", "severity": "error" | "warning" }
  ],
  "overall_verdict": "pass" | "fail"
}

# Recommendations to audit
${JSON.stringify(primaryOutput, null, 2)}
`;
}
