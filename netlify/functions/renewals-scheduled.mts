import type { Config } from '@netlify/functions';
import { runDailyJobs } from '../../server/jobs';
import { getFirebaseServices } from '../../server/services';

// Runs hourly. Messages to subcontractors only go out inside each
// organisation's working hours (its own timezone); the heavier daily steps
// run once per local day. Every message is keyed, so reruns never duplicate.
export default async () => {
  const svc = await getFirebaseServices();
  const summary = await runDailyJobs(svc);
  console.log('[scheduler]', JSON.stringify(summary));
};

export const config: Config = { schedule: '17 * * * *' };
