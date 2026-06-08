/**
 * F4 — Oracle P1#4 adversarial tests.
 *
 * Per docs/16-ai-agent-workflow.md G2 (anti-hallucination): the strategy
 * registry MUST NOT silently surface tax regimes that have been repealed,
 * abolished, or never existed in the form the model imagined them. These
 * tests pin the absences explicitly so a future LLM-generated PR cannot
 * smuggle a forbidden regime back in.
 *
 * Verified regime status (as of 2026-06-08):
 *   - PT NHR — closed to NEW residents from 2024-01-01 (Lei 82/2023).
 *     Replacement is IFICI (incentive fiscal à investigação e inovação)
 *     which IS in the registry as `pt.ifici`.
 *   - UK Non-Dom Remittance Basis — abolished 2025-04-06, replaced by
 *     the 4-year Foreign Income & Gains (FIG) regime. `uk.fig` is in
 *     the registry; remittance variants must NOT be.
 *   - NL 30% Ruling — Belastingplan 2025 REVERTED the 30/20/10 sliding
 *     scale (which was scheduled for 2024) back to a flat 30% for the
 *     first 5 years. We must NOT describe the strategy in sliding terms.
 *   - ES Beckham — 6 tax years (year of arrival + 5 following = 6),
 *     never 10. Earlier model drafts confused this with the Italian
 *     Impatriati 10-year extension.
 */

import { describe, expect, it } from 'vitest';
import { STRATEGIES } from './index';

describe('Forbidden regimes (G2 anti-hallucination)', () => {
  it('does NOT register PT NHR (closed 2024-01-01)', () => {
    const ids = STRATEGIES.map((s) => s.id);
    expect(ids).not.toContain('pt.nhr');
    expect(ids.find((id) => id.toLowerCase().includes('nhr'))).toBeUndefined();
  });

  it('does NOT register UK Non-Dom Remittance (abolished 2025-04-06)', () => {
    const ids = STRATEGIES.map((s) => s.id);
    expect(ids).not.toContain('uk.non_dom');
    expect(ids).not.toContain('uk.remittance_basis');
    expect(ids.find((id) => id.toLowerCase().includes('remittance'))).toBeUndefined();
    expect(ids.find((id) => id.toLowerCase().includes('non_dom'))).toBeUndefined();
  });

  it('does NOT describe NL 30/20/10 sliding scale as ACTIVE (reverted to flat 30% in 2025)', () => {
    const nl30 = STRATEGIES.find((s) => s.id === 'nl.30percent');
    expect(nl30).toBeDefined();
    const text = `${nl30!.titleZh} ${nl30!.descriptionZh}`;
    // The descriptionZh MAY mention 30/20/10 to explain that it was reverted
    // (that is a historically correct note). What it MUST NOT do is describe
    // 30/20/10 as the active rule. The titleZh — which is the short, active
    // claim — must contain neither "30/20/10" nor sliding/階梯/滑梯 language.
    expect(nl30!.titleZh).not.toMatch(/30\/20\/10|sliding|滑梯|阶梯/i);
    // And the descriptionZh, if it mentions 30/20/10 at all, must do so in a
    // reverted/cancelled context (取消|撤销|reverted|cancelled|abolished).
    if (/30\/20\/10/.test(text)) {
      expect(text).toMatch(/取消|撤销|恢复|reverted|cancelled|abolished/i);
    }
  });

  it('Beckham strategy uses ≤ 6 tax years (5+1), NEVER 10 years', () => {
    const beckham = STRATEGIES.find((s) => s.id === 'es.beckham');
    expect(beckham).toBeDefined();
    expect(beckham!.eligibility.taxYears.length).toBeGreaterThanOrEqual(1);
    expect(beckham!.eligibility.taxYears.length).toBeLessThanOrEqual(6);
  });
});
