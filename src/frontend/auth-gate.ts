/**
 * auth-gate.ts — SPA session gate.
 *
 * The /app shell must not render for anonymous visitors. `checkSession`
 * probes GET /api/me (a cheap session echo, no dashboard fetch) and, on a
 * 401, redirects to /sign-in?next=… so the original hash tab survives the
 * round-trip. It returns `true` when the shell may mount.
 *
 * Separated from main.tsx so the redirect logic is unit-testable without a
 * DOM/render harness. main.tsx calls this before mounting the app.
 */

export async function checkSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.status === 401) {
      const next = encodeURIComponent(`/app${window.location.hash}`);
      window.location.replace(`/sign-in?next=${next}`);
      return false;
    }
    return true;
  } catch {
    // Network failure — fail open to the shell; per-page 401 handling
    // (e.g. Dashboard's unauthorized error) is the backstop.
    return true;
  }
}
