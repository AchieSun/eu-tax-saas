/**
 * F6 CountryPalette — horizontal chip selector.
 *
 * The currently selected tool drives what `MonthGrid` will paint during a
 * drag stroke. The eraser is the 7th chip and yields `ERASE` (sentinel) so
 * the orchestrator can translate it into DELETE calls at save time.
 *
 * Visual: each chip uses the country's brand color as background. The active
 * chip wears a 3px outline ring + slight lift so it's unambiguous which
 * country the next drag will paint. Labels are locale-aware via the i18n
 * dictionary (calendar.country.*); colors stay static from COUNTRY_META.
 */

import { type Component, For } from 'solid-js';
import { t } from '../i18n';
import { COUNTRIES, COUNTRY_META, ERASE, type PaintTool } from './types';

interface Props {
  current: PaintTool;
  onChange: (tool: PaintTool) => void;
}

const CountryPalette: Component<Props> = (props) => {
  return (
    <div class="cal-palette" role="radiogroup" aria-label={t('calendar.palette.ariaLabel')}>
      <For each={COUNTRIES}>
        {(c) => {
          const meta = COUNTRY_META[c];
          const isActive = () => props.current === c;
          return (
            <button
              type="button"
              role="radio"
              aria-checked={isActive()}
              class={`cal-chip ${isActive() ? 'cal-chip-active' : ''}`}
              style={{
                'background-color': meta.bg,
                color: meta.fg,
              }}
              onClick={() => props.onChange(c)}
              title={t('calendar.palette.chipTitle', { label: t(`calendar.country.${c}`) })}
            >
              {t(`calendar.country.${c}`)}
            </button>
          );
        }}
      </For>
      <button
        type="button"
        role="radio"
        aria-checked={props.current === ERASE}
        class={`cal-chip cal-chip-erase ${props.current === ERASE ? 'cal-chip-active' : ''}`}
        onClick={() => props.onChange(ERASE)}
        title={t('calendar.palette.eraseTitle')}
      >
        {t('calendar.palette.erase')}
      </button>
    </div>
  );
};

export default CountryPalette;
