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
  updated: '2026-09-21',
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
        'Employee-side social-security contributions, each line cited: Germany’s pension, unemployment, health (average additional rate) and care contributions with their two separate ceilings; the UK’s Class 1 National Insurance (annualised); Spain’s 6.48% Seguridad Social on a base capped at €58,914; Portugal’s 11% Segurança Social.',
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
        'Spain’s 2025 “solidarity contribution” on pay above the contribution ceiling — the employee share is not published in a source we could verify, so the contribution base is simply capped instead.',
        'Germany’s employee allowances (Werbungskostenpauschale, Sonderausgabenpauschale, Vorsorgepauschale): the § 32a tariff is applied to the amount you enter, so the German income-tax line is conservative (slightly high) versus a real payslip.',
        'Northern Ireland’s and Scotland’s income-tax differences, private health insurance in Germany, and the Saxon split of the care-insurance premium.',
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
  updated: '2026-09-21',
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
        'Engine output: 2026 parameters, single employee, salary income. The Dutch employee-side national-insurance premies (AOW/Anw/Wlz) are levied inside Box 1, so they are already part of the income-tax line rather than shown separately.',
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
      text: 'Note the split between the two surfaces. The public five-country calculator shows the standard Dutch position — Box 1 rates and social contributions for 2025 and 2026 — because the ruling is opt-in and depends on a decision your employer has to obtain. The ruling itself is modelled in Taxmora’s strategy layer: it reduces the taxable base to 70% and reports the resulting saving, and it is available once you declare that your employer has the 30%-regeling. The comparison article “Netherlands 30% ruling vs Spain’s Beckham law vs Portugal’s IFICI” uses exactly that computation.',
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
          q: 'Where can I see the ruling calculated?',
          a: 'In Taxmora’s strategy layer, which models the allowance as a taxable base of 70% and reports the annual saving — the same computation used in the three-regime comparison. The public calculator deliberately shows the standard position, because whether you actually hold the ruling depends on your employer’s application and your dates.',
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
  updated: '2026-09-21',
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
        'Engine output: Spain (Madrid) 2025 parameters — the latest fully implemented year. Single employee. The regime taxes Spanish employment income at 24% up to €600,000 (47% above). Employee Seguridad Social (6.48% of a base capped at €58,914) applies in every row.',
      head: [
        'Scenario (Madrid, 2025)',
        'Income tax + social contributions',
        'Net take-home',
        'Effective rate',
      ],
      rows: [
        ['€80,000 — standard', '€27,098', '€52,902', '33.9%'],
        ['€80,000 — Beckham (24% flat)', '€23,017', '€56,983', '28.8%'],
        ['€30,000 — standard', '€7,078', '€22,922', '23.6%'],
        ['€30,000 — Beckham (24% flat)', '€9,144', '€20,856', '30.5%'],
      ],
    },
    {
      kind: 'p',
      text: 'That is roughly €4,100 a year back in your pocket at €80,000 — and the gap widens as the salary rises, because the flat 24% competes against brackets that climb past 37% state-plus-regional in Madrid well below €100,000. Regional variation matters too: the same gross income computes differently in Catalonia or Andalusia under the standard schedule, which is why the engine takes the region as an input.',
    },
    {
      kind: 'p',
      text: 'The regime is not automatically a win. At €30,000 the flat 24% costs you about €2,066 a year against the progressive schedule, because Spain’s lower brackets are gentler than a flat rate on the whole salary. The crossover sits around €55,000 — below it Beckham makes you worse off, above it better off, and the further above it the more it pays. That is precisely the kind of arithmetic to compute rather than assume.',
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
  updated: '2026-09-21',
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
        'Engine output: Portugal 2026 parameters (marked provisional pending final AT publication). Single employee. Includes the 11% employee Segurança Social in both rows — IFICI changes the income-tax rate, not social contributions.',
      head: [
        'Scenario (€80,000)',
        'Income tax + social contributions',
        'Net take-home',
        'Effective rate',
      ],
      rows: [
        ['Standard progressive schedule', '€36,038', '€43,962', '45.1%'],
        ['IFICI 20% flat', '€24,800', '€55,200', '31.0%'],
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
  updated: '2026-09-21',
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
        'Engine output: UK 2025-26 parameters (the latest fully implemented UK year). Single employee, England/Wales/NI band structure. Class 1 National Insurance is included in the standard rows (annualised). The FIG row zeroes UK income tax on foreign income only — National Insurance is decided by the separate social-security rules and is not covered by FIG.',
      head: [
        'Scenario (2025-26)',
        'Income tax + National Insurance',
        'Net take-home',
        'Effective rate',
      ],
      rows: [
        ['£50,000 salary, standard', '£10,480', '£39,520', '21.0%'],
        ['£80,000 salary, standard', '£23,042', '£56,958', '28.8%'],
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
        'National Insurance is annualised here; employees are assessed per pay period, so an irregular bonus pattern can differ slightly.',
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
  updated: '2026-09-21',
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
        ['€60,000', '€27,283', '€32,717', '45.5%'],
        ['€80,000', '€39,020', '€40,979', '48.8%'],
      ],
    },
    {
      kind: 'p',
      text: 'The effective burden rises from 45.5% to 48.8% between €60,000 and €80,000, and the composition changes as it climbs: the health and care contributions stop growing once your pay passes their ceiling (€5,812.50 a month in 2026), while pension and unemployment contributions keep applying up to €8,450 a month and income tax keeps climbing through the 42% zone. Above both ceilings the rate flattens again — the shape of that curve is the real answer to “is a German raise worth it?”.',
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
        'The employee allowances a real payroll run applies (Werbungskostenpauschale, Sonderausgabenpauschale and the Vorsorgepauschale) — the § 32a tariff is applied to the amount you enter, so the German income-tax line here is conservative versus a payslip.',
        'The Forschungspauschale and other special statuses.',
        'Private health-insurance premiums that replace the statutory scheme above the insurance threshold.',
        'The Saxon split of the care-insurance premium (this engine uses the non-Saxon 1,8 %/2,4 % childless split).',
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
  updated: '2026-09-21',
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
        ['€50,000', '€35,346 (29.3%)', '€30,642 (38.7%)', 'Spain by €4,704'],
        ['€80,000', '€52,902 (33.9%)', '€43,962 (45.1%)', 'Spain by €8,940'],
        ['€120,000', '€75,702 (36.9%)', '€59,588 (50.3%)', 'Spain by €16,114'],
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
        ['€80,000', '€56,983 (28.8%)', '€55,200 (31.0%)', 'Spain by €1,783'],
        ['€120,000', '€87,383 (27.2%)', '€82,800 (31.0%)', 'Spain by €4,583'],
      ],
    },
    {
      kind: 'p',
      text: 'Once employee social contributions are counted, the rate comparison alone is misleading. IFICI’s 20% is lower than Beckham’s 24% — but Portugal’s employee Segurança Social is 11% of gross with no ceiling, while Spain’s employee contribution is 6.48% of a base capped at €58,914. That is why Spain wins the regime round above: at €80,000 Beckham leaves you €1,783 ahead, at €120,000 €4,583 ahead, and the gap keeps widening with salary. IFICI still lasts ten years against Beckham’s six, so the honest read is “Spain on money, Portugal on duration” — and eligibility is the whole game for both.',
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
          a: 'On the money, Spain wins both rounds once employee social contributions are counted: its contribution base is capped, Portugal’s 11% is not. Portugal’s counter-argument is duration (IFICI runs ten years) and eligibility. For foreign-payroll remote work the answer still depends on regime eligibility and the source-of-income analysis — run both scenarios before deciding.',
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

const europe183DayResidency: LearnArticle = {
  slug: 'europe-183-day-tax-residency',
  title: 'The 183-day rule in Europe: how five countries actually decide you’re a tax resident',
  metaDescription:
    'The 183-day rule is not a magic line. How Spain, Portugal, Germany, the Netherlands and the UK really decide tax residency — plus the treaty tiebreaker and the social-security trap.',
  updated: '2026-09-21',
  blocks: [
    {
      kind: 'p',
      text: 'Every cross-border worker has heard it: “stay 183 days and you become a tax resident.” The rule exists in every one of the five countries Taxmora covers — and in every one of them it is only one of several ways to become a resident, none of them the most common one in practice. People who plan around the day count alone get surprised by exactly the tests they never heard of.',
    },
    { kind: 'h2', text: 'How each country actually decides residency' },
    {
      kind: 'table',
      caption:
        'Domestic law tests, as implemented in the Taxmora residency engine. “>183” means more than 183 days of presence in the calendar year.',
      head: ['Country', 'Residence test', 'Statute'],
      rows: [
        [
          'Spain',
          '>183 days; OR centre of economic interests in Spain; OR spouse + dependent minor children resident in Spain (rebuttable presumption)',
          'art. 9 LIRPF',
        ],
        [
          'Portugal',
          '>183 days; OR shorter stay with a permanent home there suggesting intent to keep it',
          'art. 16 CIRS',
        ],
        [
          'Germany',
          'A dwelling used as residence (Wohnsitz) — no minimum days; OR habitual stay over six months (gewöhnlicher Aufenthalt)',
          '§ 8 + § 9 AO',
        ],
        [
          'Netherlands',
          'Facts and circumstances: where your personal and economic life is centred (home, family, work, registrations)',
          'art. 4 AWR',
        ],
        [
          'United Kingdom',
          'The Statutory Residence Test: automatic overseas tests, automatic UK tests (183+ days, home + work), and a ties-based middle zone',
          'ITA 2007 s.5 (HMRC RDR3)',
        ],
      ],
    },
    {
      kind: 'p',
      text: 'Read that table again and notice what is missing: in Germany there is no day count at all — a flat you keep available counts. In Spain, having your spouse and kids in Spanish schools can make you a resident on day one, days irrelevant. In the Netherlands, no statute even mentions a number — the whole analysis is “where is your life”. The 183-day rule is usually the least of what decides your case.',
    },
    { kind: 'h2', text: 'Day counting is its own sport' },
    {
      kind: 'ul',
      items: [
        'Most countries count a day by physical presence at midnight; split days, transit days and “partial” days are exactly where disputes happen.',
        'Spain and Portugal count days across the calendar year; the UK uses tax years (6 April – 5 April) and its own UK-day definition — the same travel pattern can produce different counts in different countries.',
        'Country of residence fights are resolved between states, not by you: when two countries both claim you, the double-taxation treaty’s tiebreaker (OECD Model, art. 4(2)) walks through permanent home → centre of vital interests → habitual abode → nationality.',
      ],
    },
    {
      kind: 'h2',
      text: 'The trap nobody warns you about: residency and social security are separate systems',
    },
    {
      kind: 'p',
      text: 'Tax residency and social-security liability are decided by different rulebooks. Staying under 183 days does not keep you out of a country’s social-security net if you work there — and within the EU/EEA the coordination rules (A1 certificates, the “last employer country” principle for remote workers) decide which system you pay into, independent of the 183-day count. This is the single most common surprise in remote-work setups.',
    },
    { kind: 'h2', text: 'What being resident in each country is worth: €80,000 as a resident' },
    {
      kind: 'table',
      caption:
        'Engine output, standard resident employee, salary income, single. DE/PT 2026 provisional; ES 2025; NL 2026; UK 2025-26 (pounds). See the country guides for details.',
      head: [
        'Country (residency year label)',
        'Tax + social contributions',
        'Net take-home',
        'Effective rate',
      ],
      rows: [
        ['United Kingdom (2025-26)', '£23,042', '£56,958', '28.8%'],
        ['Spain, Madrid (2025)', '€27,098', '€52,902', '33.9%'],
        ['Netherlands (2026)', '€29,532', '€50,467', '36.9%'],
        ['Portugal (2026, provisional)', '€36,038', '€43,962', '45.1%'],
        ['Germany (2026, provisional)', '€39,020', '€40,979', '48.8%'],
      ],
    },
    {
      kind: 'p',
      text: 'The same €80,000 spans roughly €16,000 of take-home across the five systems once employee social contributions are included — and this table is the boring case, before any arrival regime. Note how the ranking moves once contributions are counted: Germany, the country people assume is the most taxed, is last here, because its employee contributions are the heaviest of the five. Arrival regimes (Beckham, IFICI, the 30% ruling, UK FIG) sit on top of residency, and the country guides cover each one with the same engine-computed approach.',
    },
    { kind: 'h2', text: 'How Taxmora assesses residency' },
    {
      kind: 'p',
      text: 'The residency module implements the tests above per country — day counts, economic-interests checks, the Spanish family presumption, the UK ties matrix from RDR3 — and then applies the treaty tiebreaker when two countries both claim you. It is a planning tool with the statute cited on every answer, not a substitute for a ruling. Where the honest answer is “this needs an adviser”, the assessment says so.',
    },
    {
      kind: 'note',
      text: 'Taxmora is a calculation and planning tool, not a tax adviser, and nothing on this page constitutes tax advice. Cross-border situations almost always have specifics that change the answer - confirm anything important with a qualified adviser in the countries involved.',
    },
    {
      kind: 'faq',
      items: [
        {
          q: 'Is it exactly 183 days or more than 183?',
          a: 'In Spain and Portugal the threshold is crossed above 183 days of presence. But do not fixate on the number: the economic-interests and habitual-residence tests trigger at any day count.',
        },
        {
          q: 'Can two countries both consider me a tax resident?',
          a: 'Yes, under domestic law that happens regularly. The double-taxation treaty between the two countries then assigns one residence via the tiebreaker chain. You still have to file correctly in both places in the meantime.',
        },
        {
          q: 'If I stay under 183 days, do I avoid social security too?',
          a: 'No. Social-security coordination is a separate rule system. In the EU/EEA a remote worker usually owes contributions where the work is performed or where the employer sits, regardless of the day count.',
        },
        {
          q: 'I keep a flat in Germany but live mostly in Spain. Am I a German resident?',
          a: 'Quite possibly — a dwelling available for your use (Wohnsitz) is enough under § 8 AO, with no minimum days. The treaty tiebreaker may assign residency to Spain, but the German dwelling still needs managing correctly.',
        },
      ],
    },
    { kind: 'cta' },
  ],
};

const remoteWorkForeignEmployer: LearnArticle = {
  slug: 'remote-work-foreign-employer-europe',
  title: 'Remote work for a foreign employer from Europe: where the tax actually lands',
  metaDescription:
    'You live in Europe, your employer is abroad. Where income tax and social security really fall, why employers refuse, and what a resident salary nets in DE/NL/PT/ES/UK.',
  updated: '2026-09-21',
  blocks: [
    {
      kind: 'p',
      text: 'The setup is the modern default: you live in Germany, Spain, Portugal or the UK, your employer sits in the US or another European country, and your salary arrives in your account every month. Three separate legal questions decide what that costs — and they are answered by three different rule systems that most people (and, frankly, most blog posts) blur together. Income tax, social security, and the employer’s own obligations.',
    },
    { kind: 'h2', text: 'Question one: income tax follows you, not your employer' },
    {
      kind: 'p',
      text: 'If you are tax resident where you live — typically through the 183-day test or the centre-of-interests tests — your worldwide employment income is in scope there. Double-taxation treaties exist to stop the same salary being taxed twice, not to let you choose which country taxes it: the OECD Model assigns employment income to the country where the work is physically performed (art. 15), then credit mechanisms relieve the double taxation. Working from your Lisbon flat means the work is performed in Portugal, whatever the payroll says.',
    },
    {
      kind: 'ul',
      items: [
        'Your employer withholding tax in their country does not settle your liability where you live — that country will still expect a return, and the foreign withholding becomes a credit at best.',
        'Being paid as a “contractor” while working full-time for one company is a separate risk: many countries recharacterise that relationship, with back-taxes and social contributions attached.',
        'A mid-year move splits the year: most systems allocate by residence periods or working days, which is exactly where the arithmetic stops being obvious.',
      ],
    },
    { kind: 'h2', text: 'Question two: social security, the part that surprises everyone' },
    {
      kind: 'p',
      text: 'Social-security liability is decided by coordination rules, not by the 183-day count that governs tax residency — which is why people who carefully stayed under the threshold still find contributions due where they live. Inside the EU/EEA, Regulation 883/2004 assigns you to one system (usually the country where you actually work, or the employer’s country if you work in several), and an A1 certificate is the document proving which one. Between the EU and the US, bilateral totalization agreements play the same role for cross-Atlantic setups.',
    },
    {
      kind: 'ul',
      items: [
        'EU/EEA employer: your situation is usually cleanest — one system, A1 certificate, contributions in one country.',
        'Non-EU employer (US, UK post-Brexit, anywhere else): you often end up inside the local system as if you were locally employed, because the coordination rules only work between participating states.',
        'No A1 and no totalization agreement leaves you potentially liable in two systems with no offsetting credit — the worst of both worlds.',
      ],
    },
    { kind: 'h2', text: 'Question three: why your employer says no (and what they are afraid of)' },
    {
      kind: 'p',
      text: 'A foreign employer with a person working permanently from another country can create a permanent establishment — a taxable presence — in that country, plus payroll-registration, withholding and filing duties. That is the real reason HR blocks “work from anywhere” requests, and it is not a formality you can wish away by calling yourself remote. Common outcomes: the employer uses an employer-of-record to run local payroll, converts you to a genuine contractor (legal only if the relationship really is one), or declines.',
    },
    { kind: 'h2', text: 'What the salary is worth once you are resident' },
    {
      kind: 'table',
      caption:
        'Engine output: standard resident employee, single, salary income, income tax plus employee social contributions. UK 2025-26 (pounds); ES 2025; DE/PT 2026 provisional; NL 2026.',
      head: [
        'Country of residence',
        'Tax + social contributions on €80,000',
        'Net take-home',
        'Effective rate',
      ],
      rows: [
        ['United Kingdom (2025-26)', '£23,042', '£56,958', '28.8%'],
        ['Spain, Madrid (2025)', '€27,098', '€52,902', '33.9%'],
        ['Netherlands (2026)', '€29,532', '€50,467', '36.9%'],
        ['Portugal (2026, provisional)', '€36,038', '€43,962', '45.1%'],
        ['Germany (2026, provisional)', '€39,020', '€40,979', '48.8%'],
      ],
    },
    {
      kind: 'p',
      text: 'This table is the income-tax-plus-contributions half of the story, computed the way a resident employee is computed. It is the number to start from before asking whether a special regime (Beckham, IFICI, the Dutch 30% ruling, UK FIG) changes your case — the country guides cover those.',
    },
    { kind: 'h2', text: 'What the calculator does and does not do' },
    {
      kind: 'p',
      text: 'Taxmora computes resident take-home pay with the statute cited, and its residency module runs the domestic tests plus the treaty tiebreaker. It does not model permanent-establishment exposure, A1/totalization filings, contractor recharacterisation, or your employer’s payroll duties. Those decide whether your arrangement works at all; the calculator decides what the numbers look like once it does.',
    },
    {
      kind: 'note',
      text: 'Taxmora is a calculation and planning tool, not a tax adviser, and nothing on this page constitutes tax advice. Cross-border situations almost always have specifics that change the answer - confirm anything important with a qualified adviser in the countries involved.',
    },
    {
      kind: 'faq',
      items: [
        {
          q: 'My US employer keeps paying US payroll taxes. Am I done?',
          a: 'No. Where you live generally taxes your employment income regardless, with a foreign tax credit for what was already paid. The US side and the local side are separate filings.',
        },
        {
          q: 'Can I just invoice my employer as a contractor instead?',
          a: 'Only if the relationship genuinely is contracting: one client, fixed hours, company equipment and a manager usually looks like employment, and recharacterisation brings back contributions and penalties.',
        },
        {
          q: 'Do I need an A1 certificate?',
          a: 'If you work across borders within the EU/EEA, yes — it is the document that proves which social-security system applies. Without it, a second country can assess you independently.',
        },
        {
          q: 'Does my employer have to register in my country?',
          a: 'Often yes, through payroll registration or an employer-of-record, and a permanent employee working permanently from one country can create a corporate tax presence. That analysis is about the company, not your personal return.',
        },
      ],
    },
    { kind: 'cta' },
  ],
};

const arrivalRegimesCompared: LearnArticle = {
  slug: 'arrival-regimes-compared',
  title:
    'The Netherlands’ 30% ruling vs Spain’s Beckham law vs Portugal’s IFICI: which one actually pays',
  metaDescription:
    'Computed take-home pay under the three big European arrival regimes at €60,000, €80,000 and €120,000 — including the social contributions most comparisons leave out, and the three different shapes their tax curves take.',
  updated: '2026-09-29',
  blocks: [
    {
      kind: 'p',
      text: 'Three countries sell a special regime to people who arrive from abroad: the Netherlands’ 30% ruling, Spain’s Beckham law and Portugal’s IFICI. They are not three versions of one idea. Published comparisons usually stop at the headline — 30% tax-free, 24% flat, 20% flat — but those rates sit on different bases, and the social contributions underneath them differ: Spain charges 6.48% on a base capped at €58,914, Portugal charges 11% with no ceiling at all, and the Netherlands folds its employee premies into the Box 1 rate.',
    },
    {
      kind: 'p',
      text: 'Below is the same person — single, no children, employment income, Madrid for the Spanish figures — run through the engine at three salaries. The Dutch line applies the ruling the way Dutch payroll does: 30% of gross is paid as a tax-free allowance, so income tax is charged on the remaining 70%.',
    },
    {
      kind: 'table',
      caption:
        'Engine output: net annual take-home after income tax and employee social contributions; the bracket is the effective rate on gross. Spain uses 2025 parameters (the latest fully implemented Spanish year), Portugal’s 2026 figures are provisional pending final publication, the Netherlands uses 2026 parameters.',
      head: ['Regime', '€60,000 salary', '€80,000 salary', '€120,000 salary'],
      rows: [
        ['Netherlands — 30% ruling', '€47,259 (21.2%)', '€61,105 (23.6%)', '€88,488 (26.3%)'],
        ['Spain — Beckham law (Madrid)', '€41,783 (30.4%)', '€56,983 (28.8%)', '€87,383 (27.2%)'],
        ['Portugal — IFICI', '€41,400 (31.0%)', '€55,200 (31.0%)', '€82,800 (31.0%)'],
        ['Netherlands — no ruling', '€39,347 (34.4%)', '€50,468 (36.9%)', '€70,668 (41.1%)'],
        ['Spain — no regime (Madrid)', '€41,179 (31.4%)', '€52,902 (33.9%)', '€75,702 (36.9%)'],
        ['Portugal — no regime', '€35,082 (41.5%)', '€43,962 (45.1%)', '€59,588 (50.3%)'],
      ],
    },
    {
      kind: 'p',
      text: 'The Dutch regime wins at every salary level here, and the reason is structural rather than a matter of a better percentage: the ruling removes 30% of gross from the taxable base entirely. That money is not taxed, does not consume tax credits, and is not merely taxed at a lower rate. A flat 24% or 20% still pays tax on the whole salary.',
    },
    { kind: 'h2', text: 'The three curves run in different directions' },
    {
      kind: 'p',
      text: 'Read the percentage column instead of the euro column and the three regimes stop looking alike. The Dutch effective rate rises with salary (21.2% → 23.6% → 26.3%) because Box 1 is progressive and a fixed 30% allowance removes proportionally less of a higher income. Beckham’s rate falls (30.4% → 28.8% → 27.2%): the 24% is flat, while Spain’s employee contribution is charged on a base capped at €58,914, so the social-security share shrinks as pay grows. IFICI is constant at 31.0% — 20% income tax plus 11% Segurança Social with no ceiling — which is why Portugal’s regime looks strongest at €60,000 and weakest at €120,000.',
    },
    {
      kind: 'p',
      text: 'The gap at the top is where that matters: at €120,000 the Netherlands leads Spain by €1,105, while at €60,000 it leads by €5,476. If your salary will grow, the ranking you compute today is not the ranking you will live with.',
    },
    { kind: 'h2', text: 'What each regime is worth to its own country' },
    {
      kind: 'table',
      caption:
        'Extra net income per year compared with staying on the same country’s standard regime at the same salary.',
      head: ['Regime', 'at €60,000', 'at €80,000', 'at €120,000'],
      rows: [
        ['Netherlands — 30% ruling', '+€7,912', '+€10,637', '+€17,820'],
        ['Portugal — IFICI', '+€6,318', '+€11,238', '+€23,212'],
        ['Spain — Beckham law', '+€604', '+€4,081', '+€11,681'],
      ],
    },
    {
      kind: 'p',
      text: 'This table answers a different question: not “which country leaves the most money” but “which regime changes your outcome most”. IFICI is the most powerful of the three from €80,000 upwards — it lifts a Portuguese salary by €23,212 at €120,000 — because Portugal’s standard schedule is the harshest of the three. It still leaves Portugal in last place. Beckham is close to worthless at €60,000 (€604) and only becomes serious above €80,000.',
    },
    { kind: 'h2', text: 'Duration and eligibility' },
    {
      kind: 'table',
      caption: 'The three regimes differ more in who they admit than in what they pay.',
      head: ['Regime', 'Duration', 'The condition people fail'],
      rows: [
        [
          'Netherlands — 30% ruling',
          '5 years',
          'You must have lived more than 150 km from the Dutch border for most of the 24 months before your first Dutch working day, meet the annual salary threshold (€46,660 for 2025, indexed each year), and your employer must file the joint request — you cannot apply alone.',
        ],
        [
          'Spain — Beckham law',
          '6 years (year of arrival plus five)',
          'You must not have been Spanish tax resident in the five years before the move, and the regime covers employment income or a director role up to €600,000.',
        ],
        [
          'Portugal — IFICI',
          '10 years',
          'You must not have been Portuguese tax resident in the previous five years, and your activity must appear on the qualifying list — this is a regime for specific professions and activities, not for anyone who moves to Lisbon.',
        ],
      ],
    },
    { kind: 'h2', text: 'The traps in the Dutch headline' },
    {
      kind: 'ul',
      items: [
        '“30%” is an allowance, not a discount. Dutch payroll pays 30% of gross as a tax-free reimbursement and taxes the remaining 70% — that is the computation used above. If an employer instead applies the 30/70 variant (30% of the taxable salary rather than of total gross), the tax-free part is smaller and the advantage shrinks. The number to trust is a payslip simulation with your own contract, not a percentage from a blog.',
        'The allowance is capped at the WNT norm, a statutory maximum salary that is adjusted annually. That cap sits far above every salary in these tables, so it changes nothing here — but it does bind at the top of the market.',
        'The regimes are time-limited by statute: five years in the Netherlands, six in Spain, ten in Portugal. The country with the weakest rate has the longest runway, which is a real consideration if you plan to stay.',
        'None of the three changes your social-security position for other countries. An A1 certificate and the applicable social-security rules decide contributions independently of an income-tax regime.',
      ],
    },
    { kind: 'h2', text: 'What this comparison leaves out' },
    {
      kind: 'ul',
      items: [
        'The cost of living, housing and childcare that decide whether a higher net figure is actually more money in your pocket. At €120,000 the Netherlands leads Spain by €1,105 a year.',
        'Asset taxation: the Netherlands charges Box 3 tax on a deemed return on savings and investments, which no salary comparison shows.',
        'The UK’s four-year FIG regime is deliberately absent from this table. It exempts foreign income from UK income tax rather than restating a domestic salary, and National Insurance continues to apply, so it does not belong in a same-salary comparison — the UK guide covers it on its own terms.',
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
          q: 'Can I qualify for two of these regimes at once?',
          a: 'No. Each one requires being tax resident in that country, and the Spanish and Portuguese regimes additionally require that you were not resident there in the previous five years. Residence has a single answer at a time.',
        },
        {
          q: 'Which regime increases take-home pay the most?',
          a: 'In absolute terms IFICI, from €80,000 upwards — it is worth €23,212 a year at €120,000 against Portugal’s standard schedule. But the country still finishes behind the Netherlands and Spain in net pay, so “best regime” and “best country” are different questions.',
        },
        {
          q: 'Does the Dutch ruling also reduce social contributions?',
          a: 'Yes, indirectly: the employee national-insurance premies are levied inside Box 1 on the taxable base, so reducing that base by 30% reduces them too. In Spain and Portugal the regimes change the income-tax rate only; social contributions are untouched.',
        },
        {
          q: 'Why do the Spanish figures use 2025 and the Portuguese ones say provisional?',
          a: 'Because we publish what the engine has verified. Spain’s 2025 schedule is fully implemented; Portugal’s 2026 parameters are marked provisional until the final official publication, and the pages update automatically when that lands.',
        },
      ],
    },
    { kind: 'cta' },
  ],
};

const whenRegimesEnd: LearnArticle = {
  slug: 'when-expat-tax-regimes-end',
  title:
    'When your arrival tax regime ends: the Netherlands’ year-6 cliff, Spain’s year-7 and Portugal’s year-11',
  metaDescription:
    'Every European arrival regime has an end date. Engine-computed numbers for the year the Netherlands’ 30% ruling, Spain’s Beckham law and Portugal’s IFICI stop — and what the drop looks like at €60,000, €80,000 and €120,000.',
  updated: '2026-10-08',
  blocks: [
    {
      kind: 'p',
      text: 'Arrival regimes are sold as a rate. They are better understood as a period, because every one of them has a statutory end date and the year it stops is the year your take-home pay falls. The fall is not a rounding error: on the numbers below it is the largest single change most people will experience in their net pay outside a job loss.',
    },
    {
      kind: 'table',
      caption:
        'Engine output: annual net take-home in the final year of the regime and in the first year after it ends, same salary, single, no children. Spain uses 2025 parameters (Madrid), Portugal 2026 parameters (provisional), the Netherlands 2026 parameters.',
      head: ['Case', 'Last year under the regime', 'First year after it ends', 'Annual drop'],
      rows: [
        ['Netherlands — €60,000 (ends after year 5)', '€47,259', '€39,347', '−€7,912'],
        ['Netherlands — €80,000', '€61,105', '€50,468', '−€10,637'],
        ['Netherlands — €120,000', '€88,488', '€70,668', '−€17,820'],
        ['Spain — €60,000 (ends after year 6)', '€41,783', '€41,179', '−€604'],
        ['Spain — €80,000', '€56,983', '€52,902', '−€4,081'],
        ['Spain — €120,000', '€87,383', '€75,702', '−€11,681'],
        ['Portugal — €60,000 (ends after year 10)', '€41,400', '€35,082', '−€6,318'],
        ['Portugal — €80,000', '€55,200', '€43,962', '−€11,238'],
        ['Portugal — €120,000', '€82,800', '€59,588', '−€23,212'],
      ],
    },
    {
      kind: 'p',
      text: 'Two patterns are worth extracting. The first is that the cliff scales with salary, because these regimes all replace a progressive schedule with something flatter, and a flat rate helps more the higher you climb. The second is that the size of the cliff depends on how harsh the country’s standard regime is, not on how good the special one looks. Portugal’s IFICI charges 20% flat, which sounds generous next to the Dutch 30% ruling, yet its expiry costs €23,212 at €120,000 — the steepest of the three — because the standard Portuguese schedule it returns you to reaches 48%, while the 11% employee contribution applied either way.',
    },
    { kind: 'h2', text: 'Why the Dutch cliff is the one people misjudge' },
    {
      kind: 'p',
      text: 'The 30% ruling removes 30% of gross from the Box 1 base, so the end of the ruling is not “30% more tax” and it is not a change of rate. It is the difference between taxing 70% of your salary and taxing all of it through a progressive schedule in which the upper brackets are already biting. At €80,000 that difference is €10,637 a year, about €886 a month — usually more than the raise people hope to negotiate to offset it, and it arrives in January without a payslip explanation.',
    },
    { kind: 'h2', text: 'What “year 6” means in each country' },
    {
      kind: 'ul',
      items: [
        'Netherlands: the ruling is granted for a maximum of five years (the maximum was cut from eight years for grants made since 2024). If your grant predates that change, the transitional rules decide your end date — the “beschikking” letter from the Belastingdienst states it, and that letter, not a blog, is the date that governs you.',
        'Spain: the Beckham law covers the year of arrival plus the following five, so the sixth year is the first one computed on the standard state-plus-regional schedule.',
        'Portugal: IFICI runs for ten years, which makes it the longest runway of the three and, on our figures, the steepest landing.',
        'United Kingdom: the four-year FIG regime is a different shape rather than a shorter version — it exempts foreign income from UK income tax while National Insurance continues to apply, so it cannot be compared on the same salary. The UK guide covers it separately.',
        'Germany has no general arrival regime of this kind to expire, and its special statuses are not modelled in the engine, so there is no German cliff to compute here.',
      ],
    },
    { kind: 'h2', text: 'What you can do with a number this predictable' },
    {
      kind: 'p',
      text: 'The rare advantage of this problem is that the date is known years in advance and the arithmetic does not depend on markets. That supports a few concrete moves, none of which this page can decide for you:',
    },
    {
      kind: 'ul',
      items: [
        'Budget the drop a year ahead instead of discovering it in January. The figures above are the size of the adjustment.',
        'Time salary conversations before the cliff, while the argument for an expat premium still exists, rather than after your cost to the employer has already risen.',
        'Re-examine deductible contributions for the year after the regime ends: your marginal rate is higher then, which is exactly when pension and similar deductions are worth more. The country strategy pages cover the instruments (Dutch lijfrente, Portuguese PPR, German Riester, Spanish pension plans).',
        'Check the parts of the regime that are not about salary. In the Netherlands, partial non-resident taxpayer status for Box 2 and Box 3 is a separate election from the ruling, with its own rules and its own end date.',
        'If the cliff is what pushes you to consider moving, read the residency rules before the tax rates: the 183-day analysis decides when the next country starts taxing you, and the two countries can overlap for a period.',
      ],
    },
    { kind: 'h2', text: 'What this article does not model' },
    {
      kind: 'ul',
      items: [
        'Salary growth between today and the year the regime ends, which will change both numbers in the table.',
        'The non-salary effects of losing a regime: Box 2 and Box 3 treatment in the Netherlands, Spain’s wealth tax and regional deductions, and the asset side of Portuguese residency.',
        'Anything your employer does at company level — expat allowances, tax equalisation or gross-up arrangements, which often absorb part of the change.',
        'Legislative change. These regimes have been amended repeatedly in the last five years (the Dutch sliding scale was reversed, the Portuguese NHR closed to new entrants), so treat an end date as current law rather than as a promise.',
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
          q: 'Does my Dutch five-year clock pause if I change jobs?',
          a: 'No. A new employer can continue the ruling, but it does not restart the period. The clock runs from the first working day of the grant, and job changes, leave and absence do not stop it.',
        },
        {
          q: 'Can I just reapply for the 30% ruling when it ends?',
          a: 'Not as a renewal of the same grant. The ruling is awarded for a maximum period; when that period is used up, a later return to the Netherlands is assessed under whatever conditions exist at that time. Do not plan on a second run.',
        },
        {
          q: 'Is the Spanish cliff really only €604 at €60,000?',
          a: 'Yes, on our 2025 Madrid figures. Beckham is a flat 24%, and at €60,000 the progressive schedule with its lower brackets is barely worse than a flat rate on the whole salary. The regime earns its keep above €80,000, which is also where losing it hurts.',
        },
        {
          q: 'Why is the Portuguese drop the biggest when its rate looks the lowest?',
          a: 'Because the comparison is not the headline rate but the standard regime you return to. Portugal’s standard schedule reaches 48% and its 11% employee contribution applies with no ceiling either way, so the expiry undoes the largest improvement — €23,212 a year at €120,000 on our provisional 2026 figures.',
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
  europe183DayResidency,
  remoteWorkForeignEmployer,
  arrivalRegimesCompared,
  whenRegimesEnd,
];
