import type { Config } from '@netlify/functions';
import { runDailyJobs } from '../../server/jobs';
import { getFirebaseServices } from '../../server/services';

// Runs every 6 hours. Each run is idempotent: reminders are keyed per
// document version and schedule offset, and "today" is computed in each
// organisation's own timezone.
export default async () => {
  const svc = await getFirebaseServices();
  const summary = await runDailyJobs(svc);
  console.log('[scheduler]', JSON.stringify(summary));
};

export const config: Config = { schedule: '17 */6 * * *' };
