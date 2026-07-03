export const onboardingStyles = `
.ob-shell { max-width: 720px; margin: 0 auto; }
.ob-hero { margin: 0 0 1.5rem; }
.ob-kicker { margin: 0 0 0.375rem; color: #2563eb; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
.ob-h1 { font-size: clamp(1.5rem, 3vw, 2rem); line-height: 1.2; margin: 0 0 0.5rem; color: #111827; letter-spacing: -0.02em; }
.ob-sub { margin: 0 0 1rem; color: #6b7280; font-size: 0.95rem; max-width: 70ch; line-height: 1.5; }
.ob-progress { height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; }
.ob-progress-fill { height: 100%; background: #2563eb; transition: width 150ms; }
.ob-panel { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.ob-success { background: #ecfdf5; color: #065f46; border-color: #d1fae5; font-weight: 600; }
.ob-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; padding: 0.875rem 1rem; border-radius: 8px; margin-bottom: 1rem; }
.ob-h2 { font-size: 1.125rem; font-weight: 700; color: #111827; margin: 0 0 1rem; }
.ob-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; }
.ob-chip-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.5rem; margin-top: 1rem; }
.ob-field { display: flex; flex-direction: column; gap: 0.375rem; font-size: 0.8rem; font-weight: 600; color: #374151; }
.ob-year { max-width: 180px; margin-bottom: 1rem; }
.ob-input { font-family: inherit; font-size: 0.9rem; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 8px; background: #ffffff; color: #111827; transition: border-color 150ms, box-shadow 150ms; }
.ob-input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15); }
.ob-check { display: flex; align-items: center; gap: 0.5rem; color: #374151; font-size: 0.9rem; line-height: 1.5; }
.ob-income-row { border-bottom: 1px solid #f3f4f6; padding-bottom: 1rem; margin-bottom: 1rem; }
.ob-footer { display: flex; justify-content: flex-end; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
@media (max-width: 480px) {
  .ob-footer { flex-direction: column; align-items: stretch; }
  .ob-footer .ob-btn { width: 100%; justify-content: center; }
}
.ob-btn { font-family: inherit; font-size: 0.9rem; font-weight: 600; border-radius: 8px; cursor: pointer; min-height: 40px; padding: 0 1rem; border: 1.5px solid transparent; transition: background-color 150ms, color 150ms, border-color 150ms, transform 150ms; }
.ob-btn:disabled { cursor: not-allowed; opacity: 0.5; }
.ob-btn-primary { background: #2563eb; color: #ffffff; }
.ob-btn-primary:hover:not(:disabled) { background: #1d4ed8; }
.ob-btn-primary:active:not(:disabled) { transform: translateY(1px); }
.ob-btn-outline { background: #ffffff; color: #2563eb; border-color: #2563eb; }
.ob-btn-outline:hover:not(:disabled) { background: #eff6ff; }
.ob-btn-ghost { background: transparent; color: #374151; border-color: #e5e7eb; }
.ob-btn-ghost:hover:not(:disabled) { background: #f3f4f6; }
`;
