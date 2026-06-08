# C-Tier LLM Strategy Seeds — Reference Catalog

**Status**: W6-F4 Wave C reference document
**Purpose**: Documented seed strategies that the LLM Harness may legitimately propose to users. Each seed is a real, legally-grounded tax planning concept (not bundled as an A/B-tier deterministic strategy) that the C-tier LLM pipeline may surface and refine via H1-H6 validation.

> **G2 Anti-Hallucination**: Every C-tier recommendation, even when seeded from this list, MUST be wrapped with the `[AI建议·未经确定性验证]` prefix on its first action step and gated by the full H1-H6 harness before reaching the user.

---

## Seed 1 — `es.sicav_alternative`

- **Country**: ES (Spain)
- **Concept**: Alternative collective investment vehicles (Sociedad de Inversión de Capital Variable replacements after 2023 reform). Allows deferral of capital gains within qualified Spanish CIVs.
- **Legal basis**: Ley 35/2006 IRPF art. 94 + Ley 27/2014 IS art. 29.
- **Why seeded (not bundled A/B)**: Eligibility depends on personal investment profile + advisor structuring; cannot be reduced to a flat rule. LLM must reason about user's investment horizon and asset class.
- **Forbidden patterns**: Must NOT suggest the obsolete pre-2023 SICAV-100 structure; reform replaced it with stricter participation rules.
- **Typical savings range**: 8,000–15,000 EUR/year for HNW investors with ≥ 100k EUR equity portfolio.

---

## Seed 2 — `es.deduccion_inversion_emergentes`

- **Country**: ES
- **Concept**: Deduction for investment in newly listed companies / startups under Ley de Startups 28/2022.
- **Legal basis**: Ley 35/2006 IRPF art. 68.1 + Ley 28/2022 art. 7.
- **Why seeded**: Requires manual evaluation of specific startup eligibility (sector, age, certification). LLM walks user through qualification checklist.
- **Forbidden patterns**: Must NOT generalize to all equity investments; only certified `empresa emergente` qualifies.
- **Typical savings range**: 3,000–10,000 EUR/year.

---

## Seed 3 — `de.familienstiftung`

- **Country**: DE (Germany)
- **Concept**: Family foundation (Familienstiftung) for intergenerational wealth holding with reduced inheritance tax exposure.
- **Legal basis**: Erbschaftsteuergesetz § 9 Abs. 1 Nr. 4 + AO § 51 ff.
- **Why seeded**: Setup is highly individualized; only suitable for users with > 1M EUR transferrable assets and intention to lock capital for 30+ years. LLM screens viability.
- **Forbidden patterns**: Must NOT propose for users below the 400k EUR exemption threshold per beneficiary (would be net-negative due to setup costs).
- **Typical savings range**: 30,000–80,000 EUR over lifetime; bias toward inheritance/gift tax not income tax.

---

## Seed 4 — `pt.golden_visa_reit`

- **Country**: PT (Portugal)
- **Concept**: Golden Visa qualifying investment via Portuguese-domiciled REITs / regulated investment funds (post-2023 reform: real estate routes removed).
- **Legal basis**: Lei 102/2017 art. 90.º-A + DL 14/2023 art. 5.
- **Why seeded**: Eligibility tied to user's residency goals + capital availability. LLM tailors to non-EU clients seeking EU residence.
- **Forbidden patterns**: MUST refuse to recommend the now-defunct real estate route. MUST NOT confuse with NHR (which is in our `FORBIDDEN_STRATEGY_IDS` blocklist).
- **Typical savings range**: Indirect — residency value, not direct tax deduction. LLM should be explicit this is residency planning, not income tax minimization.

---

## Seed 5 — `eu.dac6_safe_harbor`

- **Country**: EU-wide (cross-border)
- **Concept**: Safe-harbor reporting under DAC6 for legitimate cross-border arrangements that fall outside reportable hallmarks A-E.
- **Legal basis**: Council Directive (EU) 2018/822 (DAC6) + national transpositions.
- **Why seeded**: Highly fact-specific; LLM helps user document why their arrangement is non-reportable.
- **Forbidden patterns**: Must NOT advise structures designed primarily to circumvent reporting. Must reference local advisor confirmation requirement.
- **Typical savings range**: Indirect — compliance cost avoidance (5,000–20,000 EUR in advisor fees + penalty avoidance).

---

## Seed 6 — `nl.box3_alternative_post2027`

- **Country**: NL (Netherlands)
- **Concept**: Post-2027 Box 3 actual-yield wealth tax regime restructuring (replacing the fictitious-yield system ruled unconstitutional in 2021).
- **Legal basis**: Wet IB 2001 hoofdstuk 5 + Wet rechtsherstel box 3 + Wet werkelijk rendement box 3 (in voorbereiding).
- **Why seeded**: Regime is in transition; LLM must surface latest legislative status and warn about uncertainty.
- **Forbidden patterns**: Must NOT recommend strategies relying on the rejected fictitious-yield calculation. MUST flag transitional uncertainty in confidence score.
- **Typical savings range**: 1,500–8,000 EUR/year on portfolios > 200k EUR.

---

## Seed 7 — `fr.pea_pme_optimization`

- **Country**: FR (France)
- **Concept**: PEA-PME (Plan d'Épargne en Actions pour les PME) holding strategy for SME equity with 5-year tax shelter window.
- **Legal basis**: Code monétaire et financier art. L221-32-1 + CGI art. 150-0 A.
- **Why seeded**: Requires individual portfolio mapping; LLM checks current SME holdings against PEA-PME eligibility.
- **Forbidden patterns**: Must NOT bundle with standard PEA (different limits, different tax base). Must respect 225,000 EUR cap (combined PEA + PEA-PME).
- **Typical savings range**: 2,000–6,000 EUR/year post-5-year window.

---

## Seed 8 — `eu.cross_border_pension_consolidation`

- **Country**: EU-wide
- **Concept**: Consolidation of pension rights across EU member states under PEPP (Pan-European Personal Pension Product) or bilateral coordination (Reg. 883/2004).
- **Legal basis**: Regulation (EU) 2019/1238 (PEPP) + Regulation (EC) 883/2004 (social security coordination).
- **Why seeded**: Highly individual — depends on user's contribution history across countries. LLM gathers facts and proposes coordination path.
- **Forbidden patterns**: Must NOT suggest transferring pension rights into a single jurisdiction without weighing loss of country-specific guarantees. MUST advise consultation with local pension authority.
- **Typical savings range**: Cumulative — improved pension value of 20,000–100,000 EUR over retirement, not annual income tax savings.

---

## How H1-H6 Apply to These Seeds

| Layer | Behavior for Seeds |
|-------|---------------------|
| **H1** (time gating) | Seeds themselves are not bundled Strategies, so the lastVerified check doesn't apply. But H1 BLOCKS the forbidden ids list (`pt.nhr`, `uk.remittance_basis`, etc.) which sit *alongside* these seeds. |
| **H2** (Zod) | LLM output for these seeds must conform to `strategyArraySchema` — `reasoning` 20-2000 chars, `confidence` 0-1, citations array required. |
| **H3** (tools) | LLM may invoke `calculate_tax` to ground baseline tax numbers when sizing each seed's savings. |
| **H4** (rule injection) | The deterministic A/B-tier rule engine results are injected into the system prompt so the LLM doesn't duplicate them as C-tier suggestions. |
| **H5** (numeric) | Any `estimated_savings_eur` deviating > 5% from the calculator's regimeMap is OVERRIDDEN — the LLM's number is replaced with the deterministic one. |
| **H6** (self-check) | `deepseek-reasoner` audits the primary output; if critical issues found (e.g., wrong legal citation, forbidden regime), the seed is REJECTED entirely. If non-critical, confidence is downgraded to ≤ 0.5. |

---

## Maintenance

- **Last reviewed**: 2026-06-08
- **Next review due**: 2026-12-08 (6-month cadence)
- **Owner**: F4 strategy curation
- **Add-seed checklist**: legal basis cited, forbidden patterns documented, expected savings range bounded, H1-H6 implications described.
