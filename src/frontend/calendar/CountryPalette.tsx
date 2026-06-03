/**
 * F6 CountryPalette — horizontal chip selector.
 *
 * The currently selected tool drives what `MonthGrid` will paint during a
 * drag stroke. The eraser is the 7th chip and yields `ERASE` (sentinel) so
 * the orchestrator can translate it into DELETE calls at save time.
 *
 * Visual: each chip uses the country's brand color as background. The active
 * chip wears a 3px outline ring + slight lift so it's unambiguous which
 * country the next drag will paint.
 */

import { type Component, For } from 'solid-js';
import { COUNTRIES, COUNTRY_META, ERASE, type PaintTool } from './types';

interface Props {
  current: PaintTool;
  onChange: (tool: PaintTool) => void;
}

const CountryPalette: Component<Props> = (props) => {
  return (
    <div class="cal-palette" role="radiogroup" aria-label="选择要标记的国家">
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
              title={`点击后拖动日历，把日期标记为 ${meta.label}`}
            >
              {meta.label}
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
        title="橡皮擦：拖动后将删除已标记的日期"
      >
        ✕ 清除
      </button>
    </div>
  );
};

export default CountryPalette;
