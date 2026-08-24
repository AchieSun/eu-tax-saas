/**
 * W4 T4.1 — FilingDraftView (3rd top-level tab).
 *
 * Flow:
 *   1. User picks country / year / form from a constrained preset
 *      (SUPPORTED_FORMS keeps the picker honest — only forms with mapping
 *      rows in D1 today are selectable).
 *   2. "Load fields" → GET /api/forms/:c/:y/:f → populate the form editor.
 *   3. User fills inputs (text / number / date / checkbox per field meta).
 *   4. "Generate Draft PDF" → POST /api/forms/:c/:y/:f/render → preview the
 *      returned PDF inside an <iframe blob:URL> + offer a download link.
 *
 * Dependencies:
 *   - solid-js primitives (createSignal, createMemo, For, Show, onCleanup)
 *   - ./filing/api (fetch client) + ./filing/types (TS only)
 *
 * Styling follows App.tsx's convention: inline styles + a small <style>
 * block scoped via filing-* classnames. No external CSS-in-JS library.
 */

import {
  type Component,
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from 'solid-js';
import { blobToObjectUrl, downloadBlob, fetchFormMetadata, renderForm } from './filing/api';
import {
  type FieldMeta,
  type FormMetadata,
  type FormPicker,
  type RenderResult,
  SUPPORTED_FORMS,
} from './filing/types';
import PaywallCard, { paywallStyles } from './paywall/PaywallCard';
import { fetchMe, isPro } from './paywall/api';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Walk a dot-path inside the in-flight formData object and assign `value`
 * at the leaf, lazily creating intermediate plain-object containers. Mirrors
 * the server-side getByPath used inside the fill engine so a field's
 * `dataPath` round-trips cleanly through render.
 */
function setByPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = path.split('.').filter(Boolean);
  if (segments.length === 0) return target;
  const next: Record<string, unknown> = { ...target };
  let cursor: Record<string, unknown> = next;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i] as string;
    const existing = cursor[seg];
    const child: Record<string, unknown> =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[seg] = child;
    cursor = child;
  }
  cursor[segments[segments.length - 1] as string] = value;
  return next;
}

/** Read the current value at a dot-path; undefined if any segment missing. */
function getByPath(source: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.').filter(Boolean);
  let cursor: unknown = source;
  for (const seg of segments) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
}

/** "taxpayer_first_name" → "Taxpayer First Name". */
function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .split(' ')
    .map((w) => {
      if (w.length === 0) return w;
      const first = w.charAt(0).toUpperCase();
      return first + w.slice(1);
    })
    .join(' ');
}

/** Translate a thrown render error into a friendly Chinese+English banner. */
function friendlyRenderError(err: Error & { retryAfter?: string }): string {
  switch (err.message) {
    case 'UNAUTHORIZED':
      return '请先登录 (Please sign in to generate drafts).';
    case 'RATE_LIMITED':
      return `已超过今日生成上限 (10/day). 请在 ${err.retryAfter ?? '?'} 秒后重试.`;
    case 'SUBSCRIPTION_REQUIRED':
      return '无水印 PDF 为 Pro 会员功能 (Watermark-free PDF is a Pro feature). 升级后解锁.';
    case 'FORM_NOT_FOUND':
      return '未找到该表格映射 (Form mapping not found).';
    case 'NO_ACTIVE_FIELDS':
      return '该表格暂无可用字段 (No active fields for this form).';
    default:
      return err.message;
  }
}

function friendlyMetadataError(err: Error): string {
  switch (err.message) {
    case 'UNAUTHORIZED':
      return '请先登录 (Please sign in to load form definitions).';
    case 'FORM_NOT_FOUND':
      return '未找到该表格映射 (Form mapping not found).';
    default:
      return err.message;
  }
}

// ── Component ──────────────────────────────────────────────────────────────

const FilingDraftView: Component = () => {
  // ── State ────────────────────────────────────────────────────────────────
  const defaultPick = SUPPORTED_FORMS[0] as FormPicker;
  const [picker, setPicker] = createSignal<FormPicker>({
    country: defaultPick.country,
    year: defaultPick.year,
    form: defaultPick.form,
  });

  const [metadata, setMetadata] = createSignal<FormMetadata | null>(null);
  const [metadataError, setMetadataError] = createSignal<Error | null>(null);
  const [metadataLoading, setMetadataLoading] = createSignal(false);

  const [formData, setFormData] = createSignal<Record<string, unknown>>({});
  const [includeWatermark, setIncludeWatermark] = createSignal(true);

  const [renderResult, setRenderResult] = createSignal<RenderResult | null>(null);
  const [renderError, setRenderError] = createSignal<{
    message: string;
    retryAfter?: string;
  } | null>(null);
  const [renderLoading, setRenderLoading] = createSignal(false);

  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);

  // ── Paywall: Pro gate (admin OR active subscriber) ─────────────────────
  // The watermark-free PDF is a Pro feature. We fetch /api/me once on mount
  // — the same row the backend gates on — so the UI matches the server's
  // decision. 401 / network error / parse failure all collapse to a
  // signed-out (null) state, and isPro(null) === false, so the toggle
  // stays locked for anon users.
  const [me] = createResource(fetchMe);
  const hasProAccess = createMemo(() => isPro(me()));

  // ── Picker helpers ───────────────────────────────────────────────────────
  // Distinct value sets driven entirely by SUPPORTED_FORMS so adding a new
  // entry surfaces in the dropdowns automatically.
  const countries = createMemo(() => Array.from(new Set(SUPPORTED_FORMS.map((f) => f.country))));
  const years = createMemo(() =>
    Array.from(
      new Set(SUPPORTED_FORMS.filter((f) => f.country === picker().country).map((f) => f.year)),
    ).sort((a, b) => b - a),
  );
  const forms = createMemo(() =>
    SUPPORTED_FORMS.filter((f) => f.country === picker().country && f.year === picker().year),
  );

  function resetForPickerChange(): void {
    setMetadata(null);
    setMetadataError(null);
    setFormData({});
    setRenderResult(null);
    setRenderError(null);
    const old = previewUrl();
    if (old) URL.revokeObjectURL(old);
    setPreviewUrl(null);
  }

  function onCountryChange(value: string): void {
    const firstYear = SUPPORTED_FORMS.find((f) => f.country === value)?.year ?? defaultPick.year;
    const firstForm =
      SUPPORTED_FORMS.find((f) => f.country === value && f.year === firstYear)?.form ??
      defaultPick.form;
    setPicker({ country: value, year: firstYear, form: firstForm });
    resetForPickerChange();
  }

  function onYearChange(value: number): void {
    const p = picker();
    const firstForm =
      SUPPORTED_FORMS.find((f) => f.country === p.country && f.year === value)?.form ??
      defaultPick.form;
    setPicker({ ...p, year: value, form: firstForm });
    resetForPickerChange();
  }

  function onFormChange(value: string): void {
    setPicker({ ...picker(), form: value });
    resetForPickerChange();
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  async function loadFields(): Promise<void> {
    setMetadataLoading(true);
    setMetadataError(null);
    setMetadata(null);
    try {
      const p = picker();
      const meta = await fetchFormMetadata(p.country, p.year, p.form);
      setMetadata(meta);
    } catch (err) {
      setMetadataError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setMetadataLoading(false);
    }
  }

  async function generateDraft(): Promise<void> {
    setRenderLoading(true);
    setRenderError(null);
    try {
      // Paywall: only Pro (admin OR active subscriber) may opt out of the
      // watermark. For everyone else we omit the field so the server
      // defaults ON — the backend re-checks anyway (402 on mismatch).
      const wantWatermarkOff = hasProAccess() && !includeWatermark();
      const result = await renderForm(picker(), formData(), {
        watermark: wantWatermarkOff ? false : undefined,
      });
      // Revoke any previous preview URL before swapping in the new one to
      // avoid leaking blob: handles across regenerations.
      const old = previewUrl();
      if (old) URL.revokeObjectURL(old);
      const url = blobToObjectUrl(result.pdfBlob);
      setPreviewUrl(url);
      setRenderResult(result);
    } catch (err) {
      const e = err as Error & { retryAfter?: string };
      setRenderError({ message: friendlyRenderError(e), retryAfter: e.retryAfter });
      setRenderResult(null);
    } finally {
      setRenderLoading(false);
    }
  }

  function onDownload(): void {
    const r = renderResult();
    if (!r) return;
    const p = picker();
    downloadBlob(r.pdfBlob, `${p.country}-${p.year}-${p.form}-draft.pdf`);
  }

  // Clean up any in-flight object URL when the component unmounts.
  onCleanup(() => {
    const old = previewUrl();
    if (old) URL.revokeObjectURL(old);
  });

  // ── Render helpers ───────────────────────────────────────────────────────
  function renderField(field: FieldMeta) {
    const inputId = `filing-field-${field.key}`;
    const currentValue = getByPath(formData(), field.dataPath);
    const update = (value: unknown) =>
      setFormData((prev) => setByPath(prev, field.dataPath, value));

    return (
      <div class="filing-field">
        <label for={inputId} class="filing-label">
          {humanizeKey(field.key)}
          <span class="filing-field-type">{field.fieldType}</span>
        </label>
        <Show when={field.fieldType === 'text'}>
          <input
            id={inputId}
            type="text"
            class="filing-input"
            value={(currentValue as string | undefined) ?? ''}
            onInput={(e) => update(e.currentTarget.value)}
          />
        </Show>
        <Show when={field.fieldType === 'number'}>
          <input
            id={inputId}
            type="number"
            step="0.01"
            class="filing-input"
            value={
              currentValue === undefined || currentValue === null
                ? ''
                : String(currentValue as number)
            }
            onInput={(e) => {
              const v = e.currentTarget.value;
              update(v === '' ? undefined : Number(v));
            }}
          />
        </Show>
        <Show when={field.fieldType === 'date'}>
          <input
            id={inputId}
            type="date"
            class="filing-input"
            value={(currentValue as string | undefined) ?? ''}
            onInput={(e) => update(e.currentTarget.value)}
          />
        </Show>
        <Show when={field.fieldType === 'checkbox'}>
          <input
            id={inputId}
            type="checkbox"
            class="filing-checkbox"
            checked={Boolean(currentValue)}
            onChange={(e) => update(e.currentTarget.checked)}
          />
        </Show>
        <Show when={field.citation}>
          <p class="filing-helper">{field.citation}</p>
        </Show>
      </div>
    );
  }

  return (
    <section style={{ display: 'flex', 'flex-direction': 'column', gap: '1.5rem' }}>
      <style>{filingStyles}</style>

      {/* Header ────────────────────────────────────────────────────────── */}
      <header>
        <h2 style={{ margin: '0 0 0.25rem', 'font-size': '1.5rem', 'font-weight': 700 }}>
          税务草稿生成 (Filing Draft)
        </h2>
        <p style={{ margin: 0, color: '#6b7280', 'font-size': '0.9rem' }}>
          Generate a fillable PDF draft of your tax filing.
        </p>
      </header>

      {/* Picker row ──────────────────────────────────────────────────── */}
      <div class="filing-panel">
        <div class="filing-picker-row">
          <div class="filing-picker-cell">
            <label for="filing-country" class="filing-label">
              Country
            </label>
            <select
              id="filing-country"
              class="filing-input"
              value={picker().country}
              onChange={(e) => onCountryChange(e.currentTarget.value)}
            >
              <For each={countries()}>{(c) => <option value={c}>{c}</option>}</For>
            </select>
          </div>
          <div class="filing-picker-cell">
            <label for="filing-year" class="filing-label">
              Year
            </label>
            <select
              id="filing-year"
              class="filing-input"
              value={String(picker().year)}
              onChange={(e) => onYearChange(Number(e.currentTarget.value))}
            >
              <For each={years()}>{(y) => <option value={String(y)}>{y}</option>}</For>
            </select>
          </div>
          <div class="filing-picker-cell" style={{ flex: 2 }}>
            <label for="filing-form" class="filing-label">
              Form
            </label>
            <select
              id="filing-form"
              class="filing-input"
              value={picker().form}
              onChange={(e) => onFormChange(e.currentTarget.value)}
            >
              <For each={forms()}>{(f) => <option value={f.form}>{f.label}</option>}</For>
            </select>
          </div>
          <div class="filing-picker-cell" style={{ 'align-self': 'flex-end' }}>
            <button
              type="button"
              class="filing-btn-primary"
              onClick={loadFields}
              disabled={metadataLoading()}
            >
              {metadataLoading() ? '加载中…' : 'Load fields'}
            </button>
          </div>
        </div>

        <Show when={metadataError()}>
          {(err) => (
            <div class="filing-banner-error" role="alert" aria-live="polite">
              {friendlyMetadataError(err())}
            </div>
          )}
        </Show>
      </div>

      {/* Fields panel ───────────────────────────────────────────────── */}
      <Show when={metadata()}>
        {(meta) => (
          <div class="filing-panel">
            <div
              style={{
                display: 'flex',
                'justify-content': 'space-between',
                'align-items': 'baseline',
                'margin-bottom': '1rem',
              }}
            >
              <h3 style={{ margin: 0, 'font-size': '1.05rem', 'font-weight': 600 }}>
                字段编辑 (Edit fields)
              </h3>
              <span style={{ 'font-size': '0.75rem', color: '#6b7280' }}>
                {meta().fields.length} field(s) · mapping v{meta().version} ·{' '}
                {meta().contentHash.slice(0, 8)}
              </span>
            </div>

            <Show
              when={meta().fields.length > 0}
              fallback={
                <p style={{ color: '#6b7280', margin: 0 }}>
                  该表格暂无字段定义 (No fields defined for this form).
                </p>
              }
            >
              <div class="filing-field-grid">
                <For each={meta().fields}>{renderField}</For>
              </div>
            </Show>

            {/* Action row ─────────────────────────────────────────── */}
            <div class="filing-action-row">
              {/* Paywall: the watermark toggle is Pro-gated. Non-Pro users
                  get a static hint + the upgrade card below so they know
                  the feature exists and how to unlock it. */}
              <Show
                when={hasProAccess()}
                fallback={
                  <span class="filing-watermark-disabled">
                    Drafts are always watermarked — watermark-free PDFs are a Pro feature.
                  </span>
                }
              >
                <label class="filing-watermark-toggle">
                  <input
                    type="checkbox"
                    checked={includeWatermark()}
                    onChange={(e) => setIncludeWatermark(e.currentTarget.checked)}
                  />
                  Include DRAFT watermark
                </label>
              </Show>
              <button
                type="button"
                class="filing-btn-primary"
                onClick={generateDraft}
                disabled={renderLoading() || meta().fields.length === 0}
              >
                {renderLoading() ? '生成中…' : 'Generate Draft PDF'}
              </button>
            </div>

            <Show when={renderError()}>
              {(err) => (
                <div class="filing-banner-error" role="alert" aria-live="polite">
                  {err().message}
                </div>
              )}
            </Show>

            {/* Paywall: upgrade card for non-Pro users (watermark-free PDF) */}
            <Show when={!hasProAccess()}>
              <div class="filing-paywall-row">
                <PaywallCard
                  me={me() ?? null}
                  title="无水印 PDF 生成"
                  bullets={[
                    '生成可直接提交的干净 PDF（无 DRAFT 水印）',
                    '每日 10 次生成额度',
                    '全部五国表格模板',
                  ]}
                />
              </div>
            </Show>
          </div>
        )}
      </Show>

      {/* Preview panel ─────────────────────────────────────────────── */}
      <Show when={renderResult() && previewUrl()}>
        <div class="filing-panel">
          <div
            style={{
              display: 'flex',
              'justify-content': 'space-between',
              'align-items': 'baseline',
              'margin-bottom': '0.75rem',
            }}
          >
            <h3 style={{ margin: 0, 'font-size': '1.05rem', 'font-weight': 600 }}>
              预览 (Preview)
            </h3>
            <button type="button" class="filing-btn-secondary" onClick={onDownload}>
              Download PDF
            </button>
          </div>
          <iframe
            title="Generated tax draft PDF"
            src={previewUrl() ?? ''}
            style={{
              width: '100%',
              'min-height': '800px',
              border: '1px solid #e5e7eb',
              'border-radius': '12px',
              background: '#ffffff',
            }}
          />
          <Show when={renderResult()}>
            {(r) => (
              <>
                <p
                  style={{
                    margin: '0.75rem 0 0',
                    'font-size': '0.8rem',
                    color: '#6b7280',
                  }}
                >
                  Filled {r().filledFields} field(s) · {r().warnings} warning(s) · mapping v
                  {r().mappingVersion} ({r().mappingHash.slice(0, 8)})
                </p>
                {/* Oracle P1-4 (W4 review): per-warning detail panel — yellow border */}
                <Show when={r().warningDetail && (r().warningDetail?.items.length ?? 0) > 0}>
                  {(_) => {
                    const wd = r().warningDetail;
                    if (!wd) return null;
                    return (
                      <div
                        role="alert"
                        style={{
                          margin: '0.75rem 0 0',
                          padding: '0.75rem 1rem',
                          background: '#fffbeb',
                          border: '1px solid #f59e0b',
                          'border-radius': '8px',
                          'font-size': '0.8rem',
                          color: '#92400e',
                        }}
                      >
                        <div style={{ 'font-weight': 600, 'margin-bottom': '0.5rem' }}>
                          {wd.total} field warning(s)
                          {wd.truncated ? ` — showing first ${wd.items.length} of ${wd.total}` : ''}
                        </div>
                        <ul
                          style={{
                            margin: 0,
                            'padding-left': '1.25rem',
                            'list-style-type': 'disc',
                          }}
                        >
                          {/* Oracle P1-4 (W4 review): <For> handles list reconciliation in SolidJS. */}
                          <For each={wd.items}>
                            {(w) => (
                              <li style={{ 'margin-bottom': '0.25rem' }}>
                                <code style={{ 'font-family': 'monospace' }}>{w.fieldName}</code>
                                {' — '}
                                <span style={{ 'font-style': 'italic' }}>{w.reason}</span>
                                {w.detail ? `: ${w.detail}` : ''}
                                {w.dataPath ? ` (path: ${w.dataPath})` : ''}
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                    );
                  }}
                </Show>
              </>
            )}
          </Show>
        </div>
      </Show>
    </section>
  );
};

export default FilingDraftView;

const filingStyles = `${paywallStyles}
.filing-panel {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
}
.filing-picker-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: flex-end;
}
.filing-picker-cell {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  flex: 1;
  min-width: 140px;
}
.filing-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #374151;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.filing-field-type {
  font-size: 0.65rem;
  font-weight: 500;
  color: #6b7280;
  background: #f3f4f6;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.filing-input {
  font-family: inherit;
  font-size: 0.9rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
  color: #111827;
  transition: border-color 150ms, box-shadow 150ms;
}
.filing-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}
.filing-checkbox {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: #2563eb;
  margin-top: 0.25rem;
}
.filing-helper {
  margin: 0.25rem 0 0;
  font-size: 0.72rem;
  color: #6b7280;
  line-height: 1.4;
}
.filing-field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem 1.25rem;
}
.filing-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.filing-action-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 1rem;
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid #f3f4f6;
}
.filing-watermark-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: #374151;
  cursor: pointer;
}
.filing-watermark-toggle input {
  accent-color: #2563eb;
}
.filing-watermark-disabled {
  font-size: 0.8rem;
  color: #9ca3af;
  font-style: italic;
}
.filing-btn-primary {
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  padding: 0.625rem 1.25rem;
  cursor: pointer;
  transition: background-color 150ms, opacity 150ms;
}
.filing-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.filing-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.filing-btn-secondary {
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  background: #f3f4f6;
  color: #111827;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 0.5rem 1rem;
  cursor: pointer;
  transition: background-color 150ms;
}
.filing-btn-secondary:hover { background: #e5e7eb; }
.filing-paywall-row { margin-top: 1.25rem; }
.filing-banner-error {
  margin-top: 1rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  border-radius: 8px;
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
}
`;
