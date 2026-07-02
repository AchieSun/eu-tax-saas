import { Hono } from 'hono';
import { createDb } from '../../db';
import {
  completeOnboarding,
  getOnboardingState,
  saveOnboardingStep,
  skipOnboardingStep,
} from '../../onboarding/service';
import { skipStepSchema, stepSaveSchema } from '../../onboarding/types';
import type { Bindings, Variables } from '../index';

export const onboardingRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function requireUserId(c: { get: (key: 'session') => { user: { id: string } } | undefined }):
  | string
  | null {
  return c.get('session')?.user?.id ?? null;
}

type JsonBodyResult =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly error: 'invalid_json' };

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<JsonBodyResult> {
  try {
    return { ok: true, body: await c.req.json() };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, error: 'invalid_json' };
    }
    throw error;
  }
}

onboardingRoutes.get('/', async (c) => {
  const userId = requireUserId(c);
  if (!userId) return c.json({ ok: false, error: 'unauthorized' }, 401);
  const state = await getOnboardingState(createDb(c.env.DB), userId);
  return c.json({ ok: true, state });
});

onboardingRoutes.post('/step', async (c) => {
  const userId = requireUserId(c);
  if (!userId) return c.json({ ok: false, error: 'unauthorized' }, 401);

  const body = await readJson(c);
  if (!body.ok) return c.json({ ok: false, error: body.error }, 400);

  const parsed = stepSaveSchema.safeParse(body.body);
  if (!parsed.success)
    return c.json({ ok: false, error: 'validation', issues: parsed.error.issues }, 400);

  const state = await saveOnboardingStep(createDb(c.env.DB), userId, parsed.data);
  return c.json({ ok: true, state });
});

onboardingRoutes.post('/skip', async (c) => {
  const userId = requireUserId(c);
  if (!userId) return c.json({ ok: false, error: 'unauthorized' }, 401);

  const body = await readJson(c);
  if (!body.ok) return c.json({ ok: false, error: body.error }, 400);

  const parsed = skipStepSchema.safeParse(body.body);
  if (!parsed.success)
    return c.json({ ok: false, error: 'validation', issues: parsed.error.issues }, 400);

  const state = await skipOnboardingStep(createDb(c.env.DB), userId, parsed.data.step);
  return c.json({ ok: true, state });
});

onboardingRoutes.post('/complete', async (c) => {
  const userId = requireUserId(c);
  if (!userId) return c.json({ ok: false, error: 'unauthorized' }, 401);
  const state = await completeOnboarding(createDb(c.env.DB), userId);
  return c.json({ ok: true, state });
});
