import { For, Match, type Setter, Switch } from 'solid-js';
import { t } from '../../i18n';
import { IncomeRow } from './IncomeRow';
import { type OnboardingCountry, SUPPORTED_ONBOARDING_COUNTRIES } from './api';
import { type Step3DraftRow, numericField, parseCountry } from './helpers';

const countryLabel = (country: OnboardingCountry): string =>
  `${t(`country.${country}`)} ${country}`;

const YEARS = [2024, 2025, 2026, 2027, 2028, 2029, 2030] as const;

interface StepPanelProps {
  readonly step: number;
  readonly privacy: boolean;
  readonly setPrivacy: Setter<boolean>;
  readonly nationality: string;
  readonly setNationality: Setter<string>;
  readonly primaryCountry: OnboardingCountry;
  readonly setPrimaryCountry: Setter<OnboardingCountry>;
  readonly countries: readonly OnboardingCountry[];
  readonly toggleCountry: (country: OnboardingCountry, checked: boolean) => void;
  readonly taxYear: number;
  readonly setTaxYear: Setter<number>;
  readonly incomeRows: readonly Step3DraftRow[];
  readonly updateIncome: (id: string, patch: Partial<Step3DraftRow>) => void;
  readonly addIncome: () => void;
  readonly specialStatus: Partial<Record<OnboardingCountry, string>>;
  readonly setSpecialStatus: Setter<Partial<Record<OnboardingCountry, string>>>;
  readonly daysEstimate: Partial<Record<OnboardingCountry, string>>;
  readonly setDaysEstimate: Setter<Partial<Record<OnboardingCountry, string>>>;
  readonly visibleCountries: () => readonly OnboardingCountry[];
}

export function OnboardingStepPanel(props: StepPanelProps) {
  return (
    <Switch>
      <Match when={props.step === 1}>
        <h2 class="ob-h2">{t('onboarding.step1.title')}</h2>
        <label class="ob-check">
          <input
            type="checkbox"
            checked={props.privacy}
            onChange={(e) => props.setPrivacy(e.currentTarget.checked)}
          />{' '}
          {t('onboarding.step1.consent')}
        </label>
      </Match>
      <Match when={props.step === 2}>
        <h2 class="ob-h2">{t('onboarding.step2.title')}</h2>
        <div class="ob-grid">
          <label class="ob-field" for="ob-nationality">
            {t('onboarding.step2.nationality')}
            <input
              id="ob-nationality"
              class="ob-input"
              value={props.nationality}
              maxlength={2}
              onInput={(e) => props.setNationality(e.currentTarget.value.toUpperCase())}
            />
          </label>
          <label class="ob-field" for="ob-primary">
            {t('onboarding.step2.primaryCountry')}
            <select
              id="ob-primary"
              class="ob-input"
              value={props.primaryCountry}
              onChange={(e) => props.setPrimaryCountry(parseCountry(e.currentTarget.value) ?? 'DE')}
            >
              <For each={SUPPORTED_ONBOARDING_COUNTRIES}>
                {(country) => <option value={country}>{countryLabel(country)}</option>}
              </For>
            </select>
          </label>
        </div>
        <div class="ob-chip-grid">
          <For each={SUPPORTED_ONBOARDING_COUNTRIES}>
            {(country) => (
              <label class="ob-check">
                <input
                  type="checkbox"
                  checked={props.countries.includes(country)}
                  onChange={(e) => props.toggleCountry(country, e.currentTarget.checked)}
                />{' '}
                {countryLabel(country)}
              </label>
            )}
          </For>
        </div>
      </Match>
      <Match when={props.step === 3}>
        <h2 class="ob-h2">{t('onboarding.step3.title')}</h2>
        <label class="ob-field ob-year" for="ob-year">
          {t('onboarding.step3.taxYear')}
          <select
            id="ob-year"
            class="ob-input"
            value={String(props.taxYear)}
            onChange={(e) => props.setTaxYear(numericField(e.currentTarget.value, 'taxYear'))}
          >
            <For each={YEARS}>{(year) => <option value={String(year)}>{year}</option>}</For>
          </select>
        </label>
        <For each={props.incomeRows}>
          {(row) => (
            <IncomeRow
              row={row}
              countries={props.visibleCountries()}
              updateIncome={props.updateIncome}
            />
          )}
        </For>
        <button type="button" class="ob-btn ob-btn-outline" onClick={props.addIncome}>
          {t('onboarding.step3.addIncome')}
        </button>
      </Match>
      <Match when={props.step === 4}>
        <h2 class="ob-h2">{t('onboarding.step4.title')}</h2>
        <div class="ob-grid">
          <For each={props.visibleCountries()}>
            {(country) => (
              <label class="ob-field" for={`ob-status-${country}`}>
                {countryLabel(country)}
                <input
                  id={`ob-status-${country}`}
                  class="ob-input"
                  placeholder={t('onboarding.step4.placeholder')}
                  value={props.specialStatus[country] ?? ''}
                  onInput={(e) =>
                    props.setSpecialStatus((prev) => ({
                      ...prev,
                      [country]: e.currentTarget.value,
                    }))
                  }
                />
              </label>
            )}
          </For>
        </div>
      </Match>
      <Match when={props.step === 5}>
        <h2 class="ob-h2">{t('onboarding.step5.title')}</h2>
        <div class="ob-grid">
          <For each={props.visibleCountries()}>
            {(country) => (
              <label class="ob-field" for={`ob-days-${country}`}>
                {countryLabel(country)}
                <input
                  id={`ob-days-${country}`}
                  class="ob-input"
                  inputmode="numeric"
                  value={props.daysEstimate[country] ?? ''}
                  onInput={(e) =>
                    props.setDaysEstimate((prev) => ({ ...prev, [country]: e.currentTarget.value }))
                  }
                />
              </label>
            )}
          </For>
        </div>
      </Match>
    </Switch>
  );
}
