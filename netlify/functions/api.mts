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
  const res = await handleApi(svc, {
    action, input, authorization: req.headers.get('authorization'), orgId: req.headers.get('x-org-id'), ip: context.ip,
  });
  return new Response(JSON.stringify(res.body), { status: res.status, headers: JSON_HEADERS });
};

export const config: Config = { path: '/api/*' };
