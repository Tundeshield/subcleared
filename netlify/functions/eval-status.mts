import crypto from 'node:crypto';
import type { Config } from '@netlify/functions';
import { getFirebaseServices, internalToken } from '../../server/services';

// Latest extraction-accuracy run. Internal only (x-eval-secret).
export default async (req: Request) => {
  const secret = internalToken('eval');
  const got = req.headers.get('x-eval-secret') || '';
  if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new Response('Forbidden', { status: 403 });
  const svc = await getFirebaseServices();
  return Response.json((await svc.db.get('evals/latest')) ?? { status: 'none' }, { headers: { 'Cache-Control': 'no-store' } });
};

export const config: Config = { path: '/internal/eval/status' };
