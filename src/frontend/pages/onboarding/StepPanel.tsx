import { For, Match, type Setter, Switch } from 'solid-js';
import { IncomeRow } from './IncomeRow';
import { type OnboardingCountry, SUPPORTED_ONBOARDING_COUNTRIES } from './api';
import { type Step3DraftRow, numericField, parseCountry } from './helpers';

const COUNTRY_LABELS: Record<OnboardingCountry, string> = {
  DE: '德国 DE',
  NL: '荷兰 NL',
  PT: '葡萄牙 PT',
  ES: '西班牙 ES',
  UK: '英国 UK',
};

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
        <h2 class="ob-h2">1. 隐私与数据使用</h2>
        <label class="ob-check">
          <input
            type="checkbox"
            checked={props.privacy}
            onChange={(e) => props.setPrivacy(e.currentTarget.checked)}
          />{' '}
          我同意仅为税务测算与申报准备使用这些资料。
        </label>
      </Match>
      <Match when={props.step === 2}>
        <h2 class="ob-h2">2. 国家范围</h2>
        <div class="ob-grid">
          <label class="ob-field" for="ob-nationality">
            国籍
            <input
              id="ob-nationality"
              class="ob-input"
              value={props.nationality}
              maxlength={2}
              onInput={(e) => props.setNationality(e.currentTarget.value.toUpperCase())}
            />
          </label>
          <label class="ob-field" for="ob-primary">
            主要国家
            <select
              id="ob-primary"
              class="ob-input"
              value={props.primaryCountry}
              onChange={(e) => props.setPrimaryCountry(parseCountry(e.currentTarget.value) ?? 'DE')}
            >
              <For each={SUPPORTED_ONBOARDING_COUNTRIES}>
                {(country) => <option value={country}>{COUNTRY_LABELS[country]}</option>}
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
                {COUNTRY_LABELS[country]}
              </label>
            )}
          </For>
        </div>
      </Match>
      <Match when={props.step === 3}>
        <h2 class="ob-h2">3. 收入概览</h2>
        <label class="ob-field ob-year" for="ob-year">
          纳税年度
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
          添加收入
        </button>
      </Match>
      <Match when={props.step === 4}>
        <h2 class="ob-h2">4. 特殊身份</h2>
        <div class="ob-grid">
          <For each={props.visibleCountries()}>
            {(country) => (
              <label class="ob-field" for={`ob-status-${country}`}>
                {COUNTRY_LABELS[country]}
                <input
                  id={`ob-status-${country}`}
                  class="ob-input"
                  placeholder="如 NHR、30% ruling"
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
        <h2 class="ob-h2">5. 预计停留天数</h2>
        <div class="ob-grid">
          <For each={props.visibleCountries()}>
            {(country) => (
              <label class="ob-field" for={`ob-days-${country}`}>
                {COUNTRY_LABELS[country]}
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
