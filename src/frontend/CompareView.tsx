/**
 * CompareView — side-by-side 5-country tax comparison (W2).
 *
 * Posts to /api/calculate/compare and renders ranked country cards
 * (cheapest first) with a sliding "Why?" side panel that shows the
 * full breakdown + source citation.
 *
 * SolidJS only. No external CSS framework. No new deps.
 */

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from 'solid-js';
import type { Country } from '../rules/common/types';

// ───────────────────────── types ─────────────────────────

interface CompareResultRow {
  country: Country;
  totalTax?: number;
  taxOwed?: number;
  effectiveRate: number;
  marginalRate: number;
  source: string;
  breakdown: unknown;
  provisional?: boolean;
  warnings?: string[];
  netIncome?: number;
  grossIncome?: number;
}

interface CompareResponseOk {
  ok: true;
  results: CompareResultRow[];
}
interface CompareResponseErr {
  ok: false;
  error: string;
  issues?: unknown;
}
type CompareResponse = CompareResponseOk | CompareResponseErr;

interface FetchKey {
  trigger: number;
  income: number;
}

const COUNTRY_META: Record<Country, { flag: string; label: string }> = {
  DE: { flag: '🇩🇪', label: 'Germany' },
  NL: { flag: '🇳🇱', label: 'Netherlands' },
  PT: { flag: '🇵🇹', label: 'Portugal' },
  ES: { flag: '🇪🇸', label: 'Spain (Madrid)' },
  UK: { flag: '🇬🇧', label: 'United Kingdom (E/W/NI)' },
};

// ───────────────────────── helpers ─────────────────────────

function pickTax(r: CompareResultRow): number {
  return r.totalTax ?? r.taxOwed ?? 0;
}

const eur = new Intl.NumberFormat('en-EU', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// ───────────────────────── component ─────────────────────────

const CompareView: Component = () => {
  const [income, setIncome] = createSignal<number>(60000);
  const [trigger, setTrigger] = createSignal<number>(0);
  const [selected, setSelected] = createSignal<Country | null>(null);
  // Track the button that opened the panel so we can restore focus on close.
  let lastOpenerEl: HTMLButtonElement | null = null;
  let closeBtnEl: HTMLButtonElement | undefined;

  const incomeValid = createMemo(() => {
    const v = income();
    return Number.isFinite(v) && v >= 0 && v <= 100_000_000;
  });

  const fetchKey = createMemo<FetchKey>(() => ({
    trigger: trigger(),
    income: income(),
  }));

  const fetcher = async (key: FetchKey): Promise<CompareResponse | null> => {
    if (key.trigger === 0) return null;
    const res = await fetch('/api/calculate/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taxYear: 2025,
        incomeType: 'salary',
        grossIncome: key.income,
        filingStatus: 'single',
        specialStatus: 'none',
      }),
    });
    const json = (await res.json()) as CompareResponse;
    return json;
  };

  const [data] = createResource<CompareResponse | null, FetchKey>(fetchKey, fetcher);

  const onCompare = () => {
    if (!incomeValid()) return;
    setTrigger((n) => n + 1);
  };

  const onOpenPanel = (country: Country, ev: MouseEvent) => {
    lastOpenerEl = ev.currentTarget as HTMLButtonElement;
    setSelected(country);
  };

  const closePanel = () => {
    setSelected(null);
    // Restore focus after the panel unmounts.
    queueMicrotask(() => {
      lastOpenerEl?.focus();
      lastOpenerEl = null;
    });
  };

  // ESC closes panel + focus close button on open.
  createEffect(() => {
    if (selected() === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    window.addEventListener('keydown', handler);
    queueMicrotask(() => closeBtnEl?.focus());
    onCleanup(() => window.removeEventListener('keydown', handler));
  });

  const sortedResults = createMemo<CompareResultRow[]>(() => {
    const d = data();
    if (!d || !d.ok) return [];
    return [...d.results].sort((a, b) => pickTax(a) - pickTax(b));
  });

  const cheapestCountry = createMemo<Country | null>(() => {
    const arr = sortedResults();
    return arr.length > 0 ? arr[0]?.country : null;
  });

  const selectedRow = createMemo<CompareResultRow | null>(() => {
    const c = selected();
    if (!c) return null;
    return sortedResults().find((r) => r.country === c) ?? null;
  });

  const errorMessage = createMemo<string | null>(() => {
    const err = data.error as Error | undefined;
    if (err) return err.message || 'Network error';
    const d = data();
    if (d && d.ok === false) return d.error || 'Calculation failed';
    return null;
  });

  return (
    <div>
      <style>{styles}</style>

      {/* Hero */}
      <header class="cv-hero">
        <h1 class="cv-h1">Compare your tax across 5 European countries</h1>
        <p class="cv-sub">
          Side-by-side IRPF / IRS / EStG / Box 1 / Income Tax using official 2025 rates from AEAT,
          AT, BMF, Belastingdienst and HMRC. Salary, single filer, no special regime.
        </p>
        <p class="cv-disclaimer" role="note">
          ⚖️ <strong>Estimate only — not tax advice.</strong> Figures are informational and may be
          inaccurate for your situation. Always confirm with a qualified tax advisor before filing.
          We don't store this calculation.
        </p>
      </header>

      {/* Income input */}
      <section class="cv-input-card">
        <label class="cv-label" for="cv-income">
          Annual gross income (€)
        </label>
        <div class="cv-input-row">
          <input
            id="cv-income"
            class="cv-income-input"
            type="number"
            inputmode="numeric"
            min={0}
            step={1000}
            value={income()}
            onInput={(e) => {
              const n = Number((e.currentTarget as HTMLInputElement).value);
              setIncome(Number.isFinite(n) ? n : 0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCompare();
            }}
            aria-invalid={!incomeValid()}
            aria-describedby="cv-income-help"
          />
          <button
            type="button"
            class="cv-btn cv-btn-primary"
            onClick={onCompare}
            disabled={!incomeValid() || data.loading}
            aria-label="Compare tax across all 5 countries"
          >
            {data.loading ? 'Calculating…' : 'Compare countries'}
          </button>
        </div>
        <p id="cv-income-help" class="cv-help">
          Enter a positive whole number. Default €60,000.
        </p>
      </section>

      {/* Error */}
      <Show when={errorMessage()}>
        {(msg) => (
          <div class="cv-error" role="alert">
            <span>⚠️ {msg()}</span>
            <button
              type="button"
              class="cv-btn cv-btn-ghost"
              onClick={onCompare}
              aria-label="Retry comparison"
            >
              Retry
            </button>
          </div>
        )}
      </Show>

      {/* Loading skeletons */}
      <Show when={data.loading}>
        <div class="cv-grid" aria-busy="true" aria-label="Loading results">
          <For each={[0, 1, 2, 3, 4]}>
            {() => (
              <div class="cv-card cv-card-skel">
                <div class="cv-skel cv-skel-head" />
                <div class="cv-skel cv-skel-big" />
                <div class="cv-skel cv-skel-row" />
                <div class="cv-skel cv-skel-row" />
                <div class="cv-skel cv-skel-btn" />
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!data.loading && !errorMessage() && trigger() === 0}>
        <div class="cv-empty">
          <span class="cv-empty-emoji">📊</span>
          <p>Enter your income above to compare 5 European tax regimes side-by-side.</p>
        </div>
      </Show>

      {/* Results */}
      <Show when={!data.loading && !errorMessage() && sortedResults().length > 0}>
        <section
          class="cv-grid"
          aria-label={`Tax comparison for ${eur.format(income())} gross income`}
        >
          <For each={sortedResults()}>
            {(r) => {
              const meta = COUNTRY_META[r.country];
              const tax = pickTax(r);
              const isCheapest = r.country === cheapestCountry();
              return (
                <article
                  class={`cv-card ${isCheapest ? 'cv-card-best' : ''}`}
                  aria-label={`${meta.label} tax result`}
                >
                  <Show when={isCheapest}>
                    <span class="cv-badge">Lowest tax</span>
                  </Show>
                  <header class="cv-card-head">
                    <span class="cv-flag" aria-hidden="true">
                      {meta.flag}
                    </span>
                    <span class="cv-country">{meta.label}</span>
                  </header>
                  <div class="cv-total" title="Total tax owed">
                    {eur.format(tax)}
                  </div>
                  <div class="cv-net">Net: {eur.format(income() - tax)}</div>
                  <dl class="cv-stats">
                    <div>
                      <dt>Effective</dt>
                      <dd>{pct(r.effectiveRate)}</dd>
                    </div>
                    <div>
                      <dt>Marginal</dt>
                      <dd>{pct(r.marginalRate)}</dd>
                    </div>
                  </dl>
                  <Show when={r.provisional}>
                    <p class="cv-prov" title="Provisional figures pending official publication">
                      ⚠️ Provisional
                    </p>
                  </Show>
                  <button
                    type="button"
                    class="cv-btn cv-btn-outline cv-why"
                    onClick={(e) => onOpenPanel(r.country, e)}
                    aria-label={`Show why for ${meta.label}`}
                    aria-haspopup="dialog"
                  >
                    Why?
                  </button>
                </article>
              );
            }}
          </For>
        </section>
      </Show>

      {/* Side panel */}
      <Show when={selectedRow()}>
        {(row) => {
          const meta = COUNTRY_META[row().country];
          return (
            <>
              <div class="cv-backdrop" onClick={closePanel} aria-hidden="true" />
              <aside
                class="cv-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="cv-panel-title"
              >
                <header class="cv-panel-head">
                  <h2 id="cv-panel-title" class="cv-panel-title">
                    <span aria-hidden="true">{meta.flag}</span> {meta.label}
                  </h2>
                  <button
                    type="button"
                    class="cv-close"
                    ref={closeBtnEl}
                    onClick={closePanel}
                    aria-label="Close details panel"
                  >
                    ×
                  </button>
                </header>
                <div class="cv-panel-body">
                  <div class="cv-panel-stat">
                    <span class="cv-panel-stat-label">Total tax</span>
                    <span class="cv-panel-stat-val">{eur.format(pickTax(row()))}</span>
                  </div>
                  <div class="cv-panel-stat-row">
                    <div>
                      <span class="cv-panel-stat-label">Effective</span>
                      <span class="cv-panel-stat-sub">{pct(row().effectiveRate)}</span>
                    </div>
                    <div>
                      <span class="cv-panel-stat-label">Marginal</span>
                      <span class="cv-panel-stat-sub">{pct(row().marginalRate)}</span>
                    </div>
                  </div>

                  <h3 class="cv-panel-h3">Source</h3>
                  <p class="cv-source">{row().source}</p>

                  <Show when={(row().warnings?.length ?? 0) > 0}>
                    <h3 class="cv-panel-h3">Warnings</h3>
                    <ul class="cv-warnings">
                      <For each={row().warnings}>{(w) => <li>{w}</li>}</For>
                    </ul>
                  </Show>

                  <h3 class="cv-panel-h3">Breakdown</h3>
                  <pre class="cv-breakdown">{JSON.stringify(row().breakdown, null, 2)}</pre>
                </div>
              </aside>
            </>
          );
        }}
      </Show>
    </div>
  );
};

export default CompareView;

// ───────────────────────── styles ─────────────────────────

const styles = `
.cv-hero { margin: 0 0 2rem; }
.cv-h1 {
  font-size: clamp(1.75rem, 3.5vw, 2.5rem);
  line-height: 1.15;
  margin: 0 0 0.5rem;
  color: #111827;
  letter-spacing: -0.02em;
}
.cv-sub {
  margin: 0;
  color: #6b7280;
  font-size: 0.95rem;
  max-width: 60ch;
  line-height: 1.5;
}

.cv-disclaimer {
  margin: 0.75rem 0 0;
  padding: 0.625rem 0.875rem;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  color: #78350f;
  font-size: 0.825rem;
  line-height: 1.45;
  max-width: 65ch;
}
.cv-disclaimer strong { color: #78350f; }

.cv-input-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.cv-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  color: #111827;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.cv-input-row {
  display: flex;
  gap: 0.75rem;
  align-items: stretch;
  flex-wrap: wrap;
}
.cv-income-input {
  flex: 1 1 240px;
  font-size: 2rem;
  font-weight: 600;
  padding: 0.5rem 0.75rem;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  color: #111827;
  background: #ffffff;
  font-family: inherit;
  transition: border-color 200ms, box-shadow 200ms;
  min-height: 56px;
}
.cv-income-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}
.cv-income-input[aria-invalid="true"] {
  border-color: #dc2626;
}
.cv-help {
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;
  color: #6b7280;
}

.cv-btn {
  font-family: inherit;
  font-size: 1rem;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  min-height: 44px;
  padding: 0 1.25rem;
  transition: background-color 200ms, color 200ms, border-color 200ms, transform 200ms;
  border: 2px solid transparent;
}
.cv-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.cv-btn-primary {
  background: #2563eb;
  color: #ffffff;
  flex: 0 0 auto;
}
.cv-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.cv-btn-primary:active:not(:disabled) { transform: translateY(1px); }
.cv-btn-outline {
  background: #ffffff;
  color: #2563eb;
  border-color: #2563eb;
}
.cv-btn-outline:hover:not(:disabled) { background: #eff6ff; }
.cv-btn-ghost {
  background: transparent;
  color: #dc2626;
  border-color: #dc2626;
  padding: 0 0.875rem;
  min-height: 36px;
  font-size: 0.875rem;
}
.cv-btn-ghost:hover:not(:disabled) { background: #fef2f2; }

.cv-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  margin-bottom: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.cv-empty {
  text-align: center;
  padding: 3rem 1rem;
  color: #6b7280;
  background: #f9fafb;
  border: 1px dashed #e5e7eb;
  border-radius: 12px;
}
.cv-empty-emoji {
  font-size: 2.5rem;
  display: block;
  margin-bottom: 0.5rem;
}
.cv-empty p { margin: 0; font-size: 1rem; }

.cv-grid {
  display: flex;
  flex-direction: row;
  gap: 1rem;
  flex-wrap: nowrap;
}
@media (max-width: 900px) {
  .cv-grid { flex-wrap: wrap; }
  .cv-card { flex: 1 1 calc(50% - 0.5rem); min-width: 240px; }
}
@media (max-width: 768px) {
  .cv-grid { flex-direction: column; }
  .cv-card { flex: 1 1 100%; }
}

.cv-card {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  transition: transform 200ms, box-shadow 200ms;
}
.cv-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
.cv-card-best {
  border: 2px solid #059669;
  box-shadow: 0 4px 14px rgba(5, 150, 105, 0.15);
}
.cv-badge {
  position: absolute;
  top: -10px;
  left: 1rem;
  background: #059669;
  color: #ffffff;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.cv-card-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 0.95rem;
  color: #111827;
}
.cv-flag { font-size: 1.5rem; line-height: 1; }
.cv-country { color: #111827; }

.cv-total {
  font-size: 1.75rem;
  font-weight: 700;
  color: #111827;
  letter-spacing: -0.02em;
  margin-top: 0.25rem;
}
.cv-net {
  font-size: 0.875rem;
  color: #059669;
  font-weight: 500;
  margin-top: -0.25rem;
}

.cv-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin: 0.5rem 0 0;
}
.cv-stats > div { display: flex; flex-direction: column; gap: 0.125rem; }
.cv-stats dt {
  font-size: 0.75rem;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}
.cv-stats dd {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #111827;
}

.cv-prov {
  font-size: 0.75rem;
  color: #d97706;
  background: #fef3c7;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  margin: 0;
  font-weight: 600;
}

.cv-why {
  margin-top: auto;
  align-self: flex-start;
  padding: 0 0.875rem;
  min-height: 44px;
  font-size: 0.875rem;
}

/* Skeleton */
.cv-card-skel { pointer-events: none; }
.cv-skel {
  background: linear-gradient(90deg, #f3f4f6 0%, #e5e7eb 50%, #f3f4f6 100%);
  background-size: 200% 100%;
  animation: cv-shimmer 1.4s infinite;
  border-radius: 6px;
}
.cv-skel-head { height: 24px; width: 60%; }
.cv-skel-big { height: 40px; width: 80%; }
.cv-skel-row { height: 14px; width: 100%; }
.cv-skel-btn { height: 44px; width: 80px; margin-top: auto; }
@keyframes cv-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Side panel */
.cv-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.4);
  z-index: 40;
  animation: cv-fade 200ms ease-out;
}
.cv-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(480px, 100vw);
  background: #ffffff;
  z-index: 50;
  box-shadow: -8px 0 24px rgba(0,0,0,0.12);
  display: flex;
  flex-direction: column;
  animation: cv-slide-in 200ms ease-out;
}
@media (max-width: 640px) {
  .cv-panel { width: 100vw; }
}
@keyframes cv-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes cv-slide-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
.cv-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.25rem 0.75rem;
  border-bottom: 1px solid #e5e7eb;
}
.cv-panel-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: #111827;
  margin: 0;
}
.cv-close {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  color: #111827;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  transition: background-color 200ms, border-color 200ms;
}
.cv-close:hover { background: #f3f4f6; border-color: #d1d5db; }
.cv-close:focus { outline: 2px solid #2563eb; outline-offset: 2px; }
.cv-panel-body {
  padding: 1.25rem;
  overflow-y: auto;
  flex: 1;
}
.cv-panel-stat {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 1rem;
}
.cv-panel-stat-val {
  font-size: 2rem;
  font-weight: 700;
  color: #111827;
  letter-spacing: -0.02em;
}
.cv-panel-stat-row {
  display: flex;
  gap: 2rem;
  margin-bottom: 1.5rem;
}
.cv-panel-stat-row > div { display: flex; flex-direction: column; gap: 0.125rem; }
.cv-panel-stat-label {
  font-size: 0.75rem;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}
.cv-panel-stat-sub { font-size: 1.125rem; font-weight: 600; color: #111827; }
.cv-panel-h3 {
  font-size: 0.875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
  margin: 1.25rem 0 0.5rem;
}
.cv-source {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-left: 3px solid #2563eb;
  padding: 0.625rem 0.875rem;
  border-radius: 6px;
  font-size: 0.875rem;
  color: #111827;
  white-space: pre-wrap;
  margin: 0;
}
.cv-warnings {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.875rem;
  color: #d97706;
}
.cv-breakdown {
  background: #111827;
  color: #e5e7eb;
  padding: 0.875rem;
  border-radius: 8px;
  font-size: 0.75rem;
  line-height: 1.5;
  overflow-x: auto;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
`;
