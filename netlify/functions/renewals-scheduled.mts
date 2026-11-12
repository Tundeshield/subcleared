import type { Config } from '@netlify/functions';
import { runDailyJobs } from '../../server/jobs';
import { getFirebaseServices, internalToken } from '../../server/services';

// Hourly. Hands the work to jobs-background (15-minute budget); if that can't
// be started, runs it here so a run is never skipped silently. Messages to
// subcontractors only go out inside each organisation's working hours, and
// every message is keyed so overlapping runs never duplicate.
export default async () => {
  const svc = await getFirebaseServices();
  try {
    const res = await fetch(`${svc.env.appUrl}/.netlify/functions/jobs-background`, { method: 'POST', headers: { 'x-cron-secret': internalToken('jobs') } });
    if (res.status === 202 || res.ok) { console.log('[scheduler] handed to jobs-background'); return; }
    console.error('[scheduler] background start failed', res.status);
  } catch (e) { console.error('[scheduler] background start failed', e); }
  console.log('[scheduler] inline', JSON.stringify(await runDailyJobs(svc)));
};

export const config: Config = { schedule: '17 * * * *' };
