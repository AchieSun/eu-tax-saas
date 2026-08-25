import { For } from 'solid-js';
import { t } from '../../i18n';
import { ONBOARDING_INCOME_TYPES, type OnboardingCountry, type OnboardingIncomeType } from './api';
import type { Step3DraftRow } from './helpers';

const countryLabel = (country: OnboardingCountry): string =>
  `${t(`country.${country}`)} ${country}`;

const incomeLabel = (incomeType: OnboardingIncomeType): string =>
  t(`onboarding.income.${incomeType}`);

interface IncomeRowProps {
  readonly row: Step3DraftRow;
  readonly countries: readonly OnboardingCountry[];
  readonly updateIncome: (id: string, patch: Partial<Step3DraftRow>) => void;
}

export function IncomeRow(props: IncomeRowProps) {
  return (
    <div class="ob-income-row">
      <div class="ob-grid">
        <IncomeSelect row={props.row} updateIncome={props.updateIncome} />
        <CountrySelect
          row={props.row}
          countries={props.countries}
          updateIncome={props.updateIncome}
        />
        <TextInput
          row={props.row}
          field="amountAnnual"
          label={t('onboarding.income.amountAnnual')}
          updateIncome={props.updateIncome}
        />
        <TextInput
          row={props.row}
          field="currency"
          label={t('onboarding.income.currency')}
          maxLength={3}
          updateIncome={props.updateIncome}
        />
        <TextInput
          row={props.row}
          field="withholdingTax"
          label={t('onboarding.income.withholdingTax')}
          updateIncome={props.updateIncome}
        />
      </div>
    </div>
  );
}

interface RowProps {
  readonly row: Step3DraftRow;
  readonly updateIncome: (id: string, patch: Partial<Step3DraftRow>) => void;
}

function rowId(row: Step3DraftRow): string {
  return row.id ?? '';
}

function IncomeSelect(props: RowProps) {
  return (
    <label class="ob-field" for={`ob-type-${props.row.id}`}>
      {t('onboarding.income.type')}
      <select
        id={`ob-type-${props.row.id}`}
        class="ob-input"
        value={props.row.incomeType}
        onChange={(e) =>
          props.updateIncome(rowId(props.row), { incomeType: e.currentTarget.value })
        }
      >
        <For each={ONBOARDING_INCOME_TYPES}>
          {(incomeType) => <option value={incomeType}>{incomeLabel(incomeType)}</option>}
        </For>
      </select>
    </label>
  );
}

interface CountrySelectProps extends RowProps {
  readonly countries: readonly OnboardingCountry[];
}

function CountrySelect(props: CountrySelectProps) {
  return (
    <label class="ob-field" for={`ob-country-${props.row.id}`}>
      {t('onboarding.income.country')}
      <select
        id={`ob-country-${props.row.id}`}
        class="ob-input"
        value={props.row.country}
        onChange={(e) => props.updateIncome(rowId(props.row), { country: e.currentTarget.value })}
      >
        <For each={props.countries}>
          {(country) => <option value={country}>{countryLabel(country)}</option>}
        </For>
      </select>
    </label>
  );
}

interface TextInputProps extends RowProps {
  readonly field: 'amountAnnual' | 'currency' | 'withholdingTax';
  readonly label: string;
  readonly maxLength?: number;
}

function TextInput(props: TextInputProps) {
  return (
    <label class="ob-field" for={`ob-${props.field}-${props.row.id}`}>
      {props.label}
      <input
        id={`ob-${props.field}-${props.row.id}`}
        class="ob-input"
        inputmode={props.field === 'currency' ? undefined : 'decimal'}
        maxlength={props.maxLength}
        value={props.row[props.field]}
        onInput={(e) =>
          props.updateIncome(rowId(props.row), {
            [props.field]:
              props.field === 'currency'
                ? e.currentTarget.value.toUpperCase()
                : e.currentTarget.value,
          })
        }
      />
    </label>
  );
}
