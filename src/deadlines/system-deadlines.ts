import type { DeadlineCategory } from './types';
import type { SystemDeadlineTemplate } from './repository';

interface CatalogEntry {
  jurisdiction: string;
  category: DeadlineCategory;
  title: string;
  description: string;
  dueDate: (taxYear: number) => string;
  reminderDays: number;
}

const CATALOG: CatalogEntry[] = [
  {
    jurisdiction: 'PT',
    category: 'tax_filing',
    title: 'PT IRS Modelo 1 filing deadline',
    description: 'Annual personal income tax return (IRS Modelo 1) for Portuguese tax residents.',
    dueDate: () => '2025-06-30',
    reminderDays: 14,
  },
  {
    jurisdiction: 'PT',
    category: 'payment',
    title: 'PT IRS first instalment payment',
    description: 'First instalment of personal income tax due if payable amount exceeds €100.',
    dueDate: () => '2025-07-31',
    reminderDays: 7,
  },
  {
    jurisdiction: 'ES',
    category: 'tax_filing',
    title: 'ES IRPF filing deadline',
    description: 'Annual Spanish personal income tax return (IRPF / Modelo 100).',
    dueDate: () => '2025-06-30',
    reminderDays: 14,
  },
  {
    jurisdiction: 'ES',
    category: 'payment',
    title: 'ES IRPF payment deadline',
    description: 'Final payment due for Spanish IRPF if not paid by direct debit.',
    dueDate: () => '2025-06-30',
    reminderDays: 7,
  },
  {
    jurisdiction: 'DE',
    category: 'tax_filing',
    title: 'DE Einkommensteuer filing deadline',
    description: 'Annual German income tax return (Einkommensteuererklärung) deadline for self-prepared returns.',
    dueDate: () => '2025-05-31',
    reminderDays: 14,
  },
  {
    jurisdiction: 'NL',
    category: 'tax_filing',
    title: 'NL Income tax filing deadline',
    description: 'Annual Dutch personal income tax return (aangifte inkomstenbelasting) deadline.',
    dueDate: () => '2025-05-01',
    reminderDays: 14,
  },
  {
    jurisdiction: 'UK',
    category: 'tax_filing',
    title: 'UK Self Assessment online filing deadline',
    description: 'Online Self Assessment tax return deadline for the tax year ended 5 April.',
    dueDate: () => '2026-01-31',
    reminderDays: 14,
  },
  {
    jurisdiction: 'UK',
    category: 'payment',
    title: 'UK Self Assessment balancing payment',
    description: 'Balancing payment for the tax year ended 5 April.',
    dueDate: () => '2026-01-31',
    reminderDays: 7,
  },
];

export function getSystemDeadlines(
  jurisdictions: string[],
  taxYear: number,
): SystemDeadlineTemplate[] {
  const wanted = new Set(jurisdictions.map((j) => j.toUpperCase()));
  return CATALOG.filter((entry) => wanted.has(entry.jurisdiction))
    .map((entry) => ({
      jurisdiction: entry.jurisdiction,
      taxYear,
      title: entry.title,
      description: entry.description,
      dueDate: entry.dueDate(taxYear),
      category: entry.category,
      reminderDays: entry.reminderDays,
    }));
}

export function listSupportedJurisdictions(): string[] {
  return Array.from(new Set(CATALOG.map((entry) => entry.jurisdiction)));
}
