/**
 * F4 StrategiesPage — strategy catalog and evaluation.
 *
 * GET /api/strategies for the static catalog, POST /api/strategies/evaluate
 * to run rule-based strategy evaluation against a CalculatorInput.
 */

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
} from 'solid-js';
import {
  type Country,
  FILING_STATUSES,
  type FilingStatus,
  INCOME_TYPES,
  type IncomeType,
  SPECIAL_STATUSES,
  type SpecialStatus,
} from '../../rules/common/types';
import { COUNTRY_META } from '../calendar/types';
import PaywallCard, { paywallStyles } from '../paywall/PaywallCard';
import { fetchMe, isPro } from '../paywall/api';
import {
  type AiRecommendation,
  type BaselineSummary,
  type StrategyCatalogItem,
  type StrategyEvaluation,
  aiRecommendStrategies,
  evaluateStrategies,
  fetchStrategies,
} from './strategies/api';

const COUNTRIES: Country[] = ['DE', 'NL', 'PT', 'ES', 'UK'];
const YEARS = [2024, 2025, 2026];

const COUNTRY_FLAGS: Record<Country, string> = {
  DE: '🇩🇪',
  NL: '🇳🇱',
  PT: '🇵🇹',
  ES: '🇪🇸',
  UK: '🇬🇧',
};

const eur = new Intl.NumberFormat('en-EU', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function friendlyError(err: Error): string {
  switch (err.message) {
    case 'UNAUTHORIZED':
      return '请先登录 (Please sign in).';
    case 'RATE_LIMITED':
      return '请求过于频繁，请稍后再试 (Rate limited).';
    case 'SUBSCRIPTION_REQUIRED':
      return '完整 AI 策略报告为 Pro 会员功能 (Full AI report is a Pro feature).';
    default:
      return err.message;
  }
}

const StrategiesPage: Component = () => {
  // Catalog filters
  const [catalogCountry, setCatalogCountry] = createSignal<Country | ''>('');
  const [catalogYear, setCatalogYear] = createSignal<number | ''>('');

  const [catalog] = createResource(
    () => ({ country: catalogCountry(), year: catalogYear() }),
    async (key) => {
      return fetchStrategies(
        key.country ? key.country : undefined,
        key.year ? Number(key.year) : undefined,
      );
    },
  );

  // Evaluation form
  const [evalCountry, setEvalCountry] = createSignal<Country>('DE');
  const [evalYear, setEvalYear] = createSignal<number>(2025);
  const [incomeType, setIncomeType] = createSignal<IncomeType>('salary');
  const [grossIncome, setGrossIncome] = createSignal<number>(60000);
  const [specialStatus, setSpecialStatus] = createSignal<SpecialStatus>('none');
  const [filingStatus, setFilingStatus] = createSignal<FilingStatus>('single');
  const [region, setRegion] = createSignal<string>('');

  const [evalLoading, setEvalLoading] = createSignal(false);
  const [evalError, setEvalError] = createSignal<string | null>(null);
  const [baseline, setBaseline] = createSignal<BaselineSummary | null>(null);
  const [evaluations, setEvaluations] = createSignal<StrategyEvaluation[]>([]);

  // Pro state + full AI report (F4 paywall).
  const [me] = createResource(fetchMe);
  const hasProAccess = createMemo(() => isPro(me()));
  const [aiLoading, setAiLoading] = createSignal(false);
  const [aiError, setAiError] = createSignal<string | null>(null);
  const [aiRecs, setAiRecs] = createSignal<AiRecommendation[]>([]);
  const [aiUsage, setAiUsage] = createSignal<{ cost: number } | null>(null);

  async function onAiRecommend() {
    setAiLoading(true);
    setAiError(null);
    setAiRecs([]);
    setAiUsage(null);
    try {
      const input = {
        country: evalCountry(),
        taxYear: evalYear(),
        incomeType: incomeType(),
        grossIncome: grossIncome(),
        specialStatus: specialStatus(),
        filingStatus: filingStatus(),
        ...(region() ? { region: region() } : {}),
      };
      const result = await aiRecommendStrategies(input);
      setAiRecs(result.recommendations);
      setAiUsage({ cost: result.usage.cost });
    } catch (err) {
      // SubscriptionRequiredError should be unreachable here: the button
      // is only rendered for Pro users. Any 402 that still slips through
      // (e.g. subscription cancelled server-side between load and click)
      // falls through to the generic error banner.
      setAiError(friendlyError(err instanceof Error ? err : new Error(String(err))));
    } finally {
      setAiLoading(false);
    }
  }

  createEffect(() => {
    // Reset region defaults when country changes.
    const c = evalCountry();
    if (c === 'ES') setRegion('MAD');
    else if (c === 'UK') setRegion('EWN');
    else setRegion('');
  });

  async function onEvaluate(e: SubmitEvent) {
    e.preventDefault();
    setEvalLoading(true);
    setEvalError(null);
    setBaseline(null);
    setEvaluations([]);
    try {
      const input = {
        country: evalCountry(),
        taxYear: evalYear(),
        incomeType: incomeType(),
        grossIncome: grossIncome(),
        specialStatus: specialStatus(),
        filingStatus: filingStatus(),
        ...(region() ? { region: region() } : {}),
      };
      const result = await evaluateStrategies(input);
      setBaseline(result.baseline);
      setEvaluations(result.evaluations);
    } catch (err) {
      setEvalError(friendlyError(err instanceof Error ? err : new Error(String(err))));
    } finally {
      setEvalLoading(false);
    }
  }

  const catalogErrorMsg = () => {
    const err = catalog.error as Error | undefined;
    return err ? friendlyError(err) : null;
  };

  const hasCatalog = () => !catalog.loading && !catalogErrorMsg() && (catalog()?.length ?? 0) > 0;
  const catalogEmpty = () =>
    !catalog.loading && !catalogErrorMsg() && (catalog()?.length ?? 0) === 0;

  return (
    <div>
      <style>{styles}</style>

      <header class="str-hero">
        <h1 class="str-h1">节税策略 (Strategies)</h1>
        <p class="str-sub">
          浏览 A/B 级节税策略目录，输入个人情况后获得基线税负与可适用策略的排序评估。
        </p>
      </header>

      {/* Catalog */}
      <section class="str-panel">
        <div class="str-section-head">
          <h2 class="str-h2">策略目录</h2>
          <div class="str-filters">
            <select
              class="str-select"
              value={catalogCountry()}
              onChange={(e) => setCatalogCountry(e.currentTarget.value as Country | '')}
            >
              <option value="">全部国家</option>
              <For each={COUNTRIES}>
                {(c) => (
                  <option value={c}>
                    {COUNTRY_FLAGS[c]} {COUNTRY_META[c].label}
                  </option>
                )}
              </For>
            </select>
            <select
              class="str-select"
              value={String(catalogYear())}
              onChange={(e) =>
                setCatalogYear(e.currentTarget.value ? Number(e.currentTarget.value) : '')
              }
            >
              <option value="">全部年度</option>
              <For each={YEARS}>{(y) => <option value={String(y)}>{y}</option>}</For>
            </select>
          </div>
        </div>

        <Show when={catalog.loading}>
          <div class="str-skel-grid" aria-busy="true" aria-label="Loading catalog">
            <For each={[0, 1, 2]}>{() => <div class="str-skel-card" />}</For>
          </div>
        </Show>

        <Show when={catalogErrorMsg()}>
          {(msg) => (
            <div class="str-error" role="alert">
              {msg()}
            </div>
          )}
        </Show>

        <Show when={hasCatalog()}>
          <div class="str-catalog-grid">
            <For each={catalog()}>
              {(item: StrategyCatalogItem) => (
                <article class="str-catalog-card">
                  <div class="str-catalog-meta">
                    <span class="str-tier">{item.tier}</span>
                    <span class="str-category">{item.category}</span>
                  </div>
                  <h3 class="str-catalog-title">{item.titleZh}</h3>
                  <p class="str-catalog-desc">{item.descriptionZh}</p>
                  <p class="str-catalog-elig">
                    <strong>适用:</strong> {item.eligibility}
                  </p>
                  <p class="str-catalog-cite">{item.citation}</p>
                </article>
              )}
            </For>
          </div>
        </Show>

        <Show when={catalogEmpty()}>
          <p class="str-empty">暂无匹配策略。</p>
        </Show>
      </section>

      {/* Evaluation */}
      <section class="str-panel">
        <h2 class="str-h2">策略评估</h2>
        <form onSubmit={onEvaluate}>
          <div class="str-form-grid">
            <div class="str-field">
              <label for="str-country">国家</label>
              <select
                id="str-country"
                class="str-input"
                value={evalCountry()}
                onChange={(e) => setEvalCountry(e.currentTarget.value as Country)}
              >
                <For each={COUNTRIES}>
                  {(c) => (
                    <option value={c}>
                      {COUNTRY_FLAGS[c]} {COUNTRY_META[c].label}
                    </option>
                  )}
                </For>
              </select>
            </div>
            <div class="str-field">
              <label for="str-year">年度</label>
              <select
                id="str-year"
                class="str-input"
                value={String(evalYear())}
                onChange={(e) => setEvalYear(Number(e.currentTarget.value))}
              >
                <For each={YEARS}>{(y) => <option value={String(y)}>{y}</option>}</For>
              </select>
            </div>
            <div class="str-field">
              <label for="str-income-type">收入类型</label>
              <select
                id="str-income-type"
                class="str-input"
                value={incomeType()}
                onChange={(e) => setIncomeType(e.currentTarget.value as IncomeType)}
              >
                <For each={INCOME_TYPES}>
                  {(t) => <option value={t}>{t.replace(/_/g, ' ')}</option>}
                </For>
              </select>
            </div>
            <div class="str-field">
              <label for="str-income">年收入 (€)</label>
              <input
                id="str-income"
                class="str-input"
                type="number"
                min={0}
                step={1000}
                value={grossIncome()}
                onInput={(e) => setGrossIncome(Number(e.currentTarget.value))}
              />
            </div>
            <div class="str-field">
              <label for="str-special">特殊身份</label>
              <select
                id="str-special"
                class="str-input"
                value={specialStatus()}
                onChange={(e) => setSpecialStatus(e.currentTarget.value as SpecialStatus)}
              >
                <For each={SPECIAL_STATUSES}>
                  {(s) => <option value={s}>{s === 'none' ? '无' : s}</option>}
                </For>
              </select>
            </div>
            <div class="str-field">
              <label for="str-filing">申报身份</label>
              <select
                id="str-filing"
                class="str-input"
                value={filingStatus()}
                onChange={(e) => setFilingStatus(e.currentTarget.value as FilingStatus)}
              >
                <For each={FILING_STATUSES}>
                  {(s) => <option value={s}>{s.replace(/_/g, ' ')}</option>}
                </For>
              </select>
            </div>
            <div class="str-field">
              <label for="str-region">地区代码 (可选)</label>
              <input
                id="str-region"
                class="str-input"
                type="text"
                value={region()}
                onInput={(e) => setRegion(e.currentTarget.value)}
                placeholder={evalCountry() === 'ES' ? 'MAD' : evalCountry() === 'UK' ? 'EWN' : ''}
              />
            </div>
          </div>
          <div class="str-actions">
            <button type="submit" class="str-btn str-btn-primary" disabled={evalLoading()}>
              {evalLoading() ? '评估中…' : '运行策略评估'}
            </button>
          </div>
        </form>

        <Show when={evalError()}>
          {(msg) => (
            <div class="str-error" role="alert">
              {msg()}
            </div>
          )}
        </Show>

        <Show when={baseline()}>
          {(b) => (
            <div class="str-baseline">
              <h3 class="str-h3">基线税负</h3>
              <div class="str-baseline-grid">
                <div>
                  <span class="str-stat-label">国家</span>
                  <span class="str-stat-val">
                    {COUNTRY_FLAGS[b().country]} {COUNTRY_META[b().country].label}
                  </span>
                </div>
                <div>
                  <span class="str-stat-label">年收入</span>
                  <span class="str-stat-val">{eur.format(b().grossIncome)}</span>
                </div>
                <div>
                  <span class="str-stat-label">应纳税额</span>
                  <span class="str-stat-val">{eur.format(b().taxOwed)}</span>
                </div>
                <div>
                  <span class="str-stat-label">有效税率</span>
                  <span class="str-stat-val">{pct(b().effectiveRate)}</span>
                </div>
                <div>
                  <span class="str-stat-label">边际税率</span>
                  <span class="str-stat-val">{pct(b().marginalRate)}</span>
                </div>
              </div>
            </div>
          )}
        </Show>

        <Show when={evaluations().length > 0}>
          <div class="str-eval-list">
            <h3 class="str-h3">策略排序</h3>
            <For each={evaluations()}>
              {(ev) => (
                <div class="str-eval-card" classList={{ 'str-eval-inapplicable': !ev.applicable }}>
                  <div class="str-eval-head">
                    <div>
                      <span class="str-eval-title">{ev.titleZh}</span>
                      <span class="str-eval-meta">
                        {ev.tier} · {ev.category}
                      </span>
                    </div>
                    <span
                      class="str-eval-badge"
                      classList={{
                        'str-eval-applicable': ev.applicable,
                        'str-eval-not-applicable': !ev.applicable,
                      }}
                    >
                      {ev.applicable ? '可适用' : '不适用'}
                    </span>
                  </div>
                  <p class="str-eval-reason">{ev.reason}</p>
                  <div class="str-eval-foot">
                    <span class="str-eval-savings">
                      {ev.estimatedSavingsEur !== null && ev.estimatedSavingsEur !== undefined
                        ? `预计节税 ${eur.format(ev.estimatedSavingsEur)}`
                        : '预计节税 N/A'}
                    </span>
                    <span class="str-eval-confidence">
                      置信度 {(ev.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <Show
                    when={hasProAccess()}
                    fallback={
                      <p class="str-eval-locked">
                        🔒 订阅解锁完整行动步骤与法条引用
                        <button
                          type="button"
                          class="str-eval-locked-btn"
                          onClick={() => {
                            window.location.hash = 'account';
                          }}
                        >
                          升级订阅
                        </button>
                      </p>
                    }
                  >
                    <Show when={(ev.actionSteps?.length ?? 0) > 0}>
                      <ul class="str-ai-steps">
                        <For each={ev.actionSteps}>{(step) => <li>{step}</li>}</For>
                      </ul>
                    </Show>
                    <Show when={(ev.citations?.length ?? 0) > 0}>
                      <p class="str-eval-cite">
                        引用:{' '}
                        {(ev.citations as Array<{ source?: string }>)
                          .map((cit) =>
                            typeof cit === 'string' ? cit : (cit.source ?? JSON.stringify(cit)),
                          )
                          .join(' · ')}
                      </p>
                    </Show>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* F4 paywall: full AI strategy report (Pro) */}
        <div class="str-ai-section">
          <div class="str-ai-head">
            <h3 class="str-h3">完整 AI 策略报告</h3>
            <Show when={hasProAccess()}>
              <span class="str-ai-pro-badge">PRO</span>
            </Show>
          </div>
          <p class="str-ai-sub">
            在规则引擎排序之上，由 AI 补充 C 级创造性节税策略（含推理链、法条引用与置信度），
            并经计算器交叉验证。
          </p>

          <Show
            when={hasProAccess()}
            fallback={
              <div class="str-ai-locked">
                <PaywallCard
                  me={me() ?? null}
                  title="完整 AI 策略报告"
                  bullets={[
                    'AI 生成的 C 级节税策略（每份报告最多 3 条）',
                    '推理链 + 法条引用 + 计算器交叉验证',
                    'H1-H6 六层反幻觉验证管线',
                  ]}
                />
              </div>
            }
          >
            <button
              type="button"
              class="str-btn str-btn-primary"
              onClick={() => void onAiRecommend()}
              disabled={aiLoading()}
            >
              {aiLoading() ? '生成中…' : '生成 AI 建议'}
            </button>
            <Show when={aiError()}>
              {(msg) => (
                <div class="str-error" role="alert">
                  {msg()}
                </div>
              )}
            </Show>
            <Show when={aiRecs().length > 0}>
              <div class="str-ai-list">
                <For each={aiRecs()}>
                  {(rec) => (
                    <div class="str-eval-card">
                      <div class="str-eval-head">
                        <div>
                          <span class="str-eval-title">{rec.titleZh}</span>
                          <span class="str-eval-meta">{rec.tier} · AI 生成</span>
                        </div>
                        <span class="str-eval-badge str-eval-applicable">AI 建议</span>
                      </div>
                      <p class="str-eval-reason">{rec.reasoning}</p>
                      <Show when={rec.actionSteps.length > 0}>
                        <ul class="str-ai-steps">
                          <For each={rec.actionSteps}>{(step) => <li>{step}</li>}</For>
                        </ul>
                      </Show>
                      <div class="str-eval-foot">
                        <span class="str-eval-savings">
                          {rec.estimatedSavingsEur !== null
                            ? `预计节税 ${eur.format(rec.estimatedSavingsEur)}`
                            : '预计节税 N/A（需个案分析）'}
                        </span>
                        <span class="str-eval-confidence">
                          置信度 {(rec.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <Show when={rec.citations.length > 0}>
                        <p class="str-eval-cite">引用: {rec.citations.join(' · ')}</p>
                      </Show>
                    </div>
                  )}
                </For>
                <Show when={aiUsage()}>
                  <p class="str-ai-usage">
                    本次生成成本 ${(aiUsage()?.cost ?? 0).toFixed(4)} · {recsDisclaimer()}
                  </p>
                </Show>
              </div>
            </Show>
          </Show>
        </div>
      </section>
    </div>
  );
};

function recsDisclaimer(): string {
  return '所有 AI 建议均带 [AI建议·未经确定性验证] 标注，请咨询税务顾问后采用。';
}

export default StrategiesPage;

const styles = `${paywallStyles}
.str-hero { margin: 0 0 1.5rem; }
.str-h1 {
  font-size: clamp(1.5rem, 3vw, 2rem);
  line-height: 1.2;
  margin: 0 0 0.5rem;
  color: #111827;
  letter-spacing: -0.02em;
}
.str-sub {
  margin: 0;
  color: #6b7280;
  font-size: 0.95rem;
  max-width: 70ch;
  line-height: 1.5;
}

.str-panel {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.str-section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.str-h2 {
  font-size: 1.125rem;
  font-weight: 700;
  color: #111827;
  margin: 0;
}
.str-h3 {
  font-size: 0.9rem;
  font-weight: 700;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 1.25rem 0 0.75rem;
}

.str-filters { display: flex; gap: 0.75rem; flex-wrap: wrap; }
.str-select {
  font-family: inherit;
  font-size: 0.875rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
  color: #111827;
  min-width: 140px;
}

.str-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}
.str-field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.str-field label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #374151;
}
.str-input {
  font-family: inherit;
  font-size: 0.9rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
  color: #111827;
  transition: border-color 150ms, box-shadow 150ms;
}
.str-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

.str-eval-locked {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: #6b7280;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.str-eval-locked-btn {
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  background: #2563eb;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  padding: 0.25rem 0.75rem;
  cursor: pointer;
  transition: background-color 150ms;
}
.str-eval-locked-btn:hover { background: #1d4ed8; }
.str-ai-section {
  margin-top: 1.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid #f3f4f6;
}
.str-ai-head { display: flex; align-items: center; gap: 0.5rem; }
.str-ai-head .str-h3 { margin: 0; }
.str-ai-pro-badge {
  background: #eff6ff;
  color: #2563eb;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
}
.str-ai-sub {
  margin: 0.5rem 0 1rem;
  color: #6b7280;
  font-size: 0.875rem;
  line-height: 1.5;
  max-width: 70ch;
}
.str-ai-locked { margin-top: 0.5rem; }
.str-ai-list { margin-top: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
.str-ai-steps {
  margin: 0.5rem 0 0;
  padding-left: 1.25rem;
  font-size: 0.875rem;
  color: #374151;
  line-height: 1.6;
}
.str-ai-steps li { margin-bottom: 0.25rem; }
.str-ai-usage {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: #9ca3af;
}
.str-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.25rem;
}
.str-btn {
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
.str-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.str-btn-primary { background: #2563eb; color: #ffffff; }
.str-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.str-btn-primary:active:not(:disabled) { transform: translateY(1px); }

.str-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  margin-top: 1rem;
  font-size: 0.875rem;
}

.str-empty {
  text-align: center;
  padding: 2rem 1rem;
  color: #6b7280;
  background: #f9fafb;
  border: 1px dashed #e5e7eb;
  border-radius: 8px;
  margin: 1rem 0 0;
}

.str-skel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.75rem;
}
.str-skel-card {
  height: 140px;
  background: linear-gradient(90deg, #f3f4f6 0%, #e5e7eb 50%, #f3f4f6 100%);
  background-size: 200% 100%;
  animation: str-shimmer 1.4s infinite;
  border-radius: 10px;
}
@keyframes str-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.str-catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 0.75rem;
}
.str-catalog-card {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 1rem;
  transition: transform 150ms, box-shadow 150ms;
}
.str-catalog-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
.str-catalog-meta {
  display: flex;
  gap: 0.375rem;
  margin-bottom: 0.5rem;
}
.str-tier,
.str-category {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.4rem;
  border-radius: 999px;
}
.str-tier { background: #eff6ff; color: #1d4ed8; }
.str-category { background: #f3f4f6; color: #374151; }
.str-catalog-title {
  font-size: 1rem;
  font-weight: 700;
  color: #111827;
  margin: 0 0 0.375rem;
}
.str-catalog-desc {
  font-size: 0.85rem;
  color: #4b5563;
  margin: 0 0 0.5rem;
  line-height: 1.5;
}
.str-catalog-elig {
  font-size: 0.8rem;
  color: #374151;
  margin: 0 0 0.25rem;
}
.str-catalog-cite {
  font-size: 0.75rem;
  color: #6b7280;
  margin: 0;
  font-style: italic;
}

.str-baseline {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 10px;
  padding: 1rem;
  margin-top: 1.25rem;
}
.str-baseline-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.75rem;
}
.str-baseline-grid > div { display: flex; flex-direction: column; gap: 0.125rem; }
.str-stat-label {
  font-size: 0.7rem;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}
.str-stat-val {
  font-size: 1rem;
  font-weight: 700;
  color: #111827;
}

.str-eval-list { margin-top: 1rem; }
.str-eval-card {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 1rem;
  margin-bottom: 0.75rem;
  background: #ffffff;
}
.str-eval-inapplicable { opacity: 0.7; background: #f9fafb; }
.str-eval-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.str-eval-title {
  font-size: 1rem;
  font-weight: 700;
  color: #111827;
  display: block;
}
.str-eval-meta {
  font-size: 0.75rem;
  color: #6b7280;
}
.str-eval-badge {
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.str-eval-applicable { background: #d1fae5; color: #065f46; }
.str-eval-not-applicable { background: #f3f4f6; color: #6b7280; }
.str-eval-reason {
  font-size: 0.875rem;
  color: #374151;
  margin: 0 0 0.5rem;
  line-height: 1.5;
}
.str-eval-foot {
  display: flex;
  gap: 1rem;
  font-size: 0.8rem;
  color: #6b7280;
  margin-bottom: 0.25rem;
}
.str-eval-savings { font-weight: 600; color: #059669; }
.str-eval-confidence { font-weight: 600; }
.str-eval-cite {
  font-size: 0.75rem;
  color: #9ca3af;
  margin: 0;
  font-style: italic;
}
`;
