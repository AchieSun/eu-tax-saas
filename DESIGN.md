# EU Tax SaaS Design System

## 1. Atmosphere & Identity

EU Tax SaaS uses a light operational SaaS interface: quiet, dense enough for tax workflows, and optimized for Chinese-first copy with English feature labels where useful. The signature is a restrained white-card command center: clear panels, muted gray metadata, blue CTAs, and status color only when it communicates state. The current implementation has no shared component library; page code uses SolidJS inline styles plus a page-local embedded `<style>` string.

## 2. Color

### Palette

| Role | Token | Light | Usage |
| --- | --- | --- | --- |
| Surface / card | `--surface-card` | `#ffffff` | Cards, panels, inputs |
| Surface / subtle | `--surface-subtle` | `#f9fafb` | Empty states, drawers, muted panels |
| Surface / soft | `--surface-soft` | `#f3f4f6` | Secondary buttons, skeletons, soft dividers |
| Text / primary | `--text-primary` | `#111827` | Headings, values, primary labels |
| Text / secondary | `--text-secondary` | `#374151` | Form labels, body secondary copy |
| Text / muted | `--text-muted` | `#6b7280` | Captions, subtitles, helper copy |
| Text / faint | `--text-faint` | `#9ca3af` | Low-priority citations |
| Border / default | `--border-default` | `#e5e7eb` | Cards, tabs, dividers |
| Border / soft | `--border-soft` | `#f3f4f6` | Internal list separators |
| Border / input | `--border-input` | `#d1d5db` | Inputs and selects |
| Accent / primary | `--accent-primary` | `#2563eb` | Primary buttons, links, active tabs, focus border |
| Accent / hover | `--accent-hover` | `#1d4ed8` | Primary hover state |
| Accent / tint | `--accent-tint` | `#eff6ff` | Outline hover, active segmented controls, blue badges |
| Success / fg | `--success-fg` | `#059669` | Positive values, success button |
| Success / hover | `--success-hover` | `#047857` | Success button hover |
| Success / bg | `--success-bg` | `#ecfdf5` | Health pill background |
| Success / soft | `--success-soft` | `#d1fae5` | Success badge background |
| Success / strong | `--success-strong` | `#065f46` | Success badge text |
| Warning / fg | `--warning-fg` | `#92400e` | Warning text |
| Warning / bg | `--warning-bg` | `#fef3c7` | Warning inline callout |
| Warning / soft | `--warning-soft` | `#fffbeb` | Warning panel background |
| Warning / border | `--warning-border` | `#fde68a` | Warning panel border |
| Warning / dark | `--warning-dark` | `#78350f` | Warning list text |
| Danger / fg | `--danger-fg` | `#991b1b` | Error text |
| Danger / bg | `--danger-bg` | `#fef2f2` | Error banner background |
| Danger / border | `--danger-border` | `#fecaca` | Error banner border |
| Danger / button | `--danger-button` | `#dc2626` | Destructive button |
| Danger / hover | `--danger-hover` | `#b91c1c` | Destructive hover |

### Rules

- Use blue only for interactive actions, focus, active navigation, or informational badges.
- Use status palettes only for real state: success, warning, danger, or pending/disabled.
- Do not introduce new hex values in product pages before adding them here.

## 3. Typography

### Font Stack

- Primary: `system-ui, -apple-system, sans-serif`.
- Mono: not currently used.
- Serif: not used.

### Scale

| Level | Size | Weight | Line Height / Tracking | Usage |
| --- | --- | --- | --- | --- |
| Page title | `clamp(1.5rem, 3vw, 2rem)` or `1.5rem` | 700 | `1.2`, `-0.02em` when clamped | Page headers |
| Section title | `1.125rem` | 700 | default | Panel headings, result titles |
| Card value | `1.5rem` | 700 | default | Dashboard metrics |
| Sub-value | `1.25rem` | 700 | default | Day counts, icons |
| Body | `1rem` | 400 / 700 | `1.5` to `1.6` | General copy and card titles |
| Body compact | `0.95rem` | 400 / 600 | `1.5` | Subtitles, dashboard list items |
| Form / button | `0.9rem` | 600 for buttons | default | Inputs and controls |
| Small | `0.875rem` | 400 / 600 / 700 | `1.5` | Helper text, card labels |
| Micro | `0.8rem` | 600 / 700 | default | Field labels, compact metadata |
| Caption | `0.75rem` | 600 / 700 | tracking `0.03em` to `0.05em` | Badges, citations |
| Tiny badge | `0.7rem` | 700 | uppercase tracking `0.04em` | Dense status badges |

### Rules

- Body and helper text should not go below `0.8rem` except dense badges/citations.
- Uppercase micro-labels use muted gray and letter spacing between `0.025em` and `0.05em`.
- Chinese labels are concise; English in parentheses is acceptable for feature names.

## 4. Spacing & Layout

### Base Unit

Spacing follows a 4px-derived rhythm, expressed in rem in the current code.

| Token | Value | Existing usage |
| --- | --- | --- |
| `--space-1` | `0.25rem` | Tight inline rhythm |
| `--space-1-5` | `0.375rem` | Label-to-input gap, compact badge padding |
| `--space-2` | `0.5rem` | Field gaps, list item rhythm |
| `--space-2-5` | `0.625rem` | Tab padding, compact cells |
| `--space-3` | `0.75rem` | Button groups, metadata gaps |
| `--space-3-5` | `0.875rem` | Compact item padding |
| `--space-4` | `1rem` | Default panel internal gaps |
| `--space-5` | `1.25rem` | Dashboard card padding, form action top margin |
| `--space-6` | `1.5rem` | Page section spacing, panel horizontal padding |
| `--space-8` | `2rem` | Empty state vertical padding |
| `--space-12` | `3rem` | App status drawer top separation |

### Grid

- App max width: `1200px`.
- Dashboard content max width: `720px`.
- Form grids use `repeat(auto-fit, minmax(160px, 1fr))`, `repeat(auto-fit, minmax(180px, 1fr))`, or `repeat(auto-fit, minmax(220px, 1fr))` depending on control density.
- Dashboard card grid starts single-column, then switches at `640px` to `repeat(2, 1fr)`.

### Rules

- Keep pages mobile-first and let grids auto-fit before adding custom breakpoints.
- Prefer one-column forms on narrow screens and wrap action rows.
- Use `max-width: 720px; margin: 0 auto` for focused workflow pages.

## 5. Components

### App Tab

- **Structure**: `<nav class="app-tabs" aria-label="主导航">` with `<button class="app-tab">`.
- **Spacing**: gap `0.25rem`; button padding `0.625rem 1rem`; nav bottom margin `1.5rem`.
- **States**: default muted text, hover primary text, active blue text with `3px` bottom border, `aria-pressed` on each tab.
- **Motion**: `color 150ms, border-color 150ms`.

### Panel / Card

- **Structure**: section/article/div with white background, default border, `12px` radius.
- **Spacing**: standard padding `1.25rem`; form-heavy panels use `1.25rem 1.5rem`.
- **Depth**: dashboard cards use `0 1px 2px 0 rgba(0, 0, 0, 0.03)`; full workflow panels use `0 1px 3px rgba(0,0,0,0.05)`.
- **States**: static by default. Catalog cards may lift on hover with `translateY(-2px)` and `0 4px 12px rgba(0,0,0,0.06)`.

### Button

- **Structure**: native `<button type="button|submit">` with page prefix class and variant class.
- **Base**: inherited font, `0.9rem`, weight 600, `8px` radius, min-height `40px`, padding `0 1rem`, transparent `1.5px` border.
- **Variants**: primary blue, secondary gray, outline blue, ghost, success, danger.
- **States**: disabled uses `cursor: not-allowed; opacity: 0.5`; primary/outline/ghost hover use tokenized background changes; active may `translateY(1px)`.
- **Motion**: `background-color 150ms, color 150ms, border-color 150ms, transform 150ms`.

### Form Field

- **Structure**: wrapper with label and input/select/textarea.
- **Label**: `0.8rem`, weight 600, `#374151`.
- **Control**: inherited font, `0.9rem`, padding `0.5rem 0.75rem`, `8px` radius, white background, `#d1d5db` border.
- **Focus**: no default outline, blue border, `0 0 0 3px rgba(37, 99, 235, 0.15)`.
- **Accessibility**: every control needs a stable `id` and matching `label for`.

### CTA Link

- **Structure**: inline anchor.
- **Style**: `display: inline-block`, margin-top `0.75rem`, `0.875rem`, blue, weight 600, no underline.
- **Usage**: dashboard cards and empty states that jump to app tabs or feature sections.

### Error Banner

- **Structure**: container with `role="alert"` when user-actionable.
- **Style**: `#fef2f2` background, `#fecaca` border, `#991b1b` text, `8px` radius, `0.75rem 1rem` or `0.875rem 1rem` padding.
- **Actions**: optional ghost clear button aligned with flex wrap.

### Empty State

- **Structure**: paragraph or div.
- **Style**: muted text; for full panels use centered `2rem 1rem`, `#f9fafb` background, dashed `#e5e7eb` border, `8px` radius.
- **Copy**: explain the missing data and provide the next action.

### Badge / Pill

- **Structure**: inline span.
- **Style**: `999px` radius, uppercase for status badges, `0.7rem` to `0.75rem`, weight 700, compact horizontal padding.
- **Usage**: status, country/jurisdiction chips, health pill.

### Progress Bar

- **Structure**: outer track plus inner fill.
- **Track**: height `6px`, `#e5e7eb`, `3px` radius, overflow hidden.
- **Fill**: blue, width percentage from state.
- **Usage**: dashboard filing completeness and onboarding progress.

## 6. Motion & Interaction

| Type | Duration | Property | Usage |
| --- | --- | --- | --- |
| Micro | `150ms` | `color`, `background-color`, `border-color`, `box-shadow`, `transform` | Buttons, tabs, focus, card hover |
| Loading shimmer | `1.4s infinite` | `background-position` | Skeleton rows/cards |

Rules:

- Animate only paint/composite-friendly properties already used in the project.
- Keep interaction motion purposeful: active button press, focus ring, hover affordance, loading shimmer.
- Do not add decorative animation to non-interactive elements.

## 7. Depth & Surface

### Strategy

Depth strategy is mixed but restrained: white panels separated by borders, with low-opacity shadows only for cards/panels that need elevation.

| Level | Value | Usage |
| --- | --- | --- |
| Dashboard subtle | `0 1px 2px 0 rgba(0, 0, 0, 0.03)` | Dashboard cards |
| Panel subtle | `0 1px 3px rgba(0,0,0,0.05)` | Workflow panels |
| Hover lift | `0 4px 12px rgba(0,0,0,0.06)` | Catalog card hover |
| Focus ring | `0 0 0 3px rgba(37, 99, 235, 0.15)` | Inputs/selects |

Rules:

- Default separation is a border, not a heavy shadow.
- Keep shadows subtle and functional; no decorative glow for current operational pages.
- Use `10px` radius for nested cards and `12px` for top-level panels.

## 8. Accessibility

- Top-level tabs use native buttons, `aria-pressed`, and a labeled nav.
- Form controls must use real labels and stable `id` values.
- Error banners should use `role="alert"` when they report a failed user action.
- Loading regions should use plain text or `aria-busy` when skeletons are present.
- The project currently relies on browser default focus for tabs/buttons and custom blue focus rings for form controls; custom focus styling for every interactive element is accepted debt.
- Emoji are currently used as lightweight visual markers in product copy; do not introduce emoji-only controls. Text labels remain mandatory.

## 9. File Organization

- Page components live under `src/frontend/pages/<Name>Page.tsx`.
- Page-specific API clients live under `src/frontend/pages/<feature>/api.ts`.
- Tests sit beside the page or API client: `*.test.tsx` / `*.test.ts`.
- Current style convention is page-local: inline style objects for one-offs and `const styles = \`...\`` for reusable selectors within the page.
- Do not introduce a global CSS framework or shared component library for MVP onboarding.

## 10. Adding a New Page

1. Create the API client first when the page talks to backend endpoints; test fetch shape and error mapping with Vitest fetch mocks.
2. Create the Solid page using existing card, form, button, error, empty, badge, and progress patterns from this document.
3. Register the page in `App.tsx` by extending the `Tab` union, adding a tab button, and adding a `<Show>` branch.

Before shipping a page, run scoped Biome, `pnpm typecheck`, and relevant Vitest tests. If a new visual token is needed, add it to this file before using it.