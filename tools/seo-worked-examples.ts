/**
 * tools/seo-worked-examples.ts — one-off: compute the real numbers embedded
 * in the Phase-2 knowledge articles. Output only (not part of the app).
 * Run: pnpm exec tsx tools/seo-worked-examples.ts
 */
import { calculateTax } from '../src/rules';

const scenarios: Array<{ label: string; input: Record<string, unknown> }> = [
  { label: 'NL 80k standard 2026', input: { country: 'NL', taxYear: 2026, incomeType: 'salary', grossIncome: 80000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'ES(MAD) 80k standard 2025', input: { country: 'ES', taxYear: 2025, incomeType: 'salary', grossIncome: 80000, specialStatus: 'none', region: 'MAD', filingStatus: 'single' } },
  { label: 'ES(MAD) 80k beckham 2025', input: { country: 'ES', taxYear: 2025, incomeType: 'salary', grossIncome: 80000, specialStatus: 'beckham', region: 'MAD', filingStatus: 'single' } },
  { label: 'PT 80k standard 2026', input: { country: 'PT', taxYear: 2026, incomeType: 'salary', grossIncome: 80000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'PT 80k ifici 2026', input: { country: 'PT', taxYear: 2026, incomeType: 'salary', grossIncome: 80000, specialStatus: 'ifici', filingStatus: 'single' } },
  { label: 'UK 80k standard 2025-26', input: { country: 'UK', taxYear: 2025, incomeType: 'salary', grossIncome: 80000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'UK 80k fig 2025-26', input: { country: 'UK', taxYear: 2025, incomeType: 'salary', grossIncome: 80000, specialStatus: 'fig', filingStatus: 'single' } },
  { label: 'UK 50k standard 2025-26', input: { country: 'UK', taxYear: 2025, incomeType: 'salary', grossIncome: 50000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'DE 60k standard 2026', input: { country: 'DE', taxYear: 2026, incomeType: 'salary', grossIncome: 60000, specialStatus: 'none', filingStatus: 'single' } },
  { label: 'DE 80k standard 2026', input: { country: 'DE', taxYear: 2026, incomeType: 'salary', grossIncome: 80000, specialStatus: 'none', filingStatus: 'single' } },
];

const fmt = (n: number) => Math.floor(n).toLocaleString('en-IE', { maximumFractionDigits: 0 });

for (const s of scenarios) {
  const r = calculateTax(s.input) as {
    taxOwed: number; netIncome: number; effectiveRate: number; source: string; provisional?: boolean;
  };
  console.log(
    `${s.label.padEnd(28)} tax ${fmt(r.taxOwed).padStart(8)}  net ${fmt(r.netIncome).padStart(8)}  eff ${(r.effectiveRate * 100).toFixed(1)}%  ${r.provisional ? '[provisional] ' : ''}${r.source}`,
  );
}
