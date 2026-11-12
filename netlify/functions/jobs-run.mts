import crypto from 'node:crypto';
import type { Config } from '@netlify/functions';
import { getFirebaseServices, internalToken } from '../../server/services';

// Internal: POST starts a scheduler run now (in the background); GET returns the last run's summary.
export default async (req: Request) => {
  const secret = internalToken('jobs');
  const got = req.headers.get('x-cron-secret') || '';
  if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new Response('Forbidden', { status: 403 });
  const svc = await getFirebaseServices();
  if (req.method === 'GET' && new URL(req.url).searchParams.get('report') === 'errors') {
    const items = await svc.db.list<any>('opsErrors', [], { orderBy: ['at', 'desc'], limit: 100 });
    return Response.json({ items, health: await svc.db.get('opsAlerts/jobs') }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (req.method === 'GET' && new URL(req.url).searchParams.get('report') === 'rereview') {
    const { rereviewCandidates } = await import('../../server/rereview');
    return Response.json(await rereviewCandidates(svc), { headers: { 'Cache-Control': 'no-store' } });
  }
  if (req.method === 'GET') return Response.json((await svc.db.get('jobRuns/latest')) ?? { none: true }, { headers: { 'Cache-Control': 'no-store' } });
  const res = await fetch(`${svc.env.appUrl}/.netlify/functions/jobs-background`, { method: 'POST', headers: { 'x-cron-secret': secret } });
  return Response.json({ started: res.status === 202 || res.ok, status: res.status });
};

export const config: Config = { path: '/internal/jobs/run' };
