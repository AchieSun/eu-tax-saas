/**
 * F6 MonthGrid — one calendar month with drag-paint multi-select.
 *
 * Renders a 7×6 grid (Monday-first, European convention). Out-of-month
 * padding cells from the previous/next month are still paintable so a
 * cross-month drag stroke is seamless.
 *
 * Drag-paint algorithm (pointer events, not mouse events — pointer is the
 * unified touch+mouse abstraction):
 *
 *   1. pointerdown  → capture pointer on the cell, record current tool,
 *                     apply paint to that date.
 *   2. pointermove  → use elementFromPoint to find the cell under the cursor
 *                     even when capture is bound to a different element;
 *                     throttle with requestAnimationFrame to stay 60fps.
 *   3. pointerup    → release; the orchestrator decides when to actually
 *                     POST the batched changes.
 *
 * We deliberately do NOT call setSignal on every raw pointermove event —
 * a single fast drag can fire 200+ events/sec and would otherwise re-render
 * the whole 42-cell grid each tick.
 */

import { type Component, createMemo, For, onCleanup, onMount } from 'solid-js';
import {
  type Country,
  COUNTRY_META,
  ERASE,
  type Erase,
  type PaintTool,
} from './types';

/** Map from YYYY-MM-DD → paint value (Country or ERASE sentinel). */
export type PaintMap = Map<string, Country | Erase>;

interface Props {
  /** First day of the month being shown (any day in the month works). */
  monthAnchor: Date;
  /** Server-resolved day → country map (immutable from this component's POV). */
  serverDays: Map<string, Country>;
  /** Local unsaved edits — wins over serverDays during render. */
  pendingChanges: PaintMap;
  /** Currently selected palette tool. */
  currentTool: PaintTool;
  /** Called when the user paints a cell (during drag or single click). */
  onPaint: (date: string, tool: PaintTool) => void;
}

// ── Date helpers (kept inline so we don't depend on date-fns) ────────────────

/** YYYY-MM-DD in the user's local timezone (NOT UTC — calendars are local). */
function fmtISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** First Monday on or before the first day of the given month. */
function startOfGrid(monthAnchor: Date): Date {
  const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
  // getDay(): Sun=0, Mon=1, …, Sat=6. We want Monday as column 0.
  const dow = (first.getDay() + 6) % 7; // 0 = Mon … 6 = Sun
  const start = new Date(first);
  start.setDate(first.getDate() - dow);
  return start;
}

/** Build the 42 (7×6) Date objects for the grid. */
function buildGrid(monthAnchor: Date): Date[] {
  const start = startOfGrid(monthAnchor);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

// ── Component ────────────────────────────────────────────────────────────────

const MonthGrid: Component<Props> = (props) => {
  const cells = createMemo(() => buildGrid(props.monthAnchor));
  const month = createMemo(() => props.monthAnchor.getMonth());

  // Stroke state lives in plain closure vars (not signals) — these are
  // imperative-event scratch data, not render inputs.
  let isPainting = false;
  let strokeTool: PaintTool = null;
  let rafPending = false;
  let lastClientX = 0;
  let lastClientY = 0;
  let gridEl: HTMLDivElement | undefined;

  /** Resolve the date string under (clientX, clientY) via elementFromPoint. */
  function dateAtPoint(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cell = (el as Element).closest('[data-date]') as HTMLElement | null;
    return cell?.dataset.date ?? null;
  }

  function handlePointerDown(e: PointerEvent) {
    // Only react to primary button on mouse; touch/pen always pass.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    const cell = target?.closest('[data-date]') as HTMLElement | null;
    if (!cell?.dataset.date) return;

    // Block iOS long-press menu + native text selection during a stroke.
    e.preventDefault();

    isPainting = true;
    strokeTool = props.currentTool;

    // Capture so we keep getting move events even if the pointer leaves the cell.
    try {
      cell.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture can throw if the element is detached — non-fatal. */
    }

    props.onPaint(cell.dataset.date, strokeTool);
  }

  function flushMove() {
    rafPending = false;
    if (!isPainting) return;
    const date = dateAtPoint(lastClientX, lastClientY);
    if (date) props.onPaint(date, strokeTool);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isPainting) return;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(flushMove);
  }

  function endStroke() {
    if (!isPainting) return;
    isPainting = false;
    strokeTool = null;
  }

  // Window-level safety net: if the user releases the pointer outside the
  // grid (or the browser cancels the gesture), we still need to end the stroke.
  onMount(() => {
    window.addEventListener('pointerup', endStroke);
    window.addEventListener('pointercancel', endStroke);
    onCleanup(() => {
      window.removeEventListener('pointerup', endStroke);
      window.removeEventListener('pointercancel', endStroke);
    });
  });

  /** Compute the displayed color for a date (pending wins over server). */
  function colorFor(date: string): { bg: string; fg: string; border?: string } {
    const pending = props.pendingChanges.get(date);
    if (pending === ERASE) {
      return { bg: '#ffffff', fg: '#334155', border: '#fca5a5' }; // red-ish dashed → erase preview
    }
    const value = pending ?? props.serverDays.get(date);
    if (value) {
      const meta = COUNTRY_META[value];
      return { bg: meta.bg, fg: meta.fg };
    }
    return { bg: '#ffffff', fg: '#334155', border: '#e2e8f0' };
  }

  return (
    <div
      class="cal-grid-wrap"
      ref={gridEl}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    >
      <div class="cal-grid-head" aria-hidden="true">
        <For each={WEEKDAY_LABELS}>{(w) => <div class="cal-grid-head-cell">{w}</div>}</For>
      </div>
      <div class="cal-grid" role="grid" aria-label="月份日历">
        <For each={cells()}>
          {(d) => {
            const date = fmtISO(d);
            const inMonth = d.getMonth() === month();
            const color = createMemo(() => colorFor(date));
            const pending = createMemo(() => props.pendingChanges.has(date));
            const isToday = fmtISO(new Date()) === date;
            return (
              <div
                role="gridcell"
                data-date={date}
                class={`cal-cell ${inMonth ? '' : 'cal-cell-out'} ${isToday ? 'cal-cell-today' : ''} ${pending() ? 'cal-cell-pending' : ''}`}
                style={{
                  'background-color': color().bg,
                  color: color().fg,
                  ...(color().border ? { 'border-color': color().border } : {}),
                }}
                aria-label={`${date}${pending() ? '（未保存）' : ''}`}
              >
                <span class="cal-cell-num">{d.getDate()}</span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default MonthGrid;
