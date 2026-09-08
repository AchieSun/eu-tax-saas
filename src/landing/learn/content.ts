/**
 * learn/content.ts — knowledge-platform article registry (phase 1 seed).
 *
 * Articles are structured TS data (not markdown): the repo already models
 * rich domain data (22 strategies, bilingual dictionaries) as typed modules,
 * and SSR-ing typed blocks avoids adding a markdown dependency + parser to
 * the Worker while keeping every rendered element testable.
 *
 * Editorial rules (SEO/YMYL discipline):
 *  - every number is either computed by the engine or anchored to a statute
 *    the rules modules cite; orientation text uses approximations marked "~";
 *  - every article ends with the disclaimer note + FAQ + calculator CTA;
 *  - `updated` is an ISO date that feeds the sitemap <lastmod>.
 */

export interface LearnFaqItem {
  q: string;
  a: string;
}

export type LearnBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; caption?: string; head: string[]; rows: string[][] }
  | { kind: 'note'; text: string }
  | { kind: 'faq'; items: LearnFaqItem[] }
  | { kind: 'cta' };

export interface LearnArticle {
  slug: string;
  title: string;
  metaDescription: string;
  /** ISO date (YYYY-MM-DD) - rendered as "Last updated" and fed to sitemap. */
  updated: string;
  blocks: LearnBlock[];
}

export const methodologyArticle: LearnArticle = {
  slug: 'methodology',
  title: 'How Taxmora calculates your take-home pay',
  metaDescription:
    'The rules, sources and limits behind Taxmora’s five-country take-home pay calculator for Germany, the Netherlands, Portugal, Spain and the UK. Not tax advice.',
  updated: '2026-09-08',
  blocks: [
    {
      kind: 'p',
      text: 'Taxmora compares what a salary is actually worth after tax and social contributions in Germany, the Netherlands, Portugal, Spain and the United Kingdom. This page explains what the calculator does, which rules it applies, and - just as important - what it deliberately does not do.',
    },
    { kind: 'h2', text: 'What the engine does' },
    {
      kind: 'p',
      text: 'For each country the engine takes one gross annual income plus a tax year, then applies that country’s income-tax schedule and the employee-side social-security contributions to produce a net (take-home) figure. Every number shown in the results table is computed from the same rule set the app uses for its paid features, and the country-by-country breakdown is attached to each result so you can see where the money goes instead of trusting a single black-box figure.',
    },
    { kind: 'h2', text: 'Country rules at a glance' },
    {
      kind: 'table',
      caption: 'Orientation only - the calculator applies year-specific parameters.',
      head: ['Country', 'Income tax (2026)', 'Employee social security', 'Special regimes'],
      rows: [
        [
          'Germany',
          'Progressive, ~14% entry rate to 42%, top rate 45% on very high incomes; the 5.5% solidarity surcharge applies only above the exemption threshold.',
          '≈20% of gross up to the contribution ceilings (pension, health, unemployment, care).',
          'None modelled yet.',
        ],
        [
          'Netherlands',
          'Box 1 progressive rates on employment income.',
          'Flat-ish premium bands up to the ceiling.',
          'The 30% ruling for inbound expats (time-limited).',
        ],
        [
          'Portugal',
          'Progressive brackets up to 48%.',
          'Employee share 11% plus solidarity surcharges at higher incomes.',
          'IFICI (the NHR successor, 20% flat on eligible employment income).',
        ],
        [
          'Spain',
          'Progressive state + regional brackets up to 47% at the top.',
          'Employee share ≈6.4% of the contribution base.',
          'Beckham regime: 24% flat on employment income up to €600,000.',
        ],
        [
          'United Kingdom',
          'Personal allowance £12,570, then 20% / 40% / 45% bands (£37,700 and £125,140 thresholds); the allowance tapers above £100,000.',
          'Class 1 National Insurance, employee rates on earnings between the primary threshold and the upper earnings limit.',
          'Statutory Residence Test determines UK tax residency.',
        ],
      ],
    },
    { kind: 'h2', text: 'What is included' },
    {
      kind: 'ul',
      items: [
        'Standard employment income for the selected tax year (2025 / 2026).',
        'Each country’s statutory income-tax schedule with the year’s brackets.',
        'Employee-side social-security contributions with ceilings where they apply.',
        'The special regimes listed above where the engine supports them.',
      ],
    },
    { kind: 'h2', text: 'What is deliberately NOT included yet' },
    {
      kind: 'ul',
      items: [
        'Double-taxation relief computation when two countries both want to tax the same income.',
        'Wealth taxes, property income, capital gains and Box 3 (Dutch deemed-return) income.',
        'Self-employment and freelance regimes (different contribution systems entirely).',
        'Regional variations that fall outside the national schedule (for example Spain’s foral territories).',
        'Mid-year moves: the calculator assumes one country of residence for the year.',
      ],
    },
    { kind: 'h2', text: 'How the rules stay current' },
    {
      kind: 'p',
      text: 'Country rules live in versioned rule modules, each carrying the statute it implements and a last-verified date (for example the Spanish Beckham citation is re-checked against the 2026 state budget). When a parameter changes for a new tax year, the rule module is updated and its citation date moves with it - the engine, not this page, is always the source of the numbers in the calculator.',
    },
    { kind: 'h2', text: 'Sources' },
    {
      kind: 'ul',
      items: [
        'Germany: EStG (income tax) plus the social-security contribution ceilings in the Sozialversicherung codes.',
        'Netherlands: Wet op de loonbelasting 1964 (Box 1) and the 30% ruling conditions in the Wage Tax Act.',
        'Portugal: CIRS progressive schedule; IFICI (NHR 2.0) under Law 9/2024.',
        'Spain: IRPF state + regional scales; Régimen especial Beckham under Art. 93 LIRPF.',
        'United Kingdom: ITA 2007 (income tax bands, s.5 statutory residence test) and NICs under the Social Security Contributions and Benefits Act.',
      ],
    },
    {
      kind: 'note',
      text: 'Taxmora is a calculation and planning tool, not a tax adviser, and nothing on this page constitutes tax advice. Cross-border situations almost always have specifics that change the answer - confirm anything important with a qualified adviser in the countries involved.',
    },
    {
      kind: 'faq',
      items: [
        {
          q: 'Is this calculator tax advice?',
          a: 'No. It computes statutory rules mechanically so you can compare scenarios. It does not know your full situation and does not replace a qualified adviser.',
        },
        {
          q: 'Why is my payslip different from the result?',
          a: 'Payslips include items the calculator does not model (company benefits, private health schemes, local surcharges, mid-year job changes) and withholding is often an approximation of the final annual liability. The calculator computes the statutory annual picture instead.',
        },
        {
          q: 'How current are the rates?',
          a: 'Each rule module carries the statute and a last-verified date. The calculator supports tax years 2025 and 2026; when a country publishes new parameters the module is updated and the date moves.',
        },
        {
          q: 'Can I use it to file my taxes?',
          a: 'No. The engine can draft filing checklists inside the app, but the filed return is always your responsibility (or your adviser’s).',
        },
      ],
    },
    { kind: 'cta' },
  ],
};

/** Registry - hub pages and the sitemap are derived from this list. */
export const learnArticles: LearnArticle[] = [methodologyArticle];
