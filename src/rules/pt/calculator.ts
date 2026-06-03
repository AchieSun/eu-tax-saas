/**
 * Portugal — IRS (Imposto sobre o Rendimento das Pessoas Singulares) rule engine
 *
 * Sources:
 *   § 68.º CIRS (current): https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/cirs_rep/Pages/irs68.aspx
 *   Lei n.º 55-A/2025 (22/07/2025): IRS reduction applied to 2025 brackets
 *   Lei n.º 73-A/2025 (30/12/2025): OE 2026 brackets
 *   PwC Guia Fiscal 2025 (updated 25/07/2025): https://www.pwc.pt/pt/pwcinforfisco/guia-fiscal/2025/irs.html
 *   IFICI (art. 58.º-A EBF): https://info.portaldasfinancas.gov.pt/pt/apoio_contribuinte/questoes_frequentes/Pages/faqs-01018.aspx
 *
 * Calculation (art. 68.º n.º 2 CIRS) — split method, mathematically equivalent to:
 *   IRS = rendimento_coletavel × taxa_normal_do_escalao − parcela_a_abater
 *
 * Solidariedade (art. 68.º-A CIRS):
 *   2.5% on income € 80,000 – € 250,000
 *   5.0% on income > € 250,000
 *
 * IFICI: 20% flat on Category A/B income from qualifying high-value-added activity.
 *        Foreign-source income generally exempt (with progression); pensions taxed normally.
 *        Replaces former NHR (closed to new entrants 1 January 2024).
 */

import type { CalculatorInput, CalculatorResult, TaxBreakdownItem } from '../common/types';
import { floorEur, round } from '../common/types';

interface Bracket {
  upTo: number;
  normalRate: number;
  parcelaAbater: number;
}

interface SolidarityBracket {
  rangeFrom: number;
  rangeTo: number;
  rate: number;
}

// 2025 — Continente (final, after Lei 55-A/2025 of 22/07/2025)
const PT_2025_CONTINENTE: Bracket[] = [
  { upTo: 8059, normalRate: 0.125, parcelaAbater: 0 },
  { upTo: 12160, normalRate: 0.16, parcelaAbater: 282.07 },
  { upTo: 17233, normalRate: 0.215, parcelaAbater: 950.91 },
  { upTo: 22306, normalRate: 0.244, parcelaAbater: 1450.67 },
  { upTo: 28400, normalRate: 0.314, parcelaAbater: 3011.98 },
  { upTo: 41629, normalRate: 0.349, parcelaAbater: 4006.1 },
  { upTo: 44987, normalRate: 0.431, parcelaAbater: 7419.54 },
  { upTo: 83696, normalRate: 0.446, parcelaAbater: 8094.51 },
  { upTo: Number.POSITIVE_INFINITY, normalRate: 0.48, parcelaAbater: 10939.9 },
];

// 2025 — Açores (regional reduction)
const PT_2025_ACORES: Bracket[] = [
  { upTo: 8059, normalRate: 0.0875, parcelaAbater: 0 },
  { upTo: 12160, normalRate: 0.112, parcelaAbater: 197.45 },
  { upTo: 17233, normalRate: 0.1505, parcelaAbater: 665.64 },
  { upTo: 22306, normalRate: 0.1708, parcelaAbater: 1015.47 },
  { upTo: 28400, normalRate: 0.2198, parcelaAbater: 2108.39 },
  { upTo: 41629, normalRate: 0.2443, parcelaAbater: 2804.27 },
  { upTo: 44987, normalRate: 0.3017, parcelaAbater: 5193.68 },
  { upTo: 83696, normalRate: 0.3122, parcelaAbater: 5666.16 },
  { upTo: Number.POSITIVE_INFINITY, normalRate: 0.336, parcelaAbater: 7657.93 },
];

/**
 * 2026 — Continente, derived from § 68.º CIRS (Lei 73-A/2025).
 * Parcela a abater computed from taxa média (column B): parcela[i] = upTo[i-1] * (rate[i] - taxaMedia[i-1]).
 * AT will publish definitive folheto IRS_deducoes_2026.pdf in Q1 2026 — mark provisional.
 */
const PT_2026_CONTINENTE_RAW = [
  { upTo: 8342, normalRate: 0.125, taxaMedia: 0.125 },
  { upTo: 12587, normalRate: 0.157, taxaMedia: 0.13579 },
  { upTo: 17838, normalRate: 0.212, taxaMedia: 0.15823 },
  { upTo: 23089, normalRate: 0.241, taxaMedia: 0.17705 },
  { upTo: 29397, normalRate: 0.311, taxaMedia: 0.20579 },
  { upTo: 43090, normalRate: 0.349, taxaMedia: 0.2513 },
  { upTo: 46566, normalRate: 0.431, taxaMedia: 0.26472 },
  { upTo: 86634, normalRate: 0.446, taxaMedia: 0.34856 },
  { upTo: Number.POSITIVE_INFINITY, normalRate: 0.48, taxaMedia: null as number | null },
];

function derive2026Brackets(): Bracket[] {
  const out: Bracket[] = [];
  for (let i = 0; i < PT_2026_CONTINENTE_RAW.length; i++) {
    const cur = PT_2026_CONTINENTE_RAW[i];
    if (!cur) continue;
    if (i === 0) {
      out.push({ upTo: cur.upTo, normalRate: cur.normalRate, parcelaAbater: 0 });
      continue;
    }
    const prev = PT_2026_CONTINENTE_RAW[i - 1];
    if (!prev || prev.taxaMedia === null) {
      // Defensive: keep prior parcela for top bracket (cannot derive without taxa media).
      const prevOut = out[i - 1];
      out.push({
        upTo: cur.upTo,
        normalRate: cur.normalRate,
        parcelaAbater: prevOut ? prevOut.parcelaAbater : 0,
      });
      continue;
    }
    const parcela = prev.upTo * (cur.normalRate - prev.taxaMedia);
    out.push({
      upTo: cur.upTo,
      normalRate: cur.normalRate,
      parcelaAbater: round(parcela, 2),
    });
  }
  return out;
}

const PT_2026_CONTINENTE = derive2026Brackets();

const PT_SOLIDARIDADE: SolidarityBracket[] = [
  { rangeFrom: 80000, rangeTo: 250000, rate: 0.025 },
  { rangeFrom: 250000, rangeTo: Number.POSITIVE_INFINITY, rate: 0.05 },
];

const IFICI_FLAT_RATE = 0.2;

type Region = 'continente' | 'acores' | 'madeira';

function getBrackets(year: number, region: Region): Bracket[] {
  if (year === 2025) {
    if (region === 'acores') return PT_2025_ACORES;
    // Madeira uses Continente as default until specialised table added
    return PT_2025_CONTINENTE;
  }
  if (year === 2026) {
    return PT_2026_CONTINENTE;
  }
  throw new Error(`PT IRS not coded for year ${year}`);
}

function applyIrsSplit(rc: number, brackets: Bracket[]): { tax: number; marginalRate: number } {
  if (rc <= 0) return { tax: 0, marginalRate: 0 };
  for (const b of brackets) {
    if (rc <= b.upTo) {
      const tax = Math.max(0, rc * b.normalRate - b.parcelaAbater);
      return { tax, marginalRate: b.normalRate };
    }
  }
  // Fallback to top bracket (unreachable because last upTo is Infinity)
  const top = brackets[brackets.length - 1];
  if (!top) return { tax: 0, marginalRate: 0 };
  return {
    tax: Math.max(0, rc * top.normalRate - top.parcelaAbater),
    marginalRate: top.normalRate,
  };
}

function solidariedade(rc: number): number {
  let extra = 0;
  for (const s of PT_SOLIDARIDADE) {
    if (rc > s.rangeFrom) {
      const slice = Math.min(rc, s.rangeTo) - s.rangeFrom;
      extra += slice * s.rate;
    }
  }
  return extra;
}

export function calculatePt(input: CalculatorInput): CalculatorResult {
  const { grossIncome, taxYear, specialStatus, region } = input;
  const reg: Region = (region as Region) === 'acores' ? 'acores' : 'continente';

  // IFICI: 20% flat on Cat A/B Portuguese-source income, no parcela, no family quotient.
  if (specialStatus === 'ifici') {
    const tax = grossIncome * IFICI_FLAT_RATE;
    return {
      country: 'PT',
      taxYear,
      grossIncome,
      taxOwed: floorEur(tax),
      netIncome: grossIncome - tax,
      effectiveRate: IFICI_FLAT_RATE,
      marginalRate: IFICI_FLAT_RATE,
      breakdown: [
        {
          label: 'IFICI — Incentivo Fiscal à Investigação Científica e Inovação',
          amount: tax,
          rate: IFICI_FLAT_RATE,
          citation: 'Art. 58.º-A EBF',
        },
      ],
      source: 'AT — IFICI regime (art. 58.º-A EBF)',
    };
  }

  const brackets = getBrackets(taxYear, reg);
  const { tax: irs, marginalRate } = applyIrsSplit(grossIncome, brackets);
  const sol = solidariedade(grossIncome);
  const total = irs + sol;
  const breakdown: TaxBreakdownItem[] = [
    {
      label: `IRS (art. 68.º CIRS, ${reg})`,
      amount: irs,
      citation: 'Art. 68.º CIRS',
    },
  ];
  if (sol > 0) {
    breakdown.push({
      label: 'Taxa adicional de solidariedade',
      amount: sol,
      citation: 'Art. 68.º-A CIRS',
    });
  }

  return {
    country: 'PT',
    taxYear,
    grossIncome,
    taxOwed: floorEur(total),
    netIncome: grossIncome - total,
    effectiveRate: round(total / grossIncome, 4),
    marginalRate: round(marginalRate, 4),
    breakdown,
    source: 'AT — Autoridade Tributária e Aduaneira, art. 68.º CIRS',
    provisional: taxYear === 2026, // parcela a abater values derived, pending AT folheto
  };
}
