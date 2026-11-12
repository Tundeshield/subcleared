import type { Config, Context } from '@netlify/functions';
import { handleApi } from '../../server/api';
import { getFirebaseServices } from '../../server/services';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export default async (req: Request, context: Context) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: JSON_HEADERS });
  const action = new URL(req.url).pathname.replace(/^\/api\//, '').replace(/^\.netlify\/functions\/api\//, '');
  const len = Number(req.headers.get('content-length') || 0);
  if (len > 2_500_000) return new Response(JSON.stringify({ error: 'Request too large' }), { status: 413, headers: JSON_HEADERS });
  let input: unknown = {};
  try { input = len ? await req.json() : {}; } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: JSON_HEADERS }); }
  let svc;
  try { svc = await getFirebaseServices(); } catch (e: any) {
    console.error('Service init failed', e);
    return new Response(JSON.stringify({ error: 'The server is not configured yet. See the deployment guide.', code: 'not_configured' }), { status: 503, headers: JSON_HEADERS });
  }
  // Per-request timing: stage durations and database round trips, sent as Server-Timing (no data, durations only).
  const t0 = Date.now(); let last = t0; const stages: string[] = []; let dbCalls = 0; let dbMs = 0;
  const mark = (stage: string) => { const n = Date.now(); stages.push(`${stage};dur=${n - last}`); last = n; };
  const db = new Proxy(svc.db, { get(target: any, prop) {
    const v = target[prop];
    if (typeof v !== 'function' || prop === 'newId') return v;
    return async (...args: any[]) => { const s = Date.now(); dbCalls++; try { return await v.apply(target, args); } finally { dbMs += Date.now() - s; } };
  } });
  const res = await handleApi({ ...svc, db }, {
    action, input, authorization: req.headers.get('authorization'), orgId: req.headers.get('x-org-id'), ip: context.ip, mark,
  });
  mark('handler');
  const timing = [...stages, `db;desc="${dbCalls} calls";dur=${dbMs}`, `total;dur=${Date.now() - t0}`].join(', ');
  if (Date.now() - t0 > 1500) console.warn(JSON.stringify({ event: 'api.slow', action, ms: Date.now() - t0, dbCalls, dbMs }));
  return new Response(JSON.stringify(res.body), { status: res.status, headers: { ...JSON_HEADERS, 'Server-Timing': timing } });
};

export const config: Config = { path: '/api/*' };
