import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bindings, Variables } from '../index';
import { onboardingRoutes } from './onboarding';

const {
  state,
  getOnboardingStateMock,
  saveOnboardingStepMock,
  skipOnboardingStepMock,
  completeOnboardingMock,
} = vi.hoisted(() => {
  const state = {
    currentStep: 0,
    complete: false,
    privacyAcceptedAt: null,
    completedAt: null,
    draft: {},
  };
  return {
    state,
    getOnboardingStateMock: vi.fn(async () => state),
    saveOnboardingStepMock: vi.fn(async () => ({ ...state, currentStep: 2 })),
    skipOnboardingStepMock: vi.fn(async () => ({ ...state, currentStep: 3 })),
    completeOnboardingMock: vi.fn(async () => ({ ...state, currentStep: 5, complete: true })),
  };
});

vi.mock('../../db', () => ({
  createDb: vi.fn(() => ({})),
}));

vi.mock('../../onboarding/service', () => ({
  getOnboardingState: getOnboardingStateMock,
  saveOnboardingStep: saveOnboardingStepMock,
  skipOnboardingStep: skipOnboardingStepMock,
  completeOnboarding: completeOnboardingMock,
}));

function createTestApp(session: { user: { id: string } } | null) {
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('session', session ?? undefined);
    await next();
  });
  app.route('/api/onboarding', onboardingRoutes);
  return app;
}

function requestWithEnv(app: ReturnType<typeof createTestApp>, path: string, init?: RequestInit) {
  return app.request(path, init, { DB: {} } as Bindings);
}

describe('onboardingRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without a session', async () => {
    const app = createTestApp(null);
    const res = await requestWithEnv(app, '/api/onboarding');
    expect(res.status).toBe(401);
  });

  it('returns current onboarding state', async () => {
    const app = createTestApp({ user: { id: 'u-1' } });
    const res = await requestWithEnv(app, '/api/onboarding');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, state });
    expect(getOnboardingStateMock).toHaveBeenCalledWith({}, 'u-1');
  });

  it('rejects invalid step payloads', async () => {
    const app = createTestApp({ user: { id: 'u-1' } });
    const res = await requestWithEnv(app, '/api/onboarding/step', {
      method: 'POST',
      body: JSON.stringify({ step: 2, data: { primaryCountry: 'FR' } }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(saveOnboardingStepMock).not.toHaveBeenCalled();
  });

  it('saves a valid step payload', async () => {
    const app = createTestApp({ user: { id: 'u-1' } });
    const res = await requestWithEnv(app, '/api/onboarding/step', {
      method: 'POST',
      body: JSON.stringify({
        step: 2,
        data: { nationality: 'CN', primaryCountry: 'PT', countries: ['PT'] },
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, state: { currentStep: 2 } });
  });

  it('skips a step', async () => {
    const app = createTestApp({ user: { id: 'u-1' } });
    const res = await requestWithEnv(app, '/api/onboarding/skip', {
      method: 'POST',
      body: JSON.stringify({ step: 3 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(skipOnboardingStepMock).toHaveBeenCalledWith({}, 'u-1', 3);
  });

  it('completes onboarding', async () => {
    const app = createTestApp({ user: { id: 'u-1' } });
    const res = await requestWithEnv(app, '/api/onboarding/complete', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, state: { complete: true } });
  });
});
