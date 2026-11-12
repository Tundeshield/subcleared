import crypto from 'node:crypto';
import { processIntake } from '../../server/intake';
import { reportError } from '../../server/ops';
import { getFirebaseServices, internalSignature } from '../../server/services';

// Background function: reads and matches one emailed attachment. Internal HMAC only.
export default async (req: Request) => {
  const svc = await getFirebaseServices();
  const { orgId, intakeId } = (await req.json()) as { orgId: string; intakeId: string };
  const sig = req.headers.get('x-internal-signature') || '';
  const want = internalSignature(svc.env.portalSecret, `intake:${orgId}:${intakeId}`);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return new Response('Forbidden', { status: 403 });
  try { await processIntake(svc, orgId, intakeId); } catch (e) { await reportError(svc, { fn: 'intake-background', orgId, error: e, retry: 'will_retry' }); }
  return new Response('ok');
};
