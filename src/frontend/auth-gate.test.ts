/**
 * auth-gate tests — SPA session gate.
 *
 * Covers the four branches of checkSession():
 *   - 401        → redirect to /sign-in?next=<current hash>, return false
 *   - 200        → return true (shell may mount)
 *   - network    → fail open, return true
 *   - hash       → preserved in the next parameter
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSession } from './auth-gate';

function stubWindowWithLocation(hash: string, replace: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('window', {
    location: { hash, replace },
  });
}

describe('checkSession (SPA auth gate)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('redirects to /sign-in and returns false on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 401 } as Response);
    const replace = vi.fn();
    stubWindowWithLocation('#strategies', replace);

    const result = await checkSession();

    expect(result).toBe(false);
    expect(replace).toHaveBeenCalledWith('/sign-in?next=%2Fapp%23strategies');
  });

  it('returns true and does not redirect when authenticated (200)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 200 } as Response);
    const replace = vi.fn();
    stubWindowWithLocation('', replace);

    const result = await checkSession();

    expect(result).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });

  it('fails open (returns true) on network errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const replace = vi.fn();
    stubWindowWithLocation('', replace);

    const result = await checkSession();

    expect(result).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });

  it('encodes the next param with the current hash tab', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 401 } as Response);
    const replace = vi.fn();
    stubWindowWithLocation('#strategies', replace);

    await checkSession();

    const next = (replace.mock.calls[0] as [string])[0];
    expect(next.startsWith('/sign-in?next=')).toBe(true);
    expect(decodeURIComponent(next)).toContain('/app#strategies');
  });
});
