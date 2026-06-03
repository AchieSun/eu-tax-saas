/**
 * F6 CalendarView — orchestrator for the days-tracker page.
 *
 * Composition:
 *   ┌─ top bar:  ← prev / [YYYY-MM] / next →     today | counter | save | undo
 *   ├─ CountryPalette  (6 country chips + eraser)
 *   ├─ MonthGrid       (7×6 paintable cells)
 *   ├─ footer:  per-country day-count bars
 *   └─ legal disclaimer
 *
 * State model:
 *   serverDays      — last known truth from GET /api/days
 *   pendingChanges  — local edits not yet POSTed (Map<dateISO, Country | ERASE>)
 *   currentTool     — the chip the user picked in CountryPalette
 *
 * Render order: pendingChanges wins over serverDays. Saving merges
 * pendingChanges into serverDays + issues a bulk POST for paints and one
 * DELETE per erase.
 */

import {
  type Component,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import CountryPalette from './calendar/CountryPalette';
import MonthGrid, { type PaintMap } from './calendar/MonthGrid';
import { bulkSaveDays, deleteDay, fetchDays } from './calendar/api';
import {
  COUNTRIES,
  COUNTRY_META,
  type Country,
  ERASE,
  type PaintTool,
} from './calendar/types';

// ── Date helpers (local-timezone YYYY-MM-DD, no UTC drift) ───────────────────

function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function daysInMonth(d: Date): number {
  return endOfMonth(d).getDate();
}

const MONTH_LABELS_ZH = [
  '一月', '二月', '三月', '四月', '五月', '六月',
  '七月', '八月', '九月', '十月', '十一月', '十二月',
];

// ── Component ────────────────────────────────────────────────────────────────

const CalendarView: Component = () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const [monthAnchor, setMonthAnchor] = createSignal<Date>(startOfMonth(new Date()));
  const [currentTool, setCurrentTool] = createSignal<PaintTool>('DE' as Country);
  const [pendingChanges, setPendingChanges] = createSignal<PaintMap>(new Map());
  const [serverDays, setServerDays] = createSignal<Map<string, Country>>(new Map());
  const [savingState, setSavingState] = createSignal<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [refreshTick, setRefreshTick] = createSignal(0);

  // ── Data fetching: pull a generous window (current month ± 6 months) ──────
  const fetchWindow = createMemo(() => {
    // Re-key off refreshTick so we can manually trigger a re-fetch.
    void refreshTick();
    const anchor = monthAnchor();
    const from = fmtISO(addMonths(anchor, -6));
    const to = fmtISO(endOfMonth(addMonths(anchor, 6)));
    return { from, to };
  });

  const [daysResource] = createResource(fetchWindow, async (w) => {
    const rows = await fetchDays(w.from, w.to);
    const next = new Map<string, Country>();
    for (const r of rows) next.set(r.date, r.country);
    setServerDays(next);
    return rows;
  });

  // ── Paint handler ─────────────────────────────────────────────────────────
  function onPaint(date: string, tool: PaintTool) {
    if (tool === null) return;
    setPendingChanges((prev) => {
      const next = new Map(prev);
      const server = serverDays().get(date);

      if (tool === ERASE) {
        if (server === undefined) {
          // Nothing to erase on the server, and we may have just painted it
          // locally — drop the pending entry entirely.
          next.delete(date);
        } else {
          next.set(date, ERASE);
        }
      } else {
        if (server === tool) {
          // Painting the same color the server already has → no net change.
          next.delete(date);
        } else {
          next.set(date, tool);
        }
      }
      return next;
    });
  }

  // ── Save / undo ────────────────────────────────────────────────────────────
  async function onSave() {
    const changes = pendingChanges();
    if (changes.size === 0) return;
    setSavingState({ kind: 'saving' });

    const paints: { date: string; country: Country }[] = [];
    const erases: string[] = [];
    for (const [date, val] of changes) {
      if (val === ERASE) erases.push(date);
      else paints.push({ date, country: val });
    }

    try {
      if (paints.length > 0) {
        // Chunk into batches of 400 (server limit).
        for (let i = 0; i < paints.length; i += 400) {
          const slice = paints.slice(i, i + 400);
          await bulkSaveDays(slice.map((p) => ({ date: p.date, country: p.country })));
        }
      }
      for (const date of erases) {
        await deleteDay(date);
      }
      // Merge into serverDays optimistically; the next refetch will reconcile.
      setServerDays((prev) => {
        const next = new Map(prev);
        for (const p of paints) next.set(p.date, p.country);
        for (const d of erases) next.delete(d);
        return next;
      });
      setPendingChanges(new Map());
      setSavingState({ kind: 'idle' });
    } catch (err) {
      setSavingState({
        kind: 'error',
        message: err instanceof Error ? err.message : '保存失败',
      });
    }
  }

  function onUndo() {
    setPendingChanges(new Map());
    setSavingState({ kind: 'idle' });
  }

  function onRetry() {
    setRefreshTick((n) => n + 1);
  }

  // ── Stats: per-country counts (server + pending, scoped to current month) ─
  const monthCounts = createMemo<Record<Country, number>>(() => {
    const anchor = monthAnchor();
    const n = daysInMonth(anchor);
    const counts: Record<Country, number> = {
      DE: 0, NL: 0, PT: 0, ES: 0, UK: 0, OTHER: 0,
    };
    const pending = pendingChanges();
    const server = serverDays();
    for (let d = 1; d <= n; d++) {
      const date = fmtISO(new Date(anchor.getFullYear(), anchor.getMonth(), d));
      const pVal = pending.get(date);
      let resolved: Country | undefined;
      if (pVal === ERASE) resolved = undefined;
      else if (pVal !== undefined) resolved = pVal;
      else resolved = server.get(date);
      if (resolved) counts[resolved]++;
    }
    return counts;
  });

  const markedInMonth = createMemo(() => {
    const c = monthCounts();
    return c.DE + c.NL + c.PT + c.ES + c.UK + c.OTHER;
  });

  const totalDaysInMonth = createMemo(() => daysInMonth(monthAnchor()));

  const isUnauthorized = createMemo(() => {
    const err = daysResource.error as Error | undefined;
    return err?.message === 'UNAUTHORIZED';
  });

  const fetchErrorMsg = createMemo(() => {
    const err = daysResource.error as Error | undefined;
    if (!err) return null;
    if (err.message === 'UNAUTHORIZED') return null; // handled separately
    return err.message || '加载失败';
  });

  // Keyboard shortcut: Ctrl/Cmd+S to save.
  function onKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void onSave();
    }
  }
  window.addEventListener('keydown', onKeyDown);
  onCleanup(() => window.removeEventListener('keydown', onKeyDown));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div class="cal-root">
      <style>{styles}</style>

      <header class="cal-hero">
        <h1 class="cal-h1">居留日历 · 标记每日所在国家</h1>
        <p class="cal-sub">
          按下并拖动鼠标，把多个日期一次性标记为同一国家。本表是 F2 居留判定与
          183 天计算的<strong>唯一原始输入</strong>。
        </p>
      </header>

      {/* Top bar: month nav + counters + save controls */}
      <section class="cal-topbar">
        <div class="cal-nav">
          <button
            type="button"
            class="cal-btn cal-btn-ghost"
            onClick={() => setMonthAnchor((d) => addMonths(d, -1))}
            aria-label="上一月"
          >
            ← 上月
          </button>
          <span class="cal-month-label">
            {monthAnchor().getFullYear()} 年 {MONTH_LABELS_ZH[monthAnchor().getMonth()]}
          </span>
          <button
            type="button"
            class="cal-btn cal-btn-ghost"
            onClick={() => setMonthAnchor((d) => addMonths(d, 1))}
            aria-label="下一月"
          >
            下月 →
          </button>
          <button
            type="button"
            class="cal-btn cal-btn-outline cal-btn-today"
            onClick={() => setMonthAnchor(startOfMonth(new Date()))}
          >
            今天
          </button>
        </div>

        <div class="cal-meta">
          <span class="cal-counter">
            已标记 <strong>{markedInMonth()}</strong> 天 / 共 {totalDaysInMonth()} 天
          </span>
          <Show when={pendingChanges().size > 0}>
            <span class="cal-pending-badge" title="尚未保存的修改">
              ● 未保存 {pendingChanges().size} 项
            </span>
          </Show>
          <button
            type="button"
            class="cal-btn cal-btn-primary"
            disabled={pendingChanges().size === 0 || savingState().kind === 'saving'}
            onClick={() => void onSave()}
            title="保存修改 (Ctrl/Cmd+S)"
          >
            {savingState().kind === 'saving' ? '保存中…' : '保存'}
          </button>
          <button
            type="button"
            class="cal-btn cal-btn-ghost"
            disabled={pendingChanges().size === 0}
            onClick={onUndo}
          >
            撤销
          </button>
        </div>
      </section>

      {/* Palette */}
      <section class="cal-palette-row">
        <span class="cal-palette-label">画笔：</span>
        <CountryPalette current={currentTool()} onChange={setCurrentTool} />
      </section>

      {/* Save error banner */}
      <Show when={savingState().kind === 'error'}>
        <div class="cal-error" role="alert">
          <span>
            ⚠️ 保存失败：
            {savingState().kind === 'error'
              ? (savingState() as { kind: 'error'; message: string }).message
              : ''}
          </span>
          <button
            type="button"
            class="cal-btn cal-btn-ghost"
            onClick={() => void onSave()}
          >
            重试
          </button>
        </div>
      </Show>

      {/* Auth error */}
      <Show when={isUnauthorized()}>
        <div class="cal-error" role="alert">
          <span>⚠️ 请先登录后再使用居留日历。</span>
          <a class="cal-btn cal-btn-outline" href="/login">
            前往登录
          </a>
        </div>
      </Show>

      {/* Fetch error (non-auth) */}
      <Show when={fetchErrorMsg()}>
        {(msg) => (
          <div class="cal-error" role="alert">
            <span>⚠️ 加载失败：{msg()}</span>
            <button type="button" class="cal-btn cal-btn-ghost" onClick={onRetry}>
              重试
            </button>
          </div>
        )}
      </Show>

      {/* Skeleton while initial fetch is in flight */}
      <Show when={daysResource.loading && serverDays().size === 0}>
        <div class="cal-grid-wrap" aria-busy="true" aria-label="加载中">
          <div class="cal-grid-head" aria-hidden="true">
            <For each={['一', '二', '三', '四', '五', '六', '日']}>
              {(w) => <div class="cal-grid-head-cell">{w}</div>}
            </For>
          </div>
          <div class="cal-grid">
            <For each={Array.from({ length: 42 })}>
              {() => <div class="cal-cell cal-cell-skel" />}
            </For>
          </div>
        </div>
      </Show>

      {/* Real grid */}
      <Show when={!daysResource.loading || serverDays().size > 0}>
        <Show when={!isUnauthorized()}>
          <MonthGrid
            monthAnchor={monthAnchor()}
            serverDays={serverDays()}
            pendingChanges={pendingChanges()}
            currentTool={currentTool()}
            onPaint={onPaint}
          />
        </Show>
      </Show>

      {/* Footer: per-country counts */}
      <Show when={!isUnauthorized()}>
        <section class="cal-stats" aria-label="本月各国天数统计">
          <For each={COUNTRIES}>
            {(c) => {
              const meta = COUNTRY_META[c];
              const count = () => monthCounts()[c];
              const pctOfMonth = () => {
                const t = totalDaysInMonth();
                return t > 0 ? Math.round((count() / t) * 100) : 0;
              };
              return (
                <div class="cal-stat">
                  <div class="cal-stat-head">
                    <span class="cal-stat-dot" style={{ 'background-color': meta.bg }} />
                    <span class="cal-stat-label">{meta.label}</span>
                    <span class="cal-stat-count">{count()} 天</span>
                  </div>
                  <div class="cal-stat-bar">
                    <div
                      class="cal-stat-bar-fill"
                      style={{
                        width: `${pctOfMonth()}%`,
                        'background-color': meta.bg,
                      }}
                    />
                  </div>
                </div>
              );
            }}
          </For>
        </section>
      </Show>

      <Show when={!isUnauthorized() && markedInMonth() === 0 && pendingChanges().size === 0 && !daysResource.loading}>
        <p class="cal-empty">尚未标记任何日 —— 点选上方画笔，拖动日期格开始。</p>
      </Show>

      <p class="cal-legal">
        ⚠️ 此日历用于辅助估算居留天数，<strong>不构成正式税务记录</strong>。
        最终申报请以护照入境章、机票登机牌、出行账单为准。各国税务机关可能要求实物证据。
      </p>
    </div>
  );
};

export default CalendarView;

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = `
.cal-root { color: #111827; }

.cal-hero { margin: 0 0 1.5rem; }
.cal-h1 {
  font-size: clamp(1.5rem, 3vw, 2rem);
  line-height: 1.2;
  margin: 0 0 0.5rem;
  color: #111827;
  letter-spacing: -0.02em;
}
.cal-sub {
  margin: 0;
  color: #6b7280;
  font-size: 0.95rem;
  max-width: 70ch;
  line-height: 1.5;
}
.cal-sub strong { color: #111827; }

.cal-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 0.875rem 1.125rem;
  margin-bottom: 0.875rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.cal-nav { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.cal-month-label {
  font-size: 1.125rem;
  font-weight: 700;
  color: #111827;
  padding: 0 0.625rem;
  min-width: 8rem;
  text-align: center;
  letter-spacing: -0.01em;
}
.cal-meta {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex-wrap: wrap;
}
.cal-counter { font-size: 0.875rem; color: #374151; }
.cal-counter strong { color: #111827; font-weight: 700; }
.cal-pending-badge {
  background: #fff7ed;
  color: #c2410c;
  border: 1px solid #fed7aa;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
}

.cal-btn {
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  min-height: 36px;
  padding: 0 0.875rem;
  border: 1.5px solid transparent;
  transition: background-color 150ms, color 150ms, border-color 150ms, transform 150ms;
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}
.cal-btn:disabled { cursor: not-allowed; opacity: 0.45; }
.cal-btn-primary { background: #2563eb; color: #ffffff; }
.cal-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.cal-btn-primary:active:not(:disabled) { transform: translateY(1px); }
.cal-btn-outline { background: #ffffff; color: #2563eb; border-color: #2563eb; }
.cal-btn-outline:hover:not(:disabled) { background: #eff6ff; }
.cal-btn-ghost { background: transparent; color: #374151; border-color: #e5e7eb; }
.cal-btn-ghost:hover:not(:disabled) { background: #f3f4f6; }
.cal-btn-today { margin-left: 0.5rem; }

.cal-palette-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.cal-palette-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.cal-palette {
  display: flex;
  gap: 0.375rem;
  flex-wrap: wrap;
}
.cal-chip {
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.375rem 0.75rem;
  border-radius: 999px;
  border: 2px solid transparent;
  cursor: pointer;
  min-height: 32px;
  transition: transform 150ms, box-shadow 150ms, outline 150ms;
  letter-spacing: 0.01em;
}
.cal-chip:hover { transform: translateY(-1px); box-shadow: 0 2px 6px rgba(0,0,0,0.12); }
.cal-chip-active {
  outline: 3px solid #2563eb;
  outline-offset: 2px;
  box-shadow: 0 2px 8px rgba(37,99,235,0.25);
}
.cal-chip-erase {
  background: #ffffff !important;
  color: #b91c1c !important;
  border-color: #fca5a5;
}

.cal-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  margin-bottom: 0.875rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.cal-grid-wrap {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 0.75rem;
  margin-bottom: 1rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  touch-action: none; /* prevent scroll from hijacking the drag stroke */
  -webkit-user-select: none;
  user-select: none;
}
.cal-grid-head {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  margin-bottom: 4px;
}
.cal-grid-head-cell {
  text-align: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.375rem 0;
}
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-auto-rows: minmax(56px, 1fr);
  gap: 4px;
}
.cal-cell {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 0.375rem 0.5rem;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  position: relative;
  transition: transform 100ms, box-shadow 100ms;
  min-height: 56px;
  background-clip: padding-box;
}
.cal-cell:hover { transform: scale(1.03); box-shadow: 0 2px 8px rgba(0,0,0,0.12); z-index: 1; }
.cal-cell-num { line-height: 1; }
.cal-cell-out { opacity: 0.32; }
.cal-cell-today {
  box-shadow: inset 0 0 0 2px #2563eb;
}
.cal-cell-pending::after {
  content: '';
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #f97316;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.6);
}
.cal-cell-skel {
  background: linear-gradient(90deg, #f3f4f6 0%, #e5e7eb 50%, #f3f4f6 100%);
  background-size: 200% 100%;
  animation: cal-shimmer 1.4s infinite;
  border-color: transparent;
}
@keyframes cal-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.cal-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.625rem;
  margin-bottom: 1rem;
}
.cal-stat {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 0.625rem 0.75rem;
}
.cal-stat-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.375rem;
  font-size: 0.8125rem;
}
.cal-stat-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 999px;
}
.cal-stat-label { color: #374151; font-weight: 600; flex: 1; }
.cal-stat-count { color: #111827; font-weight: 700; font-variant-numeric: tabular-nums; }
.cal-stat-bar {
  height: 6px;
  background: #f3f4f6;
  border-radius: 999px;
  overflow: hidden;
}
.cal-stat-bar-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 200ms ease-out;
  min-width: 0;
}

.cal-empty {
  text-align: center;
  padding: 1rem;
  color: #6b7280;
  background: #f9fafb;
  border: 1px dashed #e5e7eb;
  border-radius: 8px;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.cal-legal {
  margin: 1rem 0 0;
  padding: 0.625rem 0;
  border-top: 1px solid #e5e7eb;
  font-size: 0.75rem;
  color: #6b7280;
  font-style: italic;
  line-height: 1.5;
}
.cal-legal strong { color: #374151; font-style: normal; }
`;
