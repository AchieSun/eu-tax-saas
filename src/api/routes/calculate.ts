/**
 * F1 — tax calculator routes.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { calculateTax, calculatorInputSchema, compareCountries } from '../../rules';
import type { Bindings, Variables } from '../index';

export const calculateRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const compareSchema = calculatorInputSchema.omit({ country: true });

calculateRoutes.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  try {
    const result = calculateTax(body);
    return c.json({ ok: true, result });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ ok: false, error: 'validation', issues: err.issues }, 400);
    }
    return c.json({ ok: false, error: (err as Error).message }, 400);
  }
});

calculateRoutes.post('/compare', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  const parsed = compareSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'validation', issues: parsed.error.issues }, 400);
  }
  const results = compareCountries(parsed.data);
  return c.json({ ok: true, results });
});
