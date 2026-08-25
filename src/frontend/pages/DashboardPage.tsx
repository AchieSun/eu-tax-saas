/**
 * F7 — User dashboard (entry point after login).
 *
 * Mobile-first card layout that stitches together residency, tax estimate,
 * top strategies, days tracker, filing draft and upcoming deadlines.
 * All data comes from a single GET /api/dashboard call.
 *
 * i18n: every label goes through t() so the card grid flips between
 * zh/en reactively with the global locale signal.
 */

import { type Component, For, Show, createResource, createSignal } from 'solid-js';
import { t } from '../i18n';

interface DashboardResidency {
  country: string;
  flag: string;
  isResident: boolean;
  confidence: string;
  hasConflict: boolean;
  conflictWith: string | null;
  assessedAt: string | null;
}

interface DashboardStrategy {
  id: string;
  title: string;
  tier: string;
  estimatedSavings: number | null;
}

interface DashboardDayCount {
  country: string;
  flag: string;
  days: number;
}

interface DashboardDeadline {
  id: string;
  title: string;
  dueDate: string;
  status: string;
  category: string;
  jurisdiction: string;
  daysRemaining: number;
}

interface DashboardResponse {
  ok: boolean;
  taxYear: number;
  user: {
    firstName: string;
    subscriptionStatus: string;
  };
  residency: DashboardResidency | null;
  taxEstimate: {
    country: string;
    grossIncome: number;
    taxOwed: number;
    effectiveRate: number;
  } | null;
  strategies: DashboardStrategy[];
  days: DashboardDayCount[];
  deadlines: DashboardDeadline[];
  onboarding: {
    currentStep: number;
    complete: boolean;
  };
  filing: {
    completeness: number;
    nextStep: string;
  };
}

async function fetchDashboard(taxYear: number): Promise<DashboardResponse> {
  const r = await fetch(`/api/dashboard?taxYear=${taxYear}`);
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: 'Unknown error' }));
    const message =
      typeof err === 'object' && err != null && 'error' in err && typeof err.error === 'string'
        ? err.error
        : `HTTP ${r.status}`;
    throw new Error(message);
  }
  return r.json() as Promise<DashboardResponse>;
}

const countryName = (code: string): string => t(`country.${code}`) ?? code;

const DashboardPage: Component = () => {
  const [taxYear, setTaxYear] = createSignal<number>(2025);
  const [data] = createResource(taxYear, fetchDashboard);

  const cardStyle = {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    'border-radius': '12px',
    padding: '1.25rem',
    'box-shadow': '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
  };

  const cardTitleStyle = {
    'font-size': '0.875rem',
    'font-weight': 600,
    color: '#6b7280',
    'text-transform': 'uppercase' as const,
    'letter-spacing': '0.025em',
    'margin-bottom': '0.75rem',
  };

  const valueStyle = {
    'font-size': '1.5rem',
    'font-weight': 700,
    color: '#111827',
  };

  const ctaStyle = {
    display: 'inline-block',
    'margin-top': '0.75rem',
    'font-size': '0.875rem',
    color: '#2563eb',
    'font-weight': 600,
    'text-decoration': 'none',
  };

  const emptyStyle = {
    color: '#6b7280',
    'font-size': '0.875rem',
    'line-height': 1.5,
  };

  return (
    <div style={{ 'max-width': '720px', margin: '0 auto' }}>
      <style>{dashboardStyles}</style>

      <div
        style={{
          display: 'flex',
          'flex-wrap': 'wrap',
          'align-items': 'center',
          'justify-content': 'space-between',
          gap: '0.75rem',
          'margin-bottom': '1.5rem',
        }}
      >
        <h1 style={{ 'font-size': '1.5rem', 'font-weight': 700, color: '#111827', margin: 0 }}>
          <Show when={data()} fallback={t('dashboard.welcome')}>
            {t('dashboard.welcomeName', { name: data()?.user.firstName ?? '' })}
          </Show>
        </h1>
        <label
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '0.5rem',
            'font-size': '0.875rem',
            color: '#374151',
          }}
        >
          {t('dashboard.taxYear')}
          <select
            value={taxYear()}
            onChange={(e) => setTaxYear(Number.parseInt(e.currentTarget.value, 10))}
            class="dashboard-select"
          >
            <option value={2024}>2024</option>
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
          </select>
        </label>
      </div>

      <Show when={data.error}>
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '1rem',
            'border-radius': '8px',
            'margin-bottom': '1rem',
            'font-size': '0.875rem',
          }}
        >
          {t('dashboard.error', {
            message: data.error?.message ?? t('common.unknownError'),
          })}
        </div>
      </Show>

      <Show when={data.loading}>
        <div style={{ ...cardStyle, color: '#6b7280', 'font-size': '0.875rem' }}>
          {t('common.loading')}
        </div>
      </Show>

      <Show when={data()}>
        {(d) => (
          <div class="dashboard-grid">
            <Show when={!d().onboarding.complete}>
              <div style={cardStyle}>
                <div style={cardTitleStyle}>{t('dashboard.onboarding.title')}</div>
                <div style={valueStyle}>
                  {t('dashboard.percentComplete', {
                    value: Math.round((d().onboarding.currentStep / 5) * 100),
                  })}
                </div>
                <div
                  style={{
                    'margin-top': '0.5rem',
                    height: '6px',
                    background: '#e5e7eb',
                    'border-radius': '3px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.round((d().onboarding.currentStep / 5) * 100)}%`,
                      height: '100%',
                      background: '#2563eb',
                    }}
                  />
                </div>
                <a href="#onboarding" style={ctaStyle}>
                  {t('dashboard.onboarding.cta')}
                </a>
              </div>
            </Show>

            {/* Residency */}
            <div style={cardStyle}>
              <div style={cardTitleStyle}>{t('dashboard.residency.title')}</div>
              <Show
                when={d().residency}
                fallback={
                  <div style={emptyStyle}>
                    {t('dashboard.residency.empty')}
                    <a href="#residency" style={ctaStyle}>
                      {t('dashboard.residency.start')}
                    </a>
                  </div>
                }
              >
                {(r) => (
                  <>
                    <div style={valueStyle}>
                      {r().flag} {countryName(r().country)}
                    </div>
                    <div
                      style={{ 'font-size': '0.875rem', color: '#374151', 'margin-top': '0.25rem' }}
                    >
                      {t('dashboard.residency.statusLine', {
                        status: r().isResident
                          ? t('dashboard.residency.resident')
                          : t('dashboard.residency.nonResident'),
                        confidence: r().confidence,
                      })}
                    </div>
                    <Show when={r().hasConflict}>
                      <div
                        style={{
                          'margin-top': '0.5rem',
                          'font-size': '0.8rem',
                          color: '#92400e',
                          background: '#fef3c7',
                          padding: '0.375rem 0.5rem',
                          'border-radius': '6px',
                          display: 'inline-block',
                        }}
                      >
                        {t('dashboard.residency.conflict', {
                          country: r().conflictWith
                            ? countryName(r().conflictWith as string)
                            : t('dashboard.residency.conflictOther'),
                        })}
                      </div>
                    </Show>
                    <a href="#residency" style={ctaStyle}>
                      {t('dashboard.residency.details')}
                    </a>
                  </>
                )}
              </Show>
            </div>

            {/* Tax estimate */}
            <div style={cardStyle}>
              <div style={cardTitleStyle}>{t('dashboard.tax.title')}</div>
              <Show
                when={d().taxEstimate}
                fallback={
                  <div style={emptyStyle}>
                    {t('dashboard.tax.empty')}
                    <a href="#compare" style={ctaStyle}>
                      {t('dashboard.tax.compare')}
                    </a>
                  </div>
                }
              >
                {(est) => (
                  <>
                    <div style={valueStyle}>€{Math.round(est().taxOwed).toLocaleString()}</div>
                    <div
                      style={{ 'font-size': '0.875rem', color: '#374151', 'margin-top': '0.25rem' }}
                    >
                      {t('dashboard.tax.effectiveRate', {
                        rate: (est().effectiveRate * 100).toFixed(1),
                        country: countryName(est().country),
                      })}
                    </div>
                    <a href="#compare" style={ctaStyle}>
                      {t('dashboard.tax.recalculate')}
                    </a>
                  </>
                )}
              </Show>
            </div>

            {/* Strategies */}
            <div style={cardStyle}>
              <div style={cardTitleStyle}>{t('dashboard.strategies.title')}</div>
              <Show
                when={d().strategies.length > 0}
                fallback={
                  <div style={emptyStyle}>
                    {t('dashboard.strategies.empty')}
                    <a href="#strategies" style={ctaStyle}>
                      {t('dashboard.strategies.library')}
                    </a>
                  </div>
                }
              >
                <ol style={{ margin: 0, padding: '0 0 0 1.1rem', color: '#111827' }}>
                  <For each={d().strategies}>
                    {(s) => {
                      const savings = s.estimatedSavings;
                      return (
                        <li style={{ 'font-size': '0.95rem', 'margin-bottom': '0.5rem' }}>
                          <span style={{ 'font-weight': 600 }}>{s.title}</span>
                          <Show when={savings != null}>
                            <span style={{ color: '#059669', 'margin-left': '0.5rem' }}>
                              {t('dashboard.strategies.savings', {
                                amount: Math.round(savings as number).toLocaleString(),
                              })}
                            </span>
                          </Show>
                        </li>
                      );
                    }}
                  </For>
                </ol>
                <a href="#strategies" style={ctaStyle}>
                  {t('dashboard.strategies.viewAll')}
                </a>
              </Show>
            </div>

            {/* Days tracker */}
            <div style={cardStyle}>
              <div style={cardTitleStyle}>{t('dashboard.days.title')}</div>
              <div
                style={{
                  display: 'grid',
                  'grid-template-columns': 'repeat(auto-fit, minmax(90px, 1fr))',
                  gap: '0.5rem',
                }}
              >
                <For each={d().days}>
                  {(dc) => (
                    <div
                      style={{
                        background: '#f9fafb',
                        border: '1px solid #e5e7eb',
                        'border-radius': '8px',
                        padding: '0.625rem',
                        'text-align': 'center',
                      }}
                    >
                      <div style={{ 'font-size': '1.25rem' }}>{dc.flag}</div>
                      <div
                        style={{ 'font-size': '1.125rem', 'font-weight': 700, color: '#111827' }}
                      >
                        {dc.days}
                      </div>
                      <div style={{ 'font-size': '0.75rem', color: '#6b7280' }}>
                        {t('dashboard.days.unit')}
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <a href="#calendar" style={ctaStyle}>
                {t('dashboard.days.openCalendar')}
              </a>
            </div>

            {/* Filing draft */}
            <div style={cardStyle}>
              <div style={cardTitleStyle}>{t('dashboard.filing.title')}</div>
              <Show
                when={d().filing.completeness > 0}
                fallback={
                  <div style={emptyStyle}>
                    {d().filing.nextStep}
                    <a href={d().onboarding.complete ? '#filing' : '#onboarding'} style={ctaStyle}>
                      {t('dashboard.filing.start')}
                    </a>
                  </div>
                }
              >
                <div style={valueStyle}>
                  {t('dashboard.percentComplete', { value: d().filing.completeness })}
                </div>
                <div
                  style={{
                    'margin-top': '0.5rem',
                    height: '6px',
                    background: '#e5e7eb',
                    'border-radius': '3px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${d().filing.completeness}%`,
                      height: '100%',
                      background: '#2563eb',
                    }}
                  />
                </div>
                <a href="#filing" style={ctaStyle}>
                  {t('dashboard.filing.continue')}
                </a>
              </Show>
            </div>

            {/* Upcoming deadlines */}
            <div style={cardStyle}>
              <div style={cardTitleStyle}>{t('dashboard.deadlines.title')}</div>
              <Show
                when={d().deadlines.length > 0}
                fallback={
                  <div style={emptyStyle}>
                    {t('dashboard.deadlines.empty')}
                    <a href="#deadlines" style={ctaStyle}>
                      {t('dashboard.deadlines.manage')}
                    </a>
                  </div>
                }
              >
                <ul style={{ margin: 0, padding: 0, 'list-style': 'none' }}>
                  <For each={d().deadlines}>
                    {(dl) => (
                      <li
                        style={{
                          'font-size': '0.9rem',
                          padding: '0.5rem 0',
                          'border-bottom': '1px solid #f3f4f6',
                        }}
                      >
                        <div style={{ 'font-weight': 600, color: '#111827' }}>{dl.title}</div>
                        <div style={{ 'font-size': '0.8rem', color: '#6b7280' }}>
                          {t('dashboard.deadlines.meta', {
                            date: dl.dueDate,
                            days: dl.daysRemaining,
                            country: countryName(dl.jurisdiction),
                          })}
                        </div>
                      </li>
                    )}
                  </For>
                </ul>
                <a href="#deadlines" style={ctaStyle}>
                  {t('dashboard.deadlines.viewAll')}
                </a>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

const dashboardStyles = `
.dashboard-grid {
  display: grid;
  gap: 1rem;
}
.dashboard-select {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.375rem 0.75rem;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #111827;
}
@media (min-width: 640px) {
  .dashboard-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
`;

export default DashboardPage;
