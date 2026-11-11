import crypto from 'node:crypto';
import type { Config } from '@netlify/functions';
import { runDailyJobs } from '../../server/jobs';
import { getFirebaseServices } from '../../server/services';

// Manual trigger for the scheduler (e.g. after changing reminder settings). Requires CRON_SECRET.
export default async (req: Request) => {
  const svc = await getFirebaseServices();
  const secret = svc.env.cronSecret;
  const got = req.headers.get('x-cron-secret') || '';
  if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new Response('Forbidden', { status: 403 });
  return Response.json(await runDailyJobs(svc));
};

export const config: Config = { path: '/internal/jobs/run' };
