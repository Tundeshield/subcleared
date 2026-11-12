import crypto from 'node:crypto';
import { runExtraction } from '../../server/jobs';
import { reportError } from '../../server/ops';
import { getFirebaseServices, internalSignature } from '../../server/services';

// Background function (15-minute budget). Only callable with an internal HMAC signature.
export default async (req: Request) => {
  const svc = await getFirebaseServices();
  const { orgId, versionId } = (await req.json()) as { orgId: string; versionId: string };
  const sig = req.headers.get('x-internal-signature') || '';
  const want = internalSignature(svc.env.portalSecret, `${orgId}:${versionId}`);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return new Response('Forbidden', { status: 403 });
  try { await runExtraction(svc, orgId, versionId); } catch (e) { await reportError(svc, { fn: 'extract-background', orgId, error: e, retry: 'will_retry' }); }
  return new Response('ok');
};
