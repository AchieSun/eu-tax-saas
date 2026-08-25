/**
 * F7 DeadlinesPage — personal tax deadline tracker.
 *
 * GET /api/deadlines with filters, POST /api/deadlines to create,
 * POST /api/deadlines/:id/complete, POST /api/deadlines/:id/snooze,
 * DELETE /api/deadlines/:id, POST /api/deadlines/seed.
 */

import { type Component, For, Show, createEffect, createSignal } from 'solid-js';
import {
  DEADLINE_CATEGORIES,
  DEADLINE_STATUSES,
  type DeadlineCategory,
  type DeadlineStatus,
} from '../../deadlines/types';
import { t } from '../i18n';
import {
  type Deadline,
  completeDeadline,
  createDeadline,
  deleteDeadline,
  fetchDeadlines,
  seedDeadlines,
  snoozeDeadline,
} from './deadlines/api';

const COUNTRIES = ['DE', 'NL', 'PT', 'ES', 'UK'] as const;
const YEARS = [2024, 2025, 2026];

function fmtMonth(isoMonth: string): string {
  const [y, m] = isoMonth.split('-');
  return t('deadlines.month.format', { y, m });
}

/** Map an API error code to a locale-aware friendly message. */
function friendlyError(err: Error): string {
  switch (err.message) {
    case 'UNAUTHORIZED':
      return t('deadlines.error.unauthorized');
    case 'NOT_FOUND':
      return t('deadlines.error.notFound');
    default:
      return err.message;
  }
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysISO(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function statusLabel(s: string): string {
  const key = `deadlines.status.${s}`;
  const label = t(key);
  return label === key ? s : label;
}

function categoryLabel(s: string): string {
  const key = `deadlines.category.${s}`;
  const label = t(key);
  return label === key ? s : label;
}

/** Locale-aware country label ('德国 DE' / 'Germany DE'). */
const countryLabel = (c: string) => {
  const key = `calendar.country.${c}`;
  const label = t(key);
  return label === key ? c : label;
};

const DeadlinesPage: Component = () => {
  const [items, setItems] = createSignal<Deadline[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Filters
  const [filterYear, setFilterYear] = createSignal<number | ''>(2025);
  const [filterStatus, setFilterStatus] = createSignal<DeadlineStatus | ''>('');
  const [filterJurisdiction, setFilterJurisdiction] = createSignal<string>('');
  const [filterCategory, setFilterCategory] = createSignal<DeadlineCategory | ''>('');

  // Create form
  const [showCreate, setShowCreate] = createSignal(false);
  const [createYear, setCreateYear] = createSignal<number>(2025);
  const [createJurisdiction, setCreateJurisdiction] = createSignal<string>('DE');
  const [createTitle, setCreateTitle] = createSignal('');
  const [createDescription, setCreateDescription] = createSignal('');
  const [createDue, setCreateDue] = createSignal(todayISO());
  const [createCategory, setCreateCategory] = createSignal<DeadlineCategory>('tax_filing');
  const [createReminder, setCreateReminder] = createSignal<number>(7);

  async function loadItems() {
    setLoading(true);
    setError(null);
    try {
      const filters: Parameters<typeof fetchDeadlines>[0] = {};
      if (filterYear()) filters.taxYear = Number(filterYear());
      if (filterStatus()) filters.status = filterStatus() as DeadlineStatus;
      if (filterJurisdiction()) filters.jurisdiction = filterJurisdiction();
      if (filterCategory()) filters.category = filterCategory() as DeadlineCategory;
      const list = await fetchDeadlines(filters);
      setItems(list);
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err : new Error(String(err))));
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    void loadItems();
  });

  async function onCreate(e: SubmitEvent) {
    e.preventDefault();
    if (!createTitle().trim()) return;
    setError(null);
    try {
      await createDeadline({
        taxYear: createYear(),
        jurisdiction: createJurisdiction(),
        title: createTitle().trim(),
        description: createDescription().trim(),
        dueDate: createDue(),
        category: createCategory(),
        reminderDays: createReminder(),
      });
      setCreateTitle('');
      setCreateDescription('');
      setCreateDue(todayISO());
      setShowCreate(false);
      await loadItems();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err : new Error(String(err))));
    }
  }

  async function onComplete(id: string) {
    setError(null);
    try {
      await completeDeadline(id);
      await loadItems();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err : new Error(String(err))));
    }
  }

  async function onSnooze(id: string, until: string) {
    setError(null);
    try {
      await snoozeDeadline(id, until);
      await loadItems();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err : new Error(String(err))));
    }
  }

  async function onDelete(id: string) {
    if (!confirm(t('deadlines.confirm.delete'))) return;
    setError(null);
    try {
      await deleteDeadline(id);
      await loadItems();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err : new Error(String(err))));
    }
  }

  async function onSeed() {
    const year = filterYear() ? Number(filterYear()) : 2025;
    const jurisdictions = filterJurisdiction()
      ? [filterJurisdiction()]
      : (COUNTRIES as unknown as string[]);
    setError(null);
    try {
      const count = await seedDeadlines(year, jurisdictions);
      alert(t('deadlines.alert.seeded', { count }));
      await loadItems();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err : new Error(String(err))));
    }
  }

  const groupedItems = () => {
    const map = new Map<string, Deadline[]>();
    for (const item of items()) {
      const month = item.dueDate.slice(0, 7);
      const arr = map.get(month) ?? [];
      arr.push(item);
      map.set(month, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  };

  return (
    <div>
      <style>{styles}</style>

      <header class="dl-hero">
        <h1 class="dl-h1">{t('deadlines.title')}</h1>
        <p class="dl-sub">{t('deadlines.subtitle')}</p>
      </header>

      <Show when={error()}>
        {(msg) => (
          <div class="dl-error" role="alert">
            <span>⚠️ {msg()}</span>
            <button type="button" class="dl-btn dl-btn-ghost" onClick={() => setError(null)}>
              {t('deadlines.error.clear')}
            </button>
          </div>
        )}
      </Show>

      {/* Filters */}
      <section class="dl-panel">
        <div class="dl-section-head">
          <h2 class="dl-h2">{t('deadlines.filter.title')}</h2>
          <div class="dl-actions">
            <button
              type="button"
              class="dl-btn dl-btn-outline"
              onClick={() => setShowCreate((s) => !s)}
            >
              {showCreate() ? t('deadlines.action.cancel') : t('deadlines.action.create')}
            </button>
            <button type="button" class="dl-btn dl-btn-secondary" onClick={() => void onSeed()}>
              {t('deadlines.action.seed')}
            </button>
          </div>
        </div>
        <div class="dl-filter-grid">
          <div class="dl-field">
            <label for="dl-filter-year">{t('deadlines.filter.year')}</label>
            <select
              id="dl-filter-year"
              class="dl-input"
              value={String(filterYear())}
              onChange={(e) =>
                setFilterYear(e.currentTarget.value ? Number(e.currentTarget.value) : '')
              }
            >
              <For each={YEARS}>{(y) => <option value={String(y)}>{y}</option>}</For>
            </select>
          </div>
          <div class="dl-field">
            <label for="dl-filter-status">{t('deadlines.filter.status')}</label>
            <select
              id="dl-filter-status"
              class="dl-input"
              value={filterStatus()}
              onChange={(e) => setFilterStatus(e.currentTarget.value as DeadlineStatus | '')}
            >
              <option value="">{t('deadlines.filter.all')}</option>
              <For each={DEADLINE_STATUSES}>
                {(s) => <option value={s}>{statusLabel(s)}</option>}
              </For>
            </select>
          </div>
          <div class="dl-field">
            <label for="dl-filter-jurisdiction">{t('deadlines.filter.country')}</label>
            <select
              id="dl-filter-jurisdiction"
              class="dl-input"
              value={filterJurisdiction()}
              onChange={(e) => setFilterJurisdiction(e.currentTarget.value)}
            >
              <option value="">{t('deadlines.filter.all')}</option>
              <For each={COUNTRIES}>{(c) => <option value={c}>{countryLabel(c)}</option>}</For>
            </select>
          </div>
          <div class="dl-field">
            <label for="dl-filter-category">{t('deadlines.filter.category')}</label>
            <select
              id="dl-filter-category"
              class="dl-input"
              value={filterCategory()}
              onChange={(e) => setFilterCategory(e.currentTarget.value as DeadlineCategory | '')}
            >
              <option value="">{t('deadlines.filter.all')}</option>
              <For each={DEADLINE_CATEGORIES}>
                {(c) => <option value={c}>{categoryLabel(c)}</option>}
              </For>
            </select>
          </div>
        </div>
      </section>

      {/* Create form */}
      <Show when={showCreate()}>
        <section class="dl-panel">
          <h2 class="dl-h2">{t('deadlines.form.title')}</h2>
          <form onSubmit={onCreate}>
            <div class="dl-form-grid">
              <div class="dl-field">
                <label for="dl-create-title">{t('deadlines.form.itemTitle')} *</label>
                <input
                  id="dl-create-title"
                  class="dl-input"
                  type="text"
                  value={createTitle()}
                  onInput={(e) => setCreateTitle(e.currentTarget.value)}
                  required
                />
              </div>
              <div class="dl-field">
                <label for="dl-create-jurisdiction">{t('deadlines.form.jurisdiction')} *</label>
                <select
                  id="dl-create-jurisdiction"
                  class="dl-input"
                  value={createJurisdiction()}
                  onChange={(e) => setCreateJurisdiction(e.currentTarget.value)}
                >
                  <For each={COUNTRIES}>{(c) => <option value={c}>{countryLabel(c)}</option>}</For>
                </select>
              </div>
              <div class="dl-field">
                <label for="dl-create-year">{t('deadlines.form.year')} *</label>
                <select
                  id="dl-create-year"
                  class="dl-input"
                  value={String(createYear())}
                  onChange={(e) => setCreateYear(Number(e.currentTarget.value))}
                >
                  <For each={YEARS}>{(y) => <option value={String(y)}>{y}</option>}</For>
                </select>
              </div>
              <div class="dl-field">
                <label for="dl-create-due">{t('deadlines.form.dueDate')} *</label>
                <input
                  id="dl-create-due"
                  class="dl-input"
                  type="date"
                  value={createDue()}
                  onInput={(e) => setCreateDue(e.currentTarget.value)}
                  required
                />
              </div>
              <div class="dl-field">
                <label for="dl-create-category">{t('deadlines.form.category')} *</label>
                <select
                  id="dl-create-category"
                  class="dl-input"
                  value={createCategory()}
                  onChange={(e) => setCreateCategory(e.currentTarget.value as DeadlineCategory)}
                >
                  <For each={DEADLINE_CATEGORIES}>
                    {(c) => <option value={c}>{categoryLabel(c)}</option>}
                  </For>
                </select>
              </div>
              <div class="dl-field">
                <label for="dl-create-reminder">{t('deadlines.form.reminderDays')}</label>
                <input
                  id="dl-create-reminder"
                  class="dl-input"
                  type="number"
                  min={0}
                  max={365}
                  value={createReminder()}
                  onInput={(e) => setCreateReminder(Number(e.currentTarget.value))}
                />
              </div>
              <div class="dl-field dl-field-wide">
                <label for="dl-create-desc">{t('deadlines.form.description')}</label>
                <input
                  id="dl-create-desc"
                  class="dl-input"
                  type="text"
                  value={createDescription()}
                  onInput={(e) => setCreateDescription(e.currentTarget.value)}
                />
              </div>
            </div>
            <div class="dl-actions">
              <button type="submit" class="dl-btn dl-btn-primary">
                {t('deadlines.action.save')}
              </button>
            </div>
          </form>
        </section>
      </Show>

      {/* List */}
      <section class="dl-panel">
        <div class="dl-section-head">
          <h2 class="dl-h2">{t('deadlines.list.title')}</h2>
          <span class="dl-count">{t('deadlines.list.count', { count: items().length })}</span>
        </div>

        <Show when={loading()}>
          <div class="dl-skel-list" aria-busy="true" aria-label={t('deadlines.list.loading')}>
            <For each={[0, 1, 2]}>{() => <div class="dl-skel-row" />}</For>
          </div>
        </Show>

        <Show when={!loading() && items().length === 0}>
          <p class="dl-empty">{t('deadlines.list.empty')}</p>
        </Show>

        <Show when={!loading() && items().length > 0}>
          <For each={groupedItems()}>
            {([month, list]) => (
              <div class="dl-month-group">
                <h3 class="dl-month-title">{fmtMonth(month)}</h3>
                <For each={list}>
                  {(item) => (
                    <DeadlineItem
                      item={item}
                      onComplete={onComplete}
                      onSnooze={onSnooze}
                      onDelete={onDelete}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </section>
    </div>
  );
};

interface DeadlineItemProps {
  item: Deadline;
  onComplete: (id: string) => Promise<void>;
  onSnooze: (id: string, until: string) => Promise<void>;
  onDelete: (id: string) => void;
}

function DeadlineItem(props: DeadlineItemProps) {
  const [snoozeDate, setSnoozeDate] = createSignal(addDaysISO(props.item.dueDate, 7));
  const [expanded, setExpanded] = createSignal(false);

  const statusClass = () => {
    switch (props.item.status) {
      case 'completed':
        return 'dl-status-completed';
      case 'snoozed':
        return 'dl-status-snoozed';
      case 'dismissed':
        return 'dl-status-dismissed';
      default:
        return 'dl-status-pending';
    }
  };

  return (
    <div class={`dl-item ${statusClass()}`}>
      <div class="dl-item-main">
        <div class="dl-item-info">
          <div class="dl-item-title-row">
            <span class="dl-item-jurisdiction">{props.item.jurisdiction}</span>
            <strong class="dl-item-title">{props.item.title}</strong>
            <span class={`dl-status-badge ${statusClass()}`}>{statusLabel(props.item.status)}</span>
            <span class="dl-item-category">{categoryLabel(props.item.category)}</span>
          </div>
          <div class="dl-item-meta">
            <span>{t('deadlines.item.due', { date: props.item.dueDate })}</span>
            <Show when={props.item.snoozedUntil}>
              {(d) => <span>{t('deadlines.item.snoozedUntil', { date: d() })}</span>}
            </Show>
            <Show when={props.item.description}>
              {(desc) => <span class="dl-item-desc">{desc()}</span>}
            </Show>
          </div>
        </div>
        <div class="dl-item-actions">
          <Show when={props.item.status !== 'completed' && props.item.status !== 'dismissed'}>
            <button
              type="button"
              class="dl-btn dl-btn-small dl-btn-success"
              onClick={() => void props.onComplete(props.item.id)}
            >
              {t('deadlines.action.complete')}
            </button>
          </Show>
          <button
            type="button"
            class="dl-btn dl-btn-small dl-btn-outline"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded() ? t('deadlines.action.collapse') : t('deadlines.action.snooze')}
          </button>
          <button
            type="button"
            class="dl-btn dl-btn-small dl-btn-danger"
            onClick={() => props.onDelete(props.item.id)}
          >
            {t('deadlines.action.delete')}
          </button>
        </div>
      </div>
      <Show when={expanded()}>
        <div class="dl-snooze-row">
          <label for={`dl-snooze-${props.item.id}`}>{t('deadlines.item.snoozeUntil')}</label>
          <input
            id={`dl-snooze-${props.item.id}`}
            class="dl-input"
            type="date"
            value={snoozeDate()}
            onInput={(e) => setSnoozeDate(e.currentTarget.value)}
          />
          <button
            type="button"
            class="dl-btn dl-btn-small dl-btn-primary"
            onClick={() => void props.onSnooze(props.item.id, snoozeDate())}
          >
            {t('deadlines.action.confirmSnooze')}
          </button>
        </div>
      </Show>
    </div>
  );
}

export default DeadlinesPage;

const styles = `
.dl-hero { margin: 0 0 1.5rem; }
.dl-h1 {
  font-size: clamp(1.5rem, 3vw, 2rem);
  line-height: 1.2;
  margin: 0 0 0.5rem;
  color: #111827;
  letter-spacing: -0.02em;
}
.dl-sub {
  margin: 0;
  color: #6b7280;
  font-size: 0.95rem;
  max-width: 70ch;
  line-height: 1.5;
}

.dl-panel {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.dl-section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.dl-h2 {
  font-size: 1.125rem;
  font-weight: 700;
  color: #111827;
  margin: 0;
}
.dl-count {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 600;
}

.dl-error {
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

.dl-filter-grid,
.dl-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
}
.dl-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.dl-field-wide { grid-column: 1 / -1; }
.dl-field label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #374151;
}
.dl-input {
  font-family: inherit;
  font-size: 0.9rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
  color: #111827;
  transition: border-color 150ms, box-shadow 150ms;
}
.dl-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

.dl-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.25rem;
  flex-wrap: wrap;
}
.dl-btn {
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  min-height: 40px;
  padding: 0 1rem;
  border: 1.5px solid transparent;
  transition: background-color 150ms, color 150ms, transform 150ms;
}
.dl-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.dl-btn-primary { background: #2563eb; color: #ffffff; }
.dl-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.dl-btn-primary:active:not(:disabled) { transform: translateY(1px); }
.dl-btn-secondary { background: #f3f4f6; color: #111827; border-color: #e5e7eb; }
.dl-btn-secondary:hover:not(:disabled) { background: #e5e7eb; }
.dl-btn-outline { background: #ffffff; color: #2563eb; border-color: #2563eb; }
.dl-btn-outline:hover:not(:disabled) { background: #eff6ff; }
.dl-btn-ghost { background: transparent; color: #374151; border-color: #e5e7eb; }
.dl-btn-ghost:hover:not(:disabled) { background: #f3f4f6; }
.dl-btn-success { background: #059669; color: #ffffff; }
.dl-btn-success:hover:not(:disabled) { background: #047857; }
.dl-btn-danger { background: #dc2626; color: #ffffff; }
.dl-btn-danger:hover:not(:disabled) { background: #b91c1c; }
.dl-btn-small { min-height: 32px; padding: 0 0.625rem; font-size: 0.8rem; }

.dl-empty {
  text-align: center;
  padding: 2rem 1rem;
  color: #6b7280;
  background: #f9fafb;
  border: 1px dashed #e5e7eb;
  border-radius: 8px;
  margin: 0;
}

.dl-skel-list { display: flex; flex-direction: column; gap: 0.5rem; }
.dl-skel-row {
  height: 64px;
  background: linear-gradient(90deg, #f3f4f6 0%, #e5e7eb 50%, #f3f4f6 100%);
  background-size: 200% 100%;
  animation: dl-shimmer 1.4s infinite;
  border-radius: 8px;
}
@keyframes dl-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.dl-month-group { margin-bottom: 1.5rem; }
.dl-month-group:last-child { margin-bottom: 0; }
.dl-month-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 0.75rem;
  padding-bottom: 0.375rem;
  border-bottom: 1px solid #f3f4f6;
}

.dl-item {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 0.875rem 1rem;
  margin-bottom: 0.5rem;
  background: #ffffff;
  transition: background-color 150ms;
}
.dl-item:last-child { margin-bottom: 0; }
.dl-status-pending { border-left: 4px solid #d1d5db; }
.dl-status-completed { border-left: 4px solid #059669; background: #f0fdf4; opacity: 0.85; }
.dl-status-snoozed { border-left: 4px solid #f59e0b; background: #fffbeb; }
.dl-status-dismissed { border-left: 4px solid #6b7280; opacity: 0.7; }

.dl-item-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
}
.dl-item-info { flex: 1; min-width: 220px; }
.dl-item-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.375rem;
}
.dl-item-jurisdiction {
  font-size: 0.75rem;
  font-weight: 700;
  color: #2563eb;
  background: #eff6ff;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
}
.dl-item-title { color: #111827; }
.dl-status-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.15rem 0.4rem;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.dl-status-badge.dl-status-pending { background: #f3f4f6; color: #374151; }
.dl-status-badge.dl-status-completed { background: #d1fae5; color: #065f46; }
.dl-status-badge.dl-status-snoozed { background: #fde68a; color: #92400e; }
.dl-status-badge.dl-status-dismissed { background: #e5e7eb; color: #374151; }
.dl-item-category {
  font-size: 0.75rem;
  color: #6b7280;
}
.dl-item-meta {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.8rem;
  color: #6b7280;
}
.dl-item-desc {
  color: #374151;
  font-style: italic;
}
.dl-item-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.dl-snooze-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid #f3f4f6;
  flex-wrap: wrap;
}
.dl-snooze-row label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #374151;
}
`;
