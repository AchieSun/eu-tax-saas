import { For } from 'solid-js';
import { ONBOARDING_INCOME_TYPES, type OnboardingCountry, type OnboardingIncomeType } from './api';
import type { Step3DraftRow } from './helpers';

const COUNTRY_LABELS: Record<OnboardingCountry, string> = {
  DE: '德国 DE',
  NL: '荷兰 NL',
  PT: '葡萄牙 PT',
  ES: '西班牙 ES',
  UK: '英国 UK',
};

const INCOME_LABELS: Record<OnboardingIncomeType, string> = {
  salary: '工资薪金',
  self_employed: '自由职业',
  dividends: '股息',
  interest: '利息',
  rental: '租金',
  capital_gains: '资本利得',
  crypto: '加密资产',
  other: '其他',
};

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
          label="年收入"
          updateIncome={props.updateIncome}
        />
        <TextInput
          row={props.row}
          field="currency"
          label="币种"
          maxLength={3}
          updateIncome={props.updateIncome}
        />
        <TextInput
          row={props.row}
          field="withholdingTax"
          label="已预扣税"
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
      收入类型
      <select
        id={`ob-type-${props.row.id}`}
        class="ob-input"
        value={props.row.incomeType}
        onChange={(e) =>
          props.updateIncome(rowId(props.row), { incomeType: e.currentTarget.value })
        }
      >
        <For each={ONBOARDING_INCOME_TYPES}>
          {(incomeType) => <option value={incomeType}>{INCOME_LABELS[incomeType]}</option>}
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
      国家
      <select
        id={`ob-country-${props.row.id}`}
        class="ob-input"
        value={props.row.country}
        onChange={(e) => props.updateIncome(rowId(props.row), { country: e.currentTarget.value })}
      >
        <For each={props.countries}>
          {(country) => <option value={country}>{COUNTRY_LABELS[country]}</option>}
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
