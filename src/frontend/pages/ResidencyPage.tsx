/**
 * F2 ResidencyPage — single-country and multi-country tax residency assessment.
 *
 * Posts to /api/residency/assess and /api/residency/assess-multi and renders
 * the result with confidence, reasoning, applied rules and warnings.
 */

import { type Component, For, Show, createSignal } from 'solid-js';
import type { Country } from '../../rules/common/types';
import { useI18n } from '../i18n';
import {
  type ResidencyInput,
  type ResidencyResult,
  postAssess,
  postAssessMulti,
} from './residency/api';

const COUNTRIES: Country[] = ['DE', 'NL', 'PT', 'ES', 'UK'];
const YEARS = [2024, 2025, 2026];

const COUNTRY_FLAGS: Record<Country, string> = {
  DE: '🇩🇪',
  NL: '🇳🇱',
  PT: '🇵🇹',
  ES: '🇪🇸',
  UK: '🇬🇧',
};

interface MultiRow {
  id: string;
  country: Country;
  taxYear: number;
  daysInCountry: number;
  hasPermanentHome: boolean;
}

function makeSingleInput(
  country: Country,
  taxYear: number,
  daysInCountry: number,
  hasPermanentHome: boolean | null,
): ResidencyInput {
  return {
    country,
    taxYear,
    daysInCountry,
    daysInOtherCountries: {},
    hasPermanentHome,
    spouseChildrenIn: null,
    centerOfVitalInterests: null,
    habitualAbode: null,
    nationality: null,
  };
}

const ResidencyPage: Component = () => {
  const { t } = useI18n();
  /** Locale-aware country label ('德国 DE' / 'Germany DE'). */
  const countryLabel = (c: Country) => t(`calendar.country.${c}`);
  const [mode, setMode] = createSignal<'single' | 'multi'>('single');

  // Single-country form state
  const [country, setCountry] = createSignal<Country>('DE');
  const [taxYear, setTaxYear] = createSignal<number>(2025);
  const [days, setDays] = createSignal<number>(183);
  const [hasPermanentHome, setHasPermanentHome] = createSignal<boolean | null>(null);

  // Multi-country form state
  const [rows, setRows] = createSignal<MultiRow[]>([
    { id: '1', country: 'DE', taxYear: 2025, daysInCountry: 183, hasPermanentHome: false },
    { id: '2', country: 'PT', taxYear: 2025, daysInCountry: 60, hasPermanentHome: false },
  ]);

  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [singleResult, setSingleResult] = createSignal<ResidencyResult | null>(null);
  const [multiResult, setMultiResult] = createSignal<Awaited<
    ReturnType<typeof postAssessMulti>
  > | null>(null);

  function resetResults() {
    setSingleResult(null);
    setMultiResult(null);
    setError(null);
  }

  async function onAssessSingle(e: Event) {
    e.preventDefault();
    resetResults();
    setLoading(true);
    try {
      const result = await postAssess(
        makeSingleInput(country(), taxYear(), days(), hasPermanentHome()),
      );
      setSingleResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function onAssessMulti(e: Event) {
    e.preventDefault();
    resetResults();
    setLoading(true);
    try {
      const inputs: ResidencyInput[] = rows().map((r) =>
        makeSingleInput(r.country, r.taxYear, r.daysInCountry, r.hasPermanentHome),
      );
      const result = await postAssessMulti(inputs);
      setMultiResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function addRow() {
    if (rows().length >= 5) return;
    setRows((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        country: 'NL',
        taxYear: 2025,
        daysInCountry: 0,
        hasPermanentHome: false,
      },
    ]);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function updateRow(id: string, patch: Partial<MultiRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div>
      <style>{styles}</style>

      <header class="res-hero">
        <h1 class="res-h1">{t('residency.title')}</h1>
        <p class="res-sub">{t('residency.subtitle')}</p>
      </header>

      <div class="res-mode-bar">
        <button
          type="button"
          class="res-mode-btn"
          classList={{ 'res-mode-active': mode() === 'single' }}
          onClick={() => {
            setMode('single');
            resetResults();
          }}
        >
          {t('residency.mode.single')}
        </button>
        <button
          type="button"
          class="res-mode-btn"
          classList={{ 'res-mode-active': mode() === 'multi' }}
          onClick={() => {
            setMode('multi');
            resetResults();
          }}
        >
          {t('residency.mode.multi')}
        </button>
      </div>

      <Show when={error()}>
        {(msg) => (
          <div class="res-error" role="alert">
            <span>⚠️ {msg()}</span>
            <button type="button" class="res-btn res-btn-ghost" onClick={() => setError(null)}>
              {t('residency.error.clear')}
            </button>
          </div>
        )}
      </Show>

      <Show when={mode() === 'single'}>
        <form class="res-panel" onSubmit={onAssessSingle}>
          <div class="res-grid">
            <div class="res-field">
              <label for="res-country">{t('residency.field.country')}</label>
              <select
                id="res-country"
                class="res-input"
                value={country()}
                onChange={(e) => setCountry(e.currentTarget.value as Country)}
              >
                <For each={COUNTRIES}>
                  {(c) => (
                    <option value={c}>
                      {COUNTRY_FLAGS[c]} {countryLabel(c)}
                    </option>
                  )}
                </For>
              </select>
            </div>
            <div class="res-field">
              <label for="res-year">{t('residency.field.taxYear')}</label>
              <select
                id="res-year"
                class="res-input"
                value={String(taxYear())}
                onChange={(e) => setTaxYear(Number(e.currentTarget.value))}
              >
                <For each={YEARS}>{(y) => <option value={String(y)}>{y}</option>}</For>
              </select>
            </div>
            <div class="res-field">
              <label for="res-days">{t('residency.field.days')}</label>
              <input
                id="res-days"
                class="res-input"
                type="number"
                min={0}
                max={366}
                value={days()}
                onInput={(e) => setDays(Number(e.currentTarget.value))}
              />
            </div>
            <div class="res-field">
              <label for="res-home">{t('residency.field.home')}</label>
              <select
                id="res-home"
                class="res-input"
                value={hasPermanentHome() === null ? '' : String(hasPermanentHome())}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setHasPermanentHome(v === '' ? null : v === 'true');
                }}
              >
                <option value="">{t('residency.field.home.unknown')}</option>
                <option value="true">{t('residency.field.home.yes')}</option>
                <option value="false">{t('residency.field.home.no')}</option>
              </select>
            </div>
          </div>
          <div class="res-actions">
            <button type="submit" class="res-btn res-btn-primary" disabled={loading()}>
              {loading() ? t('residency.action.assessing') : t('residency.action.assessSingle')}
            </button>
          </div>
        </form>
      </Show>

      <Show when={mode() === 'multi'}>
        <form class="res-panel" onSubmit={onAssessMulti}>
          <For each={rows()}>
            {(r, idx) => (
              <div class="res-row">
                <div class="res-row-head">
                  <span class="res-row-title">{t('residency.row.countryN', { n: idx() + 1 })}</span>
                  <Show when={rows().length > 1}>
                    <button
                      type="button"
                      class="res-btn res-btn-ghost res-btn-small"
                      onClick={() => removeRow(r.id)}
                    >
                      {t('residency.action.remove')}
                    </button>
                  </Show>
                </div>
                <div class="res-grid">
                  <div class="res-field">
                    <label for={`res-m-country-${r.id}`}>{t('residency.field.country')}</label>
                    <select
                      id={`res-m-country-${r.id}`}
                      class="res-input"
                      value={r.country}
                      onChange={(e) =>
                        updateRow(r.id, { country: e.currentTarget.value as Country })
                      }
                    >
                      <For each={COUNTRIES}>
                        {(c) => (
                          <option value={c}>
                            {COUNTRY_FLAGS[c]} {countryLabel(c)}
                          </option>
                        )}
                      </For>
                    </select>
                  </div>
                  <div class="res-field">
                    <label for={`res-m-year-${r.id}`}>{t('residency.field.year')}</label>
                    <select
                      id={`res-m-year-${r.id}`}
                      class="res-input"
                      value={String(r.taxYear)}
                      onChange={(e) => updateRow(r.id, { taxYear: Number(e.currentTarget.value) })}
                    >
                      <For each={YEARS}>{(y) => <option value={String(y)}>{y}</option>}</For>
                    </select>
                  </div>
                  <div class="res-field">
                    <label for={`res-m-days-${r.id}`}>{t('residency.field.daysShort')}</label>
                    <input
                      id={`res-m-days-${r.id}`}
                      class="res-input"
                      type="number"
                      min={0}
                      max={366}
                      value={r.daysInCountry}
                      onInput={(e) =>
                        updateRow(r.id, { daysInCountry: Number(e.currentTarget.value) })
                      }
                    />
                  </div>
                  <div class="res-field">
                    <label for={`res-m-home-${r.id}`}>{t('residency.field.home')}</label>
                    <select
                      id={`res-m-home-${r.id}`}
                      class="res-input"
                      value={String(r.hasPermanentHome)}
                      onChange={(e) =>
                        updateRow(r.id, { hasPermanentHome: e.currentTarget.value === 'true' })
                      }
                    >
                      <option value="false">{t('residency.field.home.no')}</option>
                      <option value="true">{t('residency.field.home.yes')}</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </For>
          <div class="res-actions">
            <button
              type="button"
              class="res-btn res-btn-outline"
              onClick={addRow}
              disabled={rows().length >= 5}
            >
              {t('residency.action.addCountry')}
            </button>
            <button type="submit" class="res-btn res-btn-primary" disabled={loading()}>
              {loading() ? t('residency.action.assessing') : t('residency.action.assessMulti')}
            </button>
          </div>
        </form>
      </Show>

      <Show when={singleResult()}>
        {(r) => (
          <section class="res-result" aria-label={t('residency.result.single')}>
            <div class="res-result-head">
              <span class="res-result-flag">{COUNTRY_FLAGS[r().country]}</span>
              <span class="res-result-country">{countryLabel(r().country)}</span>
              <span
                class="res-badge"
                classList={{
                  'res-badge-resident': r().isResident,
                  'res-badge-nonresident': !r().isResident,
                }}
              >
                {r().isResident
                  ? t('residency.result.resident')
                  : t('residency.result.nonResident')}
              </span>
              <span class={`res-confidence res-confidence-${r().confidence}`}>
                {t('residency.result.confidence', { value: r().confidence })}
              </span>
            </div>
            <p class="res-reasoning">{r().reasoning}</p>
            <Show when={r().appliedRules.length > 0}>
              <div class="res-section">
                <h3>{t('residency.result.appliedRules')}</h3>
                <ul>
                  <For each={r().appliedRules}>{(rule) => <li>{rule}</li>}</For>
                </ul>
              </div>
            </Show>
            <Show when={r().warnings.length > 0}>
              <div class="res-warnings">
                <h3>{t('residency.result.warnings')}</h3>
                <ul>
                  <For each={r().warnings}>{(w) => <li>{w}</li>}</For>
                </ul>
              </div>
            </Show>
          </section>
        )}
      </Show>

      <Show when={multiResult()}>
        {(m) => (
          <section class="res-result" aria-label={t('residency.result.multi')}>
            <div class="res-result-head">
              <span class="res-result-title">{t('residency.result.effective')}</span>
              <span class="res-badge res-badge-resident">
                <Show when={m().effectiveResidence.country} fallback={t('residency.result.none')}>
                  {(c) => `${COUNTRY_FLAGS[c()]} ${countryLabel(c())}`}
                </Show>
              </span>
            </div>
            <p class="res-reasoning">{m().effectiveResidence.reason}</p>
            <Show when={m().effectiveResidence.tiebreakerApplied}>
              <p class="res-tiebreaker">{t('residency.result.tiebreaker')}</p>
            </Show>
            <div class="res-section">
              <h3>{t('residency.result.perCountry')}</h3>
              <div class="res-multi-grid">
                <For each={m().perCountry}>
                  {(r) => (
                    <div class="res-multi-card">
                      <div class="res-multi-card-head">
                        <span>{COUNTRY_FLAGS[r.country]}</span>
                        <strong>{countryLabel(r.country)}</strong>
                        <span
                          class="res-badge"
                          classList={{
                            'res-badge-resident': r.isResident,
                            'res-badge-nonresident': !r.isResident,
                          }}
                        >
                          {r.isResident
                            ? t('residency.result.residentShort')
                            : t('residency.result.nonResidentShort')}
                        </span>
                      </div>
                      <p>{r.reasoning}</p>
                      <span class={`res-confidence res-confidence-${r.confidence}`}>
                        {t('residency.result.confidence', { value: r.confidence })}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </section>
        )}
      </Show>
    </div>
  );
};

export default ResidencyPage;

const styles = `
.res-hero { margin: 0 0 1.5rem; }
.res-h1 {
  font-size: clamp(1.5rem, 3vw, 2rem);
  line-height: 1.2;
  margin: 0 0 0.5rem;
  color: #111827;
  letter-spacing: -0.02em;
}
.res-sub {
  margin: 0;
  color: #6b7280;
  font-size: 0.95rem;
  max-width: 70ch;
  line-height: 1.5;
}

.res-mode-bar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.res-mode-btn {
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  color: #374151;
  cursor: pointer;
  transition: background-color 150ms, color 150ms, border-color 150ms;
}
.res-mode-btn:hover { background: #f9fafb; }
.res-mode-active {
  background: #eff6ff;
  color: #2563eb;
  border-color: #2563eb;
}

.res-panel {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.res-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}
.res-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.res-field label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #374151;
}
.res-input {
  font-family: inherit;
  font-size: 0.9rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
  color: #111827;
  transition: border-color 150ms, box-shadow 150ms;
}
.res-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

.res-row {
  border-bottom: 1px solid #f3f4f6;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
}
.res-row:last-of-type { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
.res-row-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}
.res-row-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: #111827;
}

.res-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.25rem;
  flex-wrap: wrap;
}
.res-btn {
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  min-height: 40px;
  padding: 0 1rem;
  border: 1.5px solid transparent;
  transition: background-color 150ms, color 150ms, border-color 150ms, transform 150ms;
}
.res-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.res-btn-primary { background: #2563eb; color: #ffffff; }
.res-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.res-btn-primary:active:not(:disabled) { transform: translateY(1px); }
.res-btn-outline { background: #ffffff; color: #2563eb; border-color: #2563eb; }
.res-btn-outline:hover:not(:disabled) { background: #eff6ff; }
.res-btn-ghost { background: transparent; color: #374151; border-color: #e5e7eb; }
.res-btn-ghost:hover:not(:disabled) { background: #f3f4f6; }
.res-btn-small { min-height: 32px; padding: 0 0.625rem; font-size: 0.8rem; }

.res-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.res-result {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.res-result-head {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}
.res-result-flag { font-size: 1.5rem; line-height: 1; }
.res-result-country {
  font-size: 1.125rem;
  font-weight: 700;
  color: #111827;
}
.res-result-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.res-badge {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.res-badge-resident { background: #d1fae5; color: #065f46; }
.res-badge-nonresident { background: #f3f4f6; color: #374151; }
.res-confidence {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: capitalize;
}
.res-confidence-high { color: #059669; }
.res-confidence-medium { color: #d97706; }
.res-confidence-low { color: #dc2626; }
.res-reasoning {
  margin: 0 0 1rem;
  color: #374151;
  line-height: 1.6;
}
.res-tiebreaker {
  font-size: 0.85rem;
  color: #2563eb;
  background: #eff6ff;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  display: inline-block;
  margin: 0 0 1rem;
}
.res-section h3,
.res-warnings h3 {
  font-size: 0.8rem;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 1rem 0 0.5rem;
}
.res-section ul,
.res-warnings ul {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.875rem;
  color: #374151;
  line-height: 1.6;
}
.res-warnings {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin-top: 1rem;
}
.res-warnings h3 { color: #92400e; margin-top: 0; }
.res-warnings li { color: #78350f; }

.res-multi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.75rem;
}
.res-multi-card {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 0.875rem;
}
.res-multi-card p {
  margin: 0.5rem 0;
  font-size: 0.85rem;
  color: #374151;
  line-height: 1.5;
}
.res-multi-card-head {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-wrap: wrap;
}
`;
