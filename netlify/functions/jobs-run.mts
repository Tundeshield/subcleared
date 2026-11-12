import crypto from 'node:crypto';
import type { Config } from '@netlify/functions';
import { getFirebaseServices, internalToken } from '../../server/services';

// Internal: POST starts a scheduler run now (in the background); GET returns the last run's summary.
export default async (req: Request) => {
  const secret = internalToken('jobs');
  const got = req.headers.get('x-cron-secret') || '';
  if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new Response('Forbidden', { status: 403 });
  const svc = await getFirebaseServices();
  if (req.method === 'GET' && new URL(req.url).searchParams.get('report') === 'mail') {
    // Delivery evidence only: status, template, provider id and a masked recipient. No message bodies.
    const mask = (e: string) => e.replace(/^(.).*?(@.*)$/, '$1***$2');
    const orgs = await svc.db.list<any>('orgs');
    const rows: any[] = [];
    for (const o of orgs) for (const l of await svc.db.list<any>(`orgs/${o.id}/deliveryLogs`, [], { orderBy: ['createdAt', 'desc'], limit: 15 })) rows.push({ org: o.id, at: l.updatedAt ?? l.createdAt, template: l.template, to: mask(String(l.to ?? '')), status: l.status, providerId: l.providerId ?? null, error: l.error ?? null });
    rows.sort((x, y) => String(y.at).localeCompare(String(x.at)));
    return Response.json({ items: rows.slice(0, 30), from: process.env.EMAIL_FROM ?? null }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (req.method === 'GET' && new URL(req.url).searchParams.get('report') === 'metrics') {
    const { operationalMetrics } = await import('../../server/ops');
    return Response.json(await operationalMetrics(svc), { headers: { 'Cache-Control': 'no-store' } });
  }
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
