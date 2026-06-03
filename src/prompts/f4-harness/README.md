# F4 — 6-Layer Harness Prompts (Product Runtime)

This directory holds the prompt scaffolding for the **F4 节税策略推荐** feature.
Each file maps to one of the six defence layers documented in `docs/08-feature-feasibility.md`
decision A.

## Layer map

| # | Layer | File | Purpose | Runtime cost |
|---|-------|------|---------|--------------|
| H1 | Time-gated RAG | `index.ts → buildSystemPrompt` | System prompt only ever sees CURRENT tax-year docs; hard-blocks NHR/Non-Dom/30%-sliding | $0 |
| H2 | Structured output | `index.ts → strategyRecommendationSchema` | Zod schema validates LLM JSON; up to 3 retries | $0 |
| H3 | Calculator tool | `index.ts → TOOL_DEFINITIONS` | LLM never does math; calls F1 calculator via tool call | $0 |
| H4 | Rule injection | `index.ts → buildRuleInjection` | A/B-tier rule engine results forcibly injected as authoritative context | $0 |
| H5 | Output validation | `index.ts → validateAgainstRuleEngine` | Numeric deviation > 5% / eligibility mismatch / unknown citation → override or flag | $0 |
| H6 | Self-check prompt | `index.ts → buildSelfCheckPrompt` | Secondary cheap-model audit; flags any remaining hallucinations | ~$0.003/call |

## Estimated hallucination elimination (from docs/08)

| Type | Before | After 6-layer harness |
|------|--------|----------------------|
| Factual | ~40% | <3% |
| Numeric | ~30% | <1% |
| Citation | ~25% | <5% |
| Logical | ~15% | 5-8% |
| Omission | ~20% | <2% |
| **Composite** | — | **80-85% eliminated** |

## Runtime call sequence

```
user request
   │
   ▼
[rule engine: A-tier + B-tier preflight] ──┐
   │                                         │
   ▼                                         │
buildSystemPrompt(H1) + buildRuleInjection(H4)
   │
   ▼
DeepSeek V4 with TOOL_DEFINITIONS (H3) ─── may call calculate_tax ─→ F1 engine
   │
   ▼
strategyArraySchema.parse() (H2) ──── retry up to 3x on failure
   │
   ▼
validateAgainstRuleEngine() (H5) ──── apply corrections
   │
   ▼
buildSelfCheckPrompt() → secondary LLM (H6)
   │
   ▼
final response to user (with [AI建议] tag on C-tier items)
```

## When to update

- New A-tier strategy added → extend `RuleEngineResult` and inject via H4
- New tax-year cycle (annual) → bump `taxYear` in `buildSystemPrompt` callers
- Repealed regime appears → add to `excludedRegimes` parameter
- Hallucination pattern observed → tighten Zod schema (H2) + audit prompt (H6)
