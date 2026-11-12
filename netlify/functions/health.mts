import type { Config } from '@netlify/functions';
import { jobHealth } from '../../server/ops';
import { getFirebaseServices } from '../../server/services';

// Public and data-free, for an external uptime monitor: 200 while scheduled jobs are running, 503 when not.
export default async () => {
  const svc = await getFirebaseServices();
  const h = jobHealth(await svc.db.get<any>('jobRuns/latest'), svc.now());
  return Response.json({ jobs: h.severity, minutesSinceLastRun: h.ageMinutes }, { status: h.severity === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
};

export const config: Config = { path: '/internal/health' };
