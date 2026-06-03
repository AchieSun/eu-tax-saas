/**
 * SolidStart frontend entry point.
 *
 * W3: adds a tab switcher between the 5-country compare (W2) and the new
 * F6 residency calendar (W3 T3). Tab state lives in a local signal — no
 * router is necessary for two top-level views.
 */

import { type Component, createResource, createSignal, Show } from 'solid-js';
import CompareView from './CompareView';
import CalendarView from './CalendarView';

interface HealthResponse {
  status: string;
  env: string;
  timestamp: number;
  version: string;
}

async function fetchHealth(): Promise<HealthResponse> {
  const r = await fetch('/api/health');
  return r.json() as Promise<HealthResponse>;
}

type Tab = 'compare' | 'calendar';

const App: Component = () => {
  const [health] = createResource(fetchHealth);
  const [tab, setTab] = createSignal<Tab>('compare');

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      class="app-tab"
      classList={{ 'app-tab-active': tab() === id }}
      onClick={() => setTab(id)}
      aria-pressed={tab() === id}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        'font-family': 'system-ui, -apple-system, sans-serif',
        padding: '2rem 1.5rem',
        'max-width': '1200px',
        margin: '0 auto',
        color: '#111827',
      }}
    >
      <style>{appStyles}</style>

      {/* Health pill (top-right) */}
      <div
        style={{
          display: 'flex',
          'justify-content': 'flex-end',
          'margin-bottom': '0.75rem',
        }}
      >
        <Show
          when={health()}
          fallback={
            <span
              style={{
                'font-size': '0.75rem',
                color: '#6b7280',
                background: '#f3f4f6',
                padding: '0.25rem 0.625rem',
                'border-radius': '999px',
                border: '1px solid #e5e7eb',
              }}
            >
              ● API: connecting…
            </span>
          }
        >
          {(h) => (
            <span
              title={`v${h().version} · ${new Date(h().timestamp).toLocaleString()}`}
              style={{
                'font-size': '0.75rem',
                color: '#059669',
                background: '#ecfdf5',
                padding: '0.25rem 0.625rem',
                'border-radius': '999px',
                border: '1px solid #a7f3d0',
                'font-weight': 600,
              }}
            >
              ● API {h().status} · {h().env}
            </span>
          )}
        </Show>
      </div>

      {/* Top-level tab bar */}
      <nav class="app-tabs" aria-label="主导航">
        {tabBtn('compare', '5 国对比')}
        {tabBtn('calendar', '居留日历')}
      </nav>

      {/* Active view */}
      <Show when={tab() === 'compare'}>
        <CompareView />
      </Show>
      <Show when={tab() === 'calendar'}>
        <CalendarView />
      </Show>

      {/* Implementation status — collapsed by default */}
      <details
        style={{
          'margin-top': '3rem',
          background: '#f9fafb',
          border: '1px solid #e5e7eb',
          'border-radius': '12px',
          padding: '1rem 1.25rem',
        }}
      >
        <summary
          style={{
            cursor: 'pointer',
            'font-weight': 600,
            color: '#111827',
            'font-size': '0.95rem',
          }}
        >
          Implementation status (W1–W7)
        </summary>
        <table
          style={{
            width: '100%',
            'border-collapse': 'collapse',
            'margin-top': '1rem',
            'font-size': '0.875rem',
          }}
        >
          <thead>
            <tr style={{ 'text-align': 'left', color: '#6b7280' }}>
              <th style={{ padding: '0.5rem 0' }}>Feature</th>
              <th style={{ padding: '0.5rem 0' }}>Status</th>
              <th style={{ padding: '0.5rem 0' }}>Source</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '0.375rem 0' }}>F1 DE calculator (§32a EStG 2025/2026)</td>
              <td>✅ Ready</td>
              <td>BMF</td>
            </tr>
            <tr>
              <td style={{ padding: '0.375rem 0' }}>F1 NL Box 1/2/3 (2025/2026)</td>
              <td>✅ Ready</td>
              <td>Belastingdienst</td>
            </tr>
            <tr>
              <td style={{ padding: '0.375rem 0' }}>F1 PT IRS 2025 (+ IFICI)</td>
              <td>✅ Ready</td>
              <td>AT/PwC</td>
            </tr>
            <tr>
              <td style={{ padding: '0.375rem 0' }}>F1 PT IRS 2026 (Lei 73-A/2025)</td>
              <td>⚠️ Provisional</td>
              <td>AT (folheto Q1 2026)</td>
            </tr>
            <tr>
              <td style={{ padding: '0.375rem 0' }}>F1 ES IRPF + Beckham</td>
              <td>✅ Ready</td>
              <td>AEAT</td>
            </tr>
            <tr>
              <td style={{ padding: '0.375rem 0' }}>F1 UK Income Tax + FIG + SRT</td>
              <td>✅ Ready</td>
              <td>HMRC</td>
            </tr>
            <tr>
              <td style={{ padding: '0.375rem 0' }}>F2 residency</td>
              <td>⏳ W2</td>
              <td>—</td>
            </tr>
            <tr>
              <td style={{ padding: '0.375rem 0' }}>F6 days tracker</td>
              <td>✅ W3 (calendar UI live)</td>
              <td>—</td>
            </tr>
            <tr>
              <td style={{ padding: '0.375rem 0' }}>F3 field guide</td>
              <td>⏳ W4</td>
              <td>—</td>
            </tr>
            <tr>
              <td style={{ padding: '0.375rem 0' }}>F4 strategy + harness</td>
              <td>⏳ W5-W6 (prompts ready)</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  );
};

export default App;

const appStyles = `
.app-tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid #e5e7eb;
  margin: 0 0 1.5rem;
  padding: 0;
}
.app-tab {
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  background: transparent;
  border: none;
  border-bottom: 3px solid transparent;
  padding: 0.625rem 1rem;
  color: #6b7280;
  cursor: pointer;
  transition: color 150ms, border-color 150ms;
  margin-bottom: -1px;
}
.app-tab:hover { color: #111827; }
.app-tab-active {
  color: #2563eb;
  border-bottom-color: #2563eb;
}
`;
