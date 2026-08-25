/**
 * F5 RagPage — Retrieval-Augmented Generation tax-law Q&A.
 *
 * POST /api/rag/qa and display the answer with confidence, reasoning and sources.
 */

import { type Component, For, Show, createSignal } from 'solid-js';
import { useI18n } from '../i18n';
import { type RagAnswer, type RagJurisdiction, askQuestion } from './rag/api';

type RagOption = RagJurisdiction | '';

/** Jurisdiction select options; labels resolved via t() at render time. */
const JURISDICTIONS: RagOption[] = ['', 'DE', 'NL', 'PT', 'ES', 'UK', 'EU'];
const YEARS = [2024, 2025, 2026];

function jurisdictionLabel(j: RagOption, t: (key: string) => string): string {
  if (j === '') return t('rag.option.auto');
  return t(`rag.option.${j}`);
}

function confidenceColor(c: 'high' | 'medium' | 'low'): string {
  switch (c) {
    case 'high':
      return '#059669';
    case 'medium':
      return '#d97706';
    case 'low':
      return '#dc2626';
  }
}

const RagPage: Component = () => {
  const { t } = useI18n();
  const [question, setQuestion] = createSignal('');
  const [jurisdiction, setJurisdiction] = createSignal<RagJurisdiction | ''>('');
  const [taxYear, setTaxYear] = createSignal<number | ''>('');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [answer, setAnswer] = createSignal<RagAnswer | null>(null);

  /** Map an API error code to a locale-aware friendly message. */
  function friendlyError(err: Error): string {
    switch (err.message) {
      case 'UNAUTHORIZED':
        return t('rag.error.unauthorized');
      case 'NO_CONTEXT':
        return t('rag.error.noContext');
      default:
        return err.message;
    }
  }

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    const q = question().trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await askQuestion(
        q,
        jurisdiction() ? (jurisdiction() as RagJurisdiction) : undefined,
        taxYear() ? Number(taxYear()) : undefined,
      );
      setAnswer(result);
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err : new Error(String(err))));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <style>{styles}</style>

      <header class="rag-hero">
        <h1 class="rag-h1">{t('rag.title')}</h1>
        <p class="rag-sub">{t('rag.subtitle')}</p>
      </header>

      <section class="rag-panel">
        <form onSubmit={onSubmit}>
          <div class="rag-field">
            <label for="rag-question">{t('rag.field.question')}</label>
            <textarea
              id="rag-question"
              class="rag-textarea"
              rows={3}
              value={question()}
              onInput={(e) => setQuestion(e.currentTarget.value)}
              placeholder={t('rag.placeholder')}
            />
          </div>
          <div class="rag-options">
            <div class="rag-field-inline">
              <label for="rag-jurisdiction">{t('rag.field.jurisdiction')}</label>
              <select
                id="rag-jurisdiction"
                class="rag-input"
                value={jurisdiction()}
                onChange={(e) => setJurisdiction(e.currentTarget.value as RagJurisdiction | '')}
              >
                <For each={JURISDICTIONS}>
                  {(j) => <option value={j}>{jurisdictionLabel(j, t)}</option>}
                </For>
              </select>
            </div>
            <div class="rag-field-inline">
              <label for="rag-year">{t('rag.field.year')}</label>
              <select
                id="rag-year"
                class="rag-input"
                value={String(taxYear())}
                onChange={(e) =>
                  setTaxYear(e.currentTarget.value ? Number(e.currentTarget.value) : '')
                }
              >
                <option value="">{t('rag.option.auto')}</option>
                <For each={YEARS}>{(y) => <option value={String(y)}>{y}</option>}</For>
              </select>
            </div>
            <div class="rag-actions">
              <button
                type="submit"
                class="rag-btn rag-btn-primary"
                disabled={loading() || !question().trim()}
              >
                {loading() ? t('rag.action.thinking') : t('rag.action.ask')}
              </button>
            </div>
          </div>
        </form>

        <Show when={error()}>
          {(msg) => (
            <div class="rag-error" role="alert">
              {msg()}
            </div>
          )}
        </Show>
      </section>

      <Show when={answer()}>
        {(a) => (
          <section class="rag-answer" aria-label={t('rag.answer.label')}>
            <div class="rag-answer-head">
              <span class="rag-confidence" style={{ color: confidenceColor(a().confidence) }}>
                {t('rag.answer.confidence', { value: a().confidence })}
              </span>
              <span class="rag-year">{t('rag.answer.year', { value: a().taxYear })}</span>
            </div>
            <div class="rag-answer-body">
              <p>{a().answer}</p>
            </div>
            <Show when={a().reasoning}>
              {(reason) => (
                <div class="rag-reasoning">
                  <h3>{t('rag.answer.reasoning')}</h3>
                  <p>{reason()}</p>
                </div>
              )}
            </Show>
            <Show when={(a().warnings ?? []).length > 0}>
              <div class="rag-warnings">
                <h3>{t('rag.answer.warnings')}</h3>
                <ul>
                  <For each={a().warnings ?? []}>{(w) => <li>{w}</li>}</For>
                </ul>
              </div>
            </Show>
            <Show when={a().citations.length > 0}>
              <div class="rag-sources">
                <h3>{t('rag.answer.sources')}</h3>
                <ul>
                  <For each={a().citations}>
                    {(c) => (
                      <li>
                        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
                          {c.sourceTitle}
                        </a>
                        <span class="rag-source-meta">
                          {' '}
                          · {c.authority} ·{' '}
                          {t('rag.answer.relevance', { value: (c.score * 100).toFixed(0) })}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>
            <Show when={a().usage}>
              {(u) => (
                <p class="rag-usage">
                  Tokens: {u().promptTokens} prompt / {u().completionTokens} completion /{' '}
                  {u().totalTokens} total
                </p>
              )}
            </Show>
          </section>
        )}
      </Show>
    </div>
  );
};

export default RagPage;

const styles = `
.rag-hero { margin: 0 0 1.5rem; }
.rag-h1 {
  font-size: clamp(1.5rem, 3vw, 2rem);
  line-height: 1.2;
  margin: 0 0 0.5rem;
  color: #111827;
  letter-spacing: -0.02em;
}
.rag-sub {
  margin: 0;
  color: #6b7280;
  font-size: 0.95rem;
  max-width: 70ch;
  line-height: 1.5;
}

.rag-panel {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.rag-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-bottom: 1rem;
}
.rag-field label,
.rag-field-inline label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #374151;
}
.rag-textarea {
  font-family: inherit;
  font-size: 0.95rem;
  padding: 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
  color: #111827;
  resize: vertical;
  min-height: 80px;
  transition: border-color 150ms, box-shadow 150ms;
}
.rag-textarea:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}
.rag-options {
  display: flex;
  gap: 1rem;
  align-items: flex-end;
  flex-wrap: wrap;
}
.rag-field-inline {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 140px;
}
.rag-input {
  font-family: inherit;
  font-size: 0.9rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
  color: #111827;
}
.rag-actions { margin-left: auto; }
.rag-btn {
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  min-height: 40px;
  padding: 0 1.25rem;
  border: 1.5px solid transparent;
  transition: background-color 150ms, color 150ms, transform 150ms;
}
.rag-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.rag-btn-primary { background: #2563eb; color: #ffffff; }
.rag-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.rag-btn-primary:active:not(:disabled) { transform: translateY(1px); }

.rag-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  margin-top: 1rem;
  font-size: 0.875rem;
}

.rag-answer {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.rag-answer-head {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}
.rag-confidence {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.rag-year {
  font-size: 0.8rem;
  color: #6b7280;
}
.rag-answer-body {
  font-size: 1rem;
  line-height: 1.7;
  color: #111827;
}
.rag-answer-body p { margin: 0 0 0.75rem; }
.rag-answer-body p:last-child { margin-bottom: 0; }

.rag-reasoning,
.rag-warnings,
.rag-sources {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid #f3f4f6;
}
.rag-reasoning h3,
.rag-warnings h3,
.rag-sources h3 {
  font-size: 0.8rem;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 0.5rem;
}
.rag-reasoning p {
  margin: 0;
  font-size: 0.9rem;
  color: #4b5563;
  line-height: 1.6;
}
.rag-warnings {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 0.75rem 1rem;
}
.rag-warnings h3 { color: #92400e; }
.rag-warnings ul {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.875rem;
  color: #78350f;
}
.rag-sources ul {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.875rem;
  line-height: 1.7;
}
.rag-sources a {
  color: #2563eb;
  text-decoration: none;
  font-weight: 600;
}
.rag-sources a:hover { text-decoration: underline; }
.rag-source-meta { color: #6b7280; }
.rag-usage {
  margin: 1rem 0 0;
  font-size: 0.75rem;
  color: #9ca3af;
}
`;
