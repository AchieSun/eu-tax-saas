/**
 * Cloudflare Workers entry point.
 *
 * Re-exports the Hono app. In a future iteration we'll mount the SolidStart
 * SSR handler alongside the API; for W1 we expose just the JSON API surface.
 */

import type { ScheduledEvent } from '@cloudflare/workers-types';
import type { Bindings } from './api';
import { createDb } from './db';
import { findDeadlinesDueForReminder } from './deadlines/repository';

export { default } from './api';

/**
 * F9 — Daily deadline reminder cron.
 * Triggered by `[[triggers.crons]]` in wrangler.toml.
 * For the MVP we only log reminder events; real email/SMS delivery is
 * intentionally out of scope until a notification transport exists.
 */
export async function scheduled(event: ScheduledEvent, env: Bindings): Promise<void> {
  const referenceDate = new Date(event.scheduledTime).toISOString().slice(0, 10);
  const db = createDb(env.DB);
  const due = await findDeadlinesDueForReminder(db, referenceDate);

  if (due.length === 0) {
    console.log(`[cron:${event.cron}] No deadline reminders for ${referenceDate}`);
    return;
  }

  for (const deadline of due) {
    console.log(
      `[cron:${event.cron}] Reminder: user=${deadline.userId} deadline=${deadline.id} ` +
        `title="${deadline.title}" due=${deadline.dueDate}`,
    );
  }
}
