/**
 * tools/seo-worked-examples.ts — one-off: compute the real numbers embedded
 * in the knowledge articles + the compare regression test. Output only.
 * Run: pnpm exec tsx tools/seo-worked-examples.ts
 */
import { calculateTax } from '../src/rules';

const scenarios: Array<{ label: string; input: Record<string, unknown> }> = [
  // compare.test.ts regression scenario (€60k / 2025 / single / salary)
  { label: 'DE 60k 2025', input: { country: 'DE', taxYear: 2025, incomeType: 'salary', grossIncome: 60000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'ES(MAD) 60k 2025', input: { country: 'ES', taxYear: 2025, incomeType: 'salary', grossIncome: 60000, specialStatus: 'none', region: 'MAD', filingStatus: 'single' } },
  { label: 'UK 60k 2025', input: { country: 'UK', taxYear: 2025, incomeType: 'salary', grossIncome: 60000, specialStatus: 'none', region: 'EWN', filingStatus: 'single' } },
  { label: 'PT 60k 2025', input: { country: 'PT', taxYear: 2025, incomeType: 'salary', grossIncome: 60000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'NL 60k 2025', input: { country: 'NL', taxYear: 2025, incomeType: 'salary', grossIncome: 60000, specialStatus: 'none', filingStatus: 'single' } },
  // Article scenarios
  { label: 'DE 80k 2026', input: { country: 'DE', taxYear: 2026, incomeType: 'salary', grossIncome: 80000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'NL 80k 2026', input: { country: 'NL', taxYear: 2026, incomeType: 'salary', grossIncome: 80000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'PT 80k 2026', input: { country: 'PT', taxYear: 2026, incomeType: 'salary', grossIncome: 80000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'PT 80k ifici 2026', input: { country: 'PT', taxYear: 2026, incomeType: 'salary', grossIncome: 80000, specialStatus: 'ifici', filingStatus: 'single' } },
  { label: 'ES(MAD) 80k 2025', input: { country: 'ES', taxYear: 2025, incomeType: 'salary', grossIncome: 80000, specialStatus: 'none', region: 'MAD', filingStatus: 'single' } },
  { label: 'ES(MAD) 80k beckham 2025', input: { country: 'ES', taxYear: 2025, incomeType: 'salary', grossIncome: 80000, specialStatus: 'beckham', region: 'MAD', filingStatus: 'single' } },
  { label: 'UK 80k 2025', input: { country: 'UK', taxYear: 2025, incomeType: 'salary', grossIncome: 80000, specialStatus: 'none', region: 'EWN', filingStatus: 'single' } },
  { label: 'UK 50k 2025', input: { country: 'UK', taxYear: 2025, incomeType: 'salary', grossIncome: 50000, specialStatus: 'none', region: 'EWN', filingStatus: 'single' } },
  { label: 'ES(MAD) 30k 2025', input: { country: 'ES', taxYear: 2025, incomeType: 'salary', grossIncome: 30000, specialStatus: 'none', region: 'MAD', filingStatus: 'single' } },
  { label: 'ES(MAD) 30k beckham 2025', input: { country: 'ES', taxYear: 2025, incomeType: 'salary', grossIncome: 30000, specialStatus: 'beckham', region: 'MAD', filingStatus: 'single' } },
  { label: 'ES(MAD) 50k 2025', input: { country: 'ES', taxYear: 2025, incomeType: 'salary', grossIncome: 50000, specialStatus: 'none', region: 'MAD', filingStatus: 'single' } },
  { label: 'ES(MAD) 50k beckham 2025', input: { country: 'ES', taxYear: 2025, incomeType: 'salary', grossIncome: 50000, specialStatus: 'beckham', region: 'MAD', filingStatus: 'single' } },
  { label: 'ES(MAD) 120k 2025', input: { country: 'ES', taxYear: 2025, incomeType: 'salary', grossIncome: 120000, specialStatus: 'none', region: 'MAD', filingStatus: 'single' } },
  { label: 'ES(MAD) 120k beckham 2025', input: { country: 'ES', taxYear: 2025, incomeType: 'salary', grossIncome: 120000, specialStatus: 'beckham', region: 'MAD', filingStatus: 'single' } },
  { label: 'PT 30k 2026', input: { country: 'PT', taxYear: 2026, incomeType: 'salary', grossIncome: 30000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'PT 30k ifici 2026', input: { country: 'PT', taxYear: 2026, incomeType: 'salary', grossIncome: 30000, specialStatus: 'ifici', filingStatus: 'single' } },
  { label: 'PT 50k 2026', input: { country: 'PT', taxYear: 2026, incomeType: 'salary', grossIncome: 50000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'PT 50k ifici 2026', input: { country: 'PT', taxYear: 2026, incomeType: 'salary', grossIncome: 50000, specialStatus: 'ifici', filingStatus: 'single' } },
  { label: 'PT 120k 2026', input: { country: 'PT', taxYear: 2026, incomeType: 'salary', grossIncome: 120000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'PT 120k ifici 2026', input: { country: 'PT', taxYear: 2026, incomeType: 'salary', grossIncome: 120000, specialStatus: 'ifici', filingStatus: 'single' } },
  { label: 'DE 150k 2026', input: { country: 'DE', taxYear: 2026, incomeType: 'salary', grossIncome: 150000, specialStatus: 'none', filingStatus: 'single' } },
];

const fmt = (n: number) => Math.floor(n).toLocaleString('en-IE', { maximumFractionDigits: 0 });

for (const s of scenarios) {
  const r = calculateTax(s.input) as {
    taxOwed: number; socialContributions: number; netIncome: number; effectiveRate: number; provisional?: boolean;
  };
  console.log(
    `${s.label.padEnd(26)} tax ${fmt(r.taxOwed).padStart(7)}  ss ${fmt(r.socialContributions).padStart(7)}  net ${fmt(r.netIncome).padStart(7)}  eff ${(r.effectiveRate * 100).toFixed(1)}%  ${r.provisional ? '[prov]' : ''}`,
  );
}
