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

// ─── Phase 2 seed articles — one "money keyword" per country ────────────────
// Numbers in the worked-example tables are engine output (tools/
// seo-worked-examples.ts). Countries whose 2026 parameters are provisional
// carry that note in the table caption; UK and ES use their latest fully
// implemented year (2025-26 / 2025) and say so.

const netherlands30Ruling: LearnArticle = {
  slug: 'netherlands-30-percent-ruling',
  title: 'The Netherlands 30% ruling (2026): who qualifies and what it actually saves',
  metaDescription:
    'How the Dutch 30% ruling works in 2026: eligibility criteria, the salary threshold, what it means for take-home pay, and the honest limits of any online calculation.',
  updated: '2026-09-10',
  blocks: [
    {
      kind: 'p',
      text: 'The 30% ruling (30%-regeling) is the Netherlands’ flagship regime for inbound expats: for a limited period, up to 30% of your salary can be paid tax-free. It exists to compensate international hires for the real costs of moving to the Netherlands — and it is the single biggest swing factor in a Dutch take-home calculation.',
    },
    { kind: 'h2', text: 'The core eligibility criteria' },
    {
      kind: 'ul',
      items: [
        'You were recruited (or transferred) from abroad and the Dutch employer considers your expertise scarce in the Dutch labour market.',
        'You lived more than 150 km from the Dutch border for most of the 24 months before your first Dutch workday.',
        'Your salary meets a minimum threshold that changes every year (roughly €46,000-47,000 excluding the allowance in 2025; lower for applicants under 30 with a master’s degree).',
        'You and your employer apply jointly, generally within four months of your first Dutch workday.',
      ],
    },
    {
      kind: 'p',
      text: 'The relief is time-limited and the percentage schedule has been changed by parliament more than once in recent years, with step-downs debated for later years — so the exact percentage that applies to you depends on your start date. The Belastingdienst page is the source of truth for the current schedule; do not rely on blog posts (including this one) for the percentage itself.',
    },
    { kind: 'h2', text: 'What a Dutch salary is worth without the ruling' },
    {
      kind: 'table',
      caption:
        'Engine output: 2026 parameters, single employee, salary income. Social contributions included.',
      head: [
        'Gross salary (2026)',
        'Income tax + social contributions',
        'Net take-home',
        'Effective rate',
      ],
      rows: [['€80,000', '€29,532', '€50,467', '36.9%']],
    },
    {
      kind: 'p',
      text: 'The ruling changes the arithmetic in a way no standard calculator shows: with a 30% allowance, roughly 70% of your salary stays in the taxable base while you keep the allowance tax-free — and the effect compounds with the Dutch system’s high entry tax rate. That second-order interaction (bracket, general credit, labour credit all shifting) is exactly why you should compute both scenarios rather than subtracting 30% mentally.',
    },
    { kind: 'h2', text: 'What the ruling does NOT cover' },
    {
      kind: 'ul',
      items: [
        'It is an employment-income regime — freelance and business income do not qualify.',
        'It does not exempt Dutch-source income beyond the allowance, and it says nothing about your residency position for other countries.',
        'It ends when you leave, when the time limit expires, or (since the 2024 tightening) partially when your salary drops below the threshold in later years.',
      ],
    },
    { kind: 'h2', text: 'The honest limit of this page' },
    {
      kind: 'p',
      text: 'Taxmora’s calculator currently computes the standard Dutch position — Box 1 rates and social contributions for 2025 and 2026 — and does not yet model the ruling’s allowance. We would rather show you the honest standard number than a hand-waved ruling number. The Belastingdienst ruling pages and a Dutch payroll adviser can quantify your exact case.',
    },
    {
      kind: 'note',
      text: 'Taxmora is a calculation and planning tool, not a tax adviser, and nothing on this page constitutes tax advice. Cross-border situations almost always have specifics that change the answer - confirm anything important with a qualified adviser in the countries involved.',
    },
    {
      kind: 'faq',
      items: [
        {
          q: 'Can I apply for the 30% ruling myself?',
          a: 'No — the application is a joint request filed by your Dutch employer with the Belastingdienst. Your part is the evidence: where you lived before, your contract, and your salary level.',
        },
        {
          q: 'Does the ruling survive a job change?',
          a: 'Yes, if the new employer continues the request and you keep meeting the conditions. A gap between employers or a drop below the salary threshold can end it.',
        },
        {
          q: 'Is the 30% ruling the same as the Netherlands’ non-resident taxpayer status?',
          a: 'No. The ruling is an employer-side payroll relief for residents; partial non-resident taxpayer status is a separate election about which Box 2 and Box 3 income the Dutch tax office may tax.',
        },
        {
          q: 'Why does Taxmora not calculate the ruling?',
          a: 'Because the percentage schedule and thresholds have been amended repeatedly and your case depends on dates we cannot verify. We compute what we can verify; the ruling needs your real dates and payroll.',
        },
      ],
    },
    { kind: 'cta' },
  ],
};

const spainBeckhamLaw: LearnArticle = {
  slug: 'spain-beckham-law',
  title: 'Spain’s Beckham Law: the 24% flat tax for new arrivals, with real numbers',
  metaDescription:
    'How Spain’s special expat regime (régimen Beckham, Art. 93 LIRPF) works: 24% flat tax, who qualifies, the 6-month deadline, and a real €80,000 take-home comparison.',
  updated: '2026-09-10',
  blocks: [
    {
      kind: 'p',
      text: 'Spain taxes residents on progressive scales that reach 47% in some regions. The special regime under Article 93 of the Spanish income tax law (LIRPF) — universally called the Beckham Law after the footballer who first used it — replaces that progressive schedule with a flat 24% on Spanish employment income for people who move to Spain in good conditions. For mid-to-high salaries it is usually the best deal on the table.',
    },
    { kind: 'h2', text: 'Who qualifies' },
    {
      kind: 'ul',
      items: [
        'You have not been a Spanish tax resident in the previous five years.',
        'The move is for work: an employment contract with a Spanish employer, or directorship conditions for startup founders, or you acquire remote-work visa / entrepreneur status.',
        'You file the election (modelo 149) within six months of registering with Spanish social security — miss this window and the regime is gone.',
        'The regime then applies in the arrival year and the five following years.',
      ],
    },
    { kind: 'h2', text: 'What the 24% actually does to an €80,000 salary' },
    {
      kind: 'table',
      caption:
        'Engine output: Spain (Madrid) 2025 parameters — the latest fully implemented year. Single employee. The regime taxes Spanish employment income at 24% up to €600,000 (47% above).',
      head: [
        'Scenario (€80,000, Madrid)',
        'Income tax + social contributions',
        'Net take-home',
        'Effective rate',
      ],
      rows: [
        ['Standard progressive schedule', '€23,281', '€56,719', '29.1%'],
        ['Beckham regime (24% flat)', '€19,200', '€60,800', '24.0%'],
      ],
    },
    {
      kind: 'p',
      text: 'That is roughly €4,100 a year back in your pocket at €80,000 — and the gap widens as the salary rises, because the flat 24% competes against brackets that climb past 37% state-plus-regional in Madrid well below €100,000. Regional variation matters too: the same gross income computes differently in Catalonia or Andalusia under the standard schedule, which is why the engine takes the region as an input.',
    },
    { kind: 'h2', text: 'The traps people miss' },
    {
      kind: 'ul',
      items: [
        'The regime taxes Spanish-source employment income at the flat rate — foreign-source income generally escapes Spanish tax, which is a feature for internationally mobile people and a trap for anyone with local investment income.',
        'Wealth tax still applies to your worldwide assets (regional exceptions exist).',
        'The six-month model 149 deadline is absolute. There is no retroactive rescue.',
        'Freelance (autónomo) activity is not covered by the 24% employment-income treatment.',
      ],
    },
    { kind: 'h2', text: 'Why these numbers say 2025' },
    {
      kind: 'p',
      text: 'Taxmora’s Spain engine is calibrated to the 2025 parameters (state scale plus regional scales, cited to the AEAT Manual Práctico and the regional fiscal laws). Spain’s 2026 parameters were still pending final publication when this rule set was last verified, so the engine refuses to invent them — it computes 2025 exactly rather than 2026 approximately. When the official 2026 parameters land, the citation date moves and the calculator gains 2026.',
    },
    {
      kind: 'note',
      text: 'Taxmora is a calculation and planning tool, not a tax adviser, and nothing on this page constitutes tax advice. Cross-border situations almost always have specifics that change the answer - confirm anything important with a qualified adviser in the countries involved.',
    },
    {
      kind: 'faq',
      items: [
        {
          q: 'Is the Beckham Law only for footballers?',
          a: 'No — that is folklore. It is a general regime for qualifying inbound employees and certain founders/directors. The nickname stuck; the statute is Article 93 LIRPF.',
        },
        {
          q: 'Can I use it if I work remotely from Spain for a foreign employer?',
          a: 'The regime was extended to some remote-work visa holders and startup directors under conditions. The critical questions are Spanish social-security registration and the application deadline — check both before you assume.',
        },
        {
          q: 'What happens after the six years?',
          a: 'You fall back onto the ordinary progressive schedule as a fully resident taxpayer, including worldwide income.',
        },
        {
          q: 'Is 24% computed on gross or on social-security-adjusted income?',
          a: 'The flat rate applies to employment income after the standard employment expense reduction; social contributions are separate. The engine models both lines — see the breakdown in the calculator.',
        },
      ],
    },
    { kind: 'cta' },
  ],
};

const portugalIficiGuide: LearnArticle = {
  slug: 'portugal-ifici-guide',
  title: 'Portugal’s IFICI (NHR 2.0): the 20% flat rate that replaced the NHR',
  metaDescription:
    'Portugal’s IFICI regime (NHR 2.0): 20% flat tax on eligible employment income, who qualifies in 2026, how it differs from the old NHR, and real take-home numbers.',
  updated: '2026-09-10',
  blocks: [
    {
      kind: 'p',
      text: 'Portugal’s famous NHR (Non-Habitual Resident) regime closed to new applicants in 2024. Its successor is the IFICI — named after the scientific-research and innovation incentives list, which everyone calls NHR 2.0. It keeps the most attractive piece of the old regime, a flat 20% rate on eligible employment income, but tightens who can enter and drops the old exemption for foreign income.',
    },
    { kind: 'h2', text: 'What IFICI gives you' },
    {
      kind: 'ul',
      items: [
        'A flat 20% rate on eligible employment and self-employment income for ten years.',
        'Eligibility tied to your profession and employer: higher-education and scientific-research roles, highly qualified professions (the government publishes the lists), key roles in certified innovative startups, and certain other categories.',
        'You must become a Portuguese tax resident and must not have been resident in the previous five years.',
      ],
    },
    { kind: 'h2', text: 'The real difference from the old NHR' },
    {
      kind: 'p',
      text: 'The legacy NHR exempted most foreign-source income (pensions, dividends, rent). IFICI does not — foreign income falls under the ordinary rules. IFICI is a rate benefit on your Portuguese professional income, not a blanket shield for your worldwide income. Plan accordingly: for someone living off foreign passive income, IFICI is far weaker than the old NHR.',
    },
    { kind: 'h2', text: 'What €80,000 looks like with and without IFICI' },
    {
      kind: 'table',
      caption:
        'Engine output: Portugal 2026 parameters (marked provisional pending final AT publication). Single employee.',
      head: [
        'Scenario (€80,000)',
        'Income tax + social contributions',
        'Net take-home',
        'Effective rate',
      ],
      rows: [
        ['Standard progressive schedule', '€27,238', '€52,761', '34.1%'],
        ['IFICI 20% flat', '€16,000', '€64,000', '20.0%'],
      ],
    },
    {
      kind: 'p',
      text: 'The €11,238 difference is the single largest regime swing across the five countries Taxmora covers — Portugal’s ordinary schedule is heavy at this income level, so a flat 20% changes the answer more than any other regime here.',
    },
    { kind: 'h2', text: 'What IFICI does not fix' },
    {
      kind: 'ul',
      items: [
        'Social contributions (Segurança Social) are unchanged — the 20% applies to income tax, not to the employee share.',
        'Foreign income is fully in scope of Portuguese taxation under ordinary rules.',
        'The ten-year clock is fixed; there is no extension.',
        'Professional eligibility is verified at application — a job title change mid-regime does not retroactively break it, but your initial category must be documented.',
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
          q: 'I already have NHR. Am I affected?',
          a: 'No. Existing NHR holders keep their regime for its original duration. IFICI is only for new applicants from 2024 onward.',
        },
        {
          q: 'Does IFICI cover dividends and rent?',
          a: 'No — the flat 20% applies to eligible employment and self-employment income. Foreign dividends, interest and rent follow the ordinary Portuguese rules.',
        },
        {
          q: 'Is the 20% rate certain for all ten years?',
          a: 'The regime sets it for the ten-year window, but Portuguese parliaments have changed regime details before. The engine cites Art. 58.º-A of the EBF and we track amendments.',
        },
        {
          q: 'Why is the 2026 table marked provisional?',
          a: 'Portugal’s 2026 bracket parameters were not yet finally published when this rule set was verified, so the engine labels the year provisional rather than guessing. The IFICI 20% itself is statutory, not provisional.',
        },
      ],
    },
    { kind: 'cta' },
  ],
};

const ukArrivalsSrtFig: LearnArticle = {
  slug: 'uk-arrivals-srt-fig',
  title: 'Moving to the UK: the Statutory Residence Test and the four-year FIG regime',
  metaDescription:
    'How UK tax residency is decided (Statutory Residence Test) and how the new FIG regime taxes arrivals from 2025-26 — with real £80,000 take-home numbers from the engine.',
  updated: '2026-09-10',
  blocks: [
    {
      kind: 'p',
      text: 'Two systems decide what a move to the UK does to your taxes. The Statutory Residence Test (SRT) decides whether you are a UK tax resident at all. If you are a recent arrival, the Foreign Income and Gains (FIG) regime — new from April 2025, replacing the old non-dom remittance basis — decides how your foreign income is treated for your first four years.',
    },
    { kind: 'h2', text: 'The Statutory Residence Test in one paragraph' },
    {
      kind: 'p',
      text: 'The SRT (ITA 2007 s.5, with HMRC’s RDR3 guidance) is a decision tree: automatic overseas tests (fewer than 16 UK days with no UK work, or fewer than 46 full days, and so on), automatic UK tests (183+ days, or a UK home plus work), and — between the two — a ties-based middle zone where day counts are checked against five ties: family, accommodation, work, 90-day history, and country presence. You count a day by physical presence at midnight. Split-year treatment can fence off the arrival year so pre-move income stays outside UK tax.',
    },
    { kind: 'h2', text: 'FIG: the four-year window' },
    {
      kind: 'ul',
      items: [
        'If you were not UK-resident in the previous ten consecutive tax years, your first four UK tax years of residence can elect FIG treatment.',
        'FIG gives 100% relief on foreign-sourced income and gains — dividends, interest, rent, gains — while you remain eligible.',
        'UK employment income and UK-source income are taxed normally; the regime is about the foreign side.',
        'After year four, worldwide income falls into the ordinary UK net with no grandfathering.',
      ],
    },
    { kind: 'h2', text: 'Real UK take-home numbers' },
    {
      kind: 'table',
      caption:
        'Engine output: UK 2025-26 parameters (the latest fully implemented UK year). Single employee, England/Wales/NI band structure. National Insurance included.',
      head: [
        'Scenario (2025-26)',
        'Income tax + National Insurance',
        'Net take-home',
        'Effective rate',
      ],
      rows: [
        ['£50,000 salary, standard', '£7,486', '£42,514', '15.0%'],
        ['£80,000 salary, standard', '£19,432', '£60,568', '24.3%'],
        ['£80,000 foreign employment income, FIG-eligible', '£0', '£80,000', '0.0%'],
      ],
    },
    {
      kind: 'p',
      text: 'Read the third row carefully: it describes a FIG-eligible individual whose £80,000 is foreign employment income — a scenario that only exists if the SRT or split-year rules actually put you in the FIG window and the income is genuinely foreign-sourced. Take a UK job with a UK payroll and the standard rows are your reality. The SRT question is not paperwork; it is the difference between rows two and three.',
    },
    { kind: 'h2', text: 'What the UK engine does not model yet' },
    {
      kind: 'ul',
      items: [
        'Scottish and Welsh income-tax band differences (the engine uses the rUK structure).',
        'Pension contributions, student loans and the child benefit charge.',
        'The remittance-basis details of mixed funds (relevant to pre-2025 arrivals still within old rules).',
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
          q: 'I spend 150 days a year in the UK — am I resident?',
          a: 'Between 47 and 182 UK days, the answer depends on your ties. More ties mean fewer days needed to make you resident. Run the day counts against the ties table in RDR3 — or use a tool that implements it.',
        },
        {
          q: 'Does FIG apply to my salary if my employer is British?',
          a: 'No — UK employment income for UK duties is taxed normally. FIG shelters foreign-sourced income and gains during the four-year window.',
        },
        {
          q: 'What happened to the old non-dom remittance basis?',
          a: 'It closed to new claimants from April 2025. Long-term residents have transition rules; FIG is the forward-looking regime for arrivals.',
        },
        {
          q: 'Why do the numbers say 2025-26?',
          a: 'The UK tax year runs April to April and the engine implements 2025-26 exactly rather than projecting 2026-27 from unconfirmed figures. UK numbers without a confirmed HMRC basis are guesswork.',
        },
      ],
    },
    { kind: 'cta' },
  ],
};

const germanyTakeHomeGuide: LearnArticle = {
  slug: 'germany-take-home-guide',
  title:
    'What a salary is really worth in Germany: income tax and social security, with real numbers',
  metaDescription:
    'German take-home pay explained: progressive EStG brackets, social-security ceilings, the solidarity surcharge, and real €60,000 / €80,000 net-salary numbers from the 2026 engine.',
  updated: '2026-09-10',
  blocks: [
    {
      kind: 'p',
      text: 'Germany’s salary-to-net pipeline has three stages: Lohnsteuer (wage income tax under § 32a EStG), employee social-security contributions across four branches with per-branch ceilings, and — only above a threshold — the solidarity surcharge. People tend to overestimate the tax and underestimate the social security; both matter, and the ceilings make the effective rate fall at the very top.',
    },
    { kind: 'h2', text: 'Real numbers from the engine' },
    {
      kind: 'table',
      caption:
        'Engine output: Germany 2026 parameters (provisional pending final BMF publication). Single, tax class I equivalent, salary income.',
      head: [
        'Gross salary (2026)',
        'Income tax + social contributions',
        'Net take-home',
        'Effective rate',
      ],
      rows: [
        ['€60,000', '€14,233', '€45,767', '23.7%'],
        ['€80,000', '€22,763', '€57,236', '28.4%'],
      ],
    },
    {
      kind: 'p',
      text: 'Notice the effective rate rising from 23.7% to 28.4% between €60,000 and €80,000 — the German social-security ceilings stop growing your contributions somewhere in that range while income tax keeps climbing through the 42% zone. The shape of that curve is the real answer to “is a German raise worth it?”.',
    },
    { kind: 'h2', text: 'The moving parts' },
    {
      kind: 'ul',
      items: [
        'Income tax: progressive from ~14% through 42%, with the 45% reichensteuer on very high incomes; the § 32a formula is famously non-linear in the first brackets.',
        'Social security: pension, unemployment, health and long-term-care insurance, each with its own contribution rate and its own ceiling (Beitragsbemessungsgrenze) — above a ceiling that branch stops growing.',
        'Solidarity surcharge: 5.5% of the wage tax, but only above the exemption threshold — most employees pay €0 of it.',
        'Tax classes (I to VI) change withholding timing for couples, not the annual total.',
      ],
    },
    { kind: 'h2', text: 'What the engine does not model yet' },
    {
      kind: 'ul',
      items: [
        'Church tax (Kirchensteuer, 8-9% of the wage tax where applicable).',
        'The Forschungspauschale and other special statuses.',
        'Private health-insurance premiums that replace the statutory scheme above the insurance threshold.',
        'Class V/VI withholding oddities within the year (the annual picture is computed, not the payroll months).',
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
          q: 'Why is my German payslip different from the annual number?',
          a: 'Monthly withholding approximates the annual liability and includes items the calculator excludes (church tax, private schemes, benefit conversions). The engine computes the statutory annual picture.',
        },
        {
          q: 'Are the 2026 numbers final?',
          a: 'The engine labels Germany 2026 provisional until the BMF’s final parameters are formally published; the 2025 numbers are exact. The flag is visible in every result.',
        },
        {
          q: 'Do the ceilings mean rich people pay less social security?',
          a: 'As a share of income, yes — above each ceiling that branch stops growing. That is why the effective-rate curve flattens at the top.',
        },
        {
          q: 'Is health insurance included?',
          a: 'The statutory scheme (with its average additional contribution) is included; private full-compression policies above the threshold are not.',
        },
      ],
    },
    { kind: 'cta' },
  ],
};

const spainVsPortugalTax: LearnArticle = {
  slug: 'spain-vs-portugal-tax',
  title: 'Spain vs Portugal for remote workers: what your salary is really worth after tax',
  metaDescription:
    '€80,000 computed both ways: Spain vs Portugal take-home pay under standard rules and arrival regimes (Beckham vs IFICI), with the foreign-income asymmetry most guides skip.',
  updated: '2026-09-14',
  blocks: [
    {
      kind: 'p',
      text: 'It is the classic Iberian dilemma for remote workers and relocating employees: Lisbon or Madrid? Both sell sunshine, EU membership and an expat scene — and both sell a special tax regime for arrivals. The honest answer to “which country leaves me more money” is: it depends on which regime you actually get, and on where your income comes from. Here are the numbers, computed rather than vibes.',
    },
    { kind: 'h2', text: 'Round one: standard rules, no special regime' },
    {
      kind: 'table',
      caption:
        'Engine output. Spain: Madrid, 2025 parameters (latest fully implemented year). Portugal: 2026 parameters, marked provisional pending final AT publication. Single employee; social contributions included.',
      head: ['Gross salary', 'Spain (Madrid) net', 'Portugal net', 'Winner'],
      rows: [
        ['€50,000', '€38,586 (22.8%)', '€36,141 (27.7%)', 'Spain by €2,445'],
        ['€80,000', '€56,719 (29.1%)', '€52,761 (34.1%)', 'Spain by €3,958'],
        ['€120,000', '€79,519 (33.7%)', '€72,787 (39.3%)', 'Spain by €6,732'],
      ],
    },
    {
      kind: 'p',
      text: 'Under plain progressive schedules, Spain wins at every salary level, and the gap widens as income rises. Portugal’s employee social-security share (11% plus solidarity surcharges) stacks on top of brackets that reach 48%, while Madrid’s combined state-plus-regional schedule stays flatter. Two caveats before you book the mover: Spanish regional variation is real (the same €120,000 computes differently in Catalonia), and these tables assume employment income taxed in-country.',
    },
    { kind: 'h2', text: 'Round two: the arrival regimes head-to-head' },
    {
      kind: 'table',
      caption:
        'Engine output. Beckham: 24% flat on Spanish employment income up to €600,000 (2025 parameters). IFICI: 20% flat on eligible Portuguese income (2026, provisional base parameters).',
      head: ['Gross salary', 'Spain + Beckham net', 'Portugal + IFICI net', 'Winner'],
      rows: [
        ['€80,000', '€60,800 (24.0%)', '€64,000 (20.0%)', 'Portugal by €3,200'],
        ['€120,000', '€91,200 (24.0%)', '€96,000 (20.0%)', 'Portugal by €4,800'],
      ],
    },
    {
      kind: 'p',
      text: 'The regimes flip the result. IFICI’s 20% beats Beckham’s 24% at any income, and IFICI lasts ten years against Beckham’s six. If you qualify for both and your income qualifies for both, Portugal comes out ahead on pure rate. But qualifying is the whole game — and the two regimes are not even selling the same product.',
    },
    { kind: 'h2', text: 'The asymmetry almost every comparison skips: your income source' },
    {
      kind: 'table',
      caption: 'How each regime treats income depending on where it comes from.',
      head: ['Your income', 'Spain + Beckham', 'Portugal + IFICI'],
      rows: [
        [
          'Spanish payroll salary',
          '24% flat — the regime’s core case',
          '20% flat if the profession qualifies',
        ],
        [
          'Remote work for a foreign company (foreign payroll)',
          'Generally OUTSIDE Spanish tax scope under the regime',
          'IN SCOPE at 20% only if it counts as eligible employment income — otherwise ordinary rules',
        ],
        [
          'Foreign dividends, interest, rent',
          'Generally outside Spanish scope',
          'Ordinary Portuguese rules (taxed)',
        ],
      ],
    },
    {
      kind: 'p',
      text: 'This is where the “Portugal wins on rate” conclusion can invert. A remote worker paid by a foreign company may find that the Beckham regime puts that salary outside Spanish tax entirely (subject to the regime’s own conditions and treaty analysis), while IFICI pulls foreign employment income into a 20% net and leaves non-eligible income on the ordinary schedule. The right question is not “which rate is lower” but “which regime actually touches my income”.',
    },
    { kind: 'h2', text: 'The parts that decide it in practice' },
    {
      kind: 'ul',
      items: [
        'Deadlines are brutal and different: Beckham requires the modelo 149 election within six months of Spanish social-security registration; IFICI is applied for with your residency registration — miss either and the standard tables above are your fate.',
        'Eligibility: Beckham wants an employment relationship (or startup-director conditions); IFICI wants your profession and employer to fit the published lists.',
        'Both countries use the 183-day rule and a residency-treaty network, so a mid-year move becomes a split-year analysis in both.',
        'Wealth tax exists in Spain (regional exceptions) and Portugal has its own quirks — neither regime touches it.',
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
          q: 'So which country is better for a remote worker?',
          a: 'For Spanish-payroll employment, Beckham is strong and simple. For foreign-payroll remote work, the answer depends on regime eligibility and the source-of-income analysis — run both scenarios and read the scope rules before deciding.',
        },
        {
          q: 'Why are the Spain numbers from 2025 and Portugal from 2026?',
          a: 'Because that is what the engine can compute exactly. Spain’s 2026 parameters were pending final publication when the rules were last verified, so the engine refuses to estimate. Portugal’s 2026 brackets are marked provisional. Guessing parameters would make the comparison look precise and be wrong.',
        },
        {
          q: 'Do these tables include social security?',
          a: 'Yes — income tax plus the employee-side contributions, which is why Portugal’s standard numbers look heavy: its employee share is larger.',
        },
        {
          q: 'Can I hold both regimes at once across a relocation?',
          a: 'In principle you could use Beckham in your Spanish years and IFICI in Portuguese years if you meet both countries’ entry conditions and the treaty assigns residency correctly. That is a genuinely complex case — get advice before attempting it.',
        },
      ],
    },
    { kind: 'cta' },
  ],
};

/** Registry - hub pages and the sitemap are derived from this list. */
export const learnArticles: LearnArticle[] = [
  methodologyArticle,
  netherlands30Ruling,
  spainBeckhamLaw,
  portugalIficiGuide,
  ukArrivalsSrtFig,
  germanyTakeHomeGuide,
  spainVsPortugalTax,
];
