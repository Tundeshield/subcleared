import crypto from 'node:crypto';
import { runDailyJobs } from '../../server/jobs';
import { getFirebaseServices, internalToken } from '../../server/services';

// The scheduler's work (reminders, chasing, recovery, readiness), run as a
// background function: up to 15 minutes instead of a scheduled function's 30
// seconds, so a growing customer base doesn't cut runs short. Each run's
// summary is kept at jobRuns/latest for monitoring.
export default async (req: Request) => {
  const got = req.headers.get('x-cron-secret') || '';
  const secret = internalToken('jobs');
  if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new Response('Forbidden', { status: 403 });
  const svc = await getFirebaseServices();
  const startedAt = new Date().toISOString();
  try {
    const summary = await runDailyJobs(svc);
    const failedOrgs = summary.filter((s: any) => s.error).length;
    await svc.db.set('jobRuns/latest', { startedAt, finishedAt: new Date().toISOString(), ok: failedOrgs === 0, orgs: summary.length, failedOrgs, summary: JSON.parse(JSON.stringify(summary)).slice(0, 200) });
    console.log('[jobs]', JSON.stringify(summary));
  } catch (e: any) {
    await svc.db.set('jobRuns/latest', { startedAt, finishedAt: new Date().toISOString(), ok: false, error: String(e?.message ?? e).slice(0, 500) });
    console.error('[jobs] failed', e);
  }
  return new Response('ok');
};
