import { type Component, Show, createEffect, createResource, createSignal } from 'solid-js';
import { OnboardingStepPanel } from './onboarding/StepPanel';
import {
  type OnboardingCountry,
  type OnboardingState,
  SUPPORTED_ONBOARDING_COUNTRIES,
  completeOnboarding,
  fetchOnboarding,
  saveOnboardingStep,
  skipOnboardingStep,
} from './onboarding/api';
import {
  type Step3DraftRow,
  buildStep3Payload,
  computeInitialStep,
  deriveVisibleCountries,
  numericField,
} from './onboarding/helpers';
import { onboardingStyles } from './onboarding/styles';

export { buildStep3Payload, computeInitialStep, deriveVisibleCountries };

const STEP_COUNT = 5;

function friendlyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const OnboardingPage: Component = () => {
  const [state, { mutate }] = createResource(fetchOnboarding);
  const [step, setStep] = createSignal(1);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [done, setDone] = createSignal(false);
  const [privacy, setPrivacy] = createSignal(false);
  const [nationality, setNationality] = createSignal('CN');
  const [primaryCountry, setPrimaryCountry] = createSignal<OnboardingCountry>('DE');
  const [countries, setCountries] = createSignal<readonly OnboardingCountry[]>(['DE']);
  const [taxYear, setTaxYear] = createSignal(2025);
  const [rowSeq, setRowSeq] = createSignal(2);
  const [incomeRows, setIncomeRows] = createSignal<readonly Step3DraftRow[]>([
    {
      id: 'income-1',
      incomeType: 'salary',
      country: 'DE',
      amountAnnual: '',
      currency: 'EUR',
      withholdingTax: '0',
    },
  ]);
  const [specialStatus, setSpecialStatus] = createSignal<
    Partial<Record<OnboardingCountry, string>>
  >({});
  const [daysEstimate, setDaysEstimate] = createSignal<Partial<Record<OnboardingCountry, string>>>(
    {},
  );

  createEffect(() => {
    const loaded = state();
    if (!loaded) return;
    setStep(computeInitialStep(loaded));
    setDone(loaded.complete);
    setPrivacy(loaded.privacyAcceptedAt !== null || loaded.complete);
    setCountries(deriveVisibleCountries(loaded));
  });

  const visibleCountries = () =>
    countries().length > 0 ? countries() : SUPPORTED_ONBOARDING_COUNTRIES;
  const progress = () => `${(step() / STEP_COUNT) * 100}%`;

  function toggleCountry(country: OnboardingCountry, checked: boolean) {
    setCountries((prev) => {
      if (checked && !prev.includes(country)) return [...prev, country];
      if (!checked && prev.length > 1) return prev.filter((item) => item !== country);
      return prev;
    });
  }

  function updateIncome(id: string, patch: Partial<Step3DraftRow>) {
    setIncomeRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addIncome() {
    const next = rowSeq();
    setRowSeq(next + 1);
    setIncomeRows((prev) => [
      ...prev,
      {
        id: `income-${next}`,
        incomeType: 'salary',
        country: visibleCountries()[0] ?? 'DE',
        amountAnnual: '',
        currency: 'EUR',
        withholdingTax: '0',
      },
    ]);
  }

  async function saveCurrent() {
    setError(null);
    setSaving(true);
    try {
      let updated: OnboardingState;
      switch (step()) {
        case 1:
          if (!privacy()) return;
          updated = await saveOnboardingStep(1, { acceptPrivacy: true });
          break;
        case 2:
          updated = await saveOnboardingStep(2, {
            nationality: nationality().trim().toUpperCase(),
            primaryCountry: primaryCountry(),
            countries: countries(),
          });
          break;
        case 3:
          updated = await saveOnboardingStep(3, buildStep3Payload(incomeRows(), taxYear()));
          break;
        case 4:
          updated = await saveOnboardingStep(4, { specialStatus: specialStatus() });
          break;
        default: {
          const daysEstimatePayload: Partial<Record<OnboardingCountry, number>> = {};
          for (const country of visibleCountries()) {
            const raw = daysEstimate()[country]?.trim();
            if (raw) daysEstimatePayload[country] = numericField(raw, 'daysEstimate');
          }
          await saveOnboardingStep(5, { daysEstimate: daysEstimatePayload });
          updated = await completeOnboarding();
          setDone(true);
        }
      }
      mutate(updated);
      setStep(computeInitialStep(updated));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function skipCurrent() {
    setError(null);
    setSaving(true);
    try {
      const updated = await skipOnboardingStep(step());
      mutate(updated);
      setStep(computeInitialStep(updated));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="ob-shell">
      <style>{onboardingStyles}</style>
      <header class="ob-hero">
        <p class="ob-kicker">W7 Onboarding</p>
        <h1 class="ob-h1">开始使用 (Onboarding)</h1>
        <p class="ob-sub">
          用 5 步建立你的跨境税务画像：隐私授权、国家范围、收入、特殊身份与停留天数。
        </p>
        <div class="ob-progress" aria-label={`步骤 ${step()} / ${STEP_COUNT}`}>
          <div class="ob-progress-fill" style={{ width: progress() }} />
        </div>
      </header>

      <Show when={error()}>
        {(message) => (
          <div class="ob-error" role="alert">
            ⚠️ {message()}
          </div>
        )}
      </Show>
      <Show when={state.loading}>
        <section class="ob-panel">加载 onboarding 状态…</section>
      </Show>
      <Show when={done()}>
        <section class="ob-panel ob-success">
          已完成初始化。你可以继续进入居民身份判定与税负测算。
        </section>
      </Show>

      <section class="ob-panel">
        <OnboardingStepPanel
          step={step()}
          privacy={privacy()}
          setPrivacy={setPrivacy}
          nationality={nationality()}
          setNationality={setNationality}
          primaryCountry={primaryCountry()}
          setPrimaryCountry={setPrimaryCountry}
          countries={countries()}
          toggleCountry={toggleCountry}
          taxYear={taxYear()}
          setTaxYear={setTaxYear}
          incomeRows={incomeRows()}
          updateIncome={updateIncome}
          addIncome={addIncome}
          specialStatus={specialStatus()}
          setSpecialStatus={setSpecialStatus}
          daysEstimate={daysEstimate()}
          setDaysEstimate={setDaysEstimate}
          visibleCountries={visibleCountries}
        />
      </section>

      <Show when={!done()}>
        <footer class="ob-footer">
          <button
            type="button"
            class="ob-btn ob-btn-ghost"
            disabled={saving() || step() <= 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            Back
          </button>
          <button
            type="button"
            class="ob-btn ob-btn-outline"
            disabled={saving() || step() >= STEP_COUNT}
            onClick={() => void skipCurrent()}
          >
            Skip
          </button>
          <button
            type="button"
            class="ob-btn ob-btn-primary"
            disabled={saving() || (step() === 1 && !privacy())}
            onClick={() => void saveCurrent()}
          >
            {saving() ? 'Saving…' : step() === STEP_COUNT ? 'Save & Complete' : 'Save'}
          </button>
        </footer>
      </Show>
    </div>
  );
};

export default OnboardingPage;
