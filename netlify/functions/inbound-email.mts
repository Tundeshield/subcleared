import type { Config } from '@netlify/functions';
import { handleInboundEmail } from '../../server/intake';
import { getFirebaseServices } from '../../server/services';

// Resend `email.received` webhook. Verified with RESEND_WEBHOOK_SECRET (Svix
// signature). The event carries metadata only; attachments are downloaded by
// the intake background function, so there is no request-size limit on files.
export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const svc = await getFirebaseServices();
  const out = await handleInboundEmail(svc, await req.text(), req.headers);
  return Response.json(out.body, { status: out.status });
};

export const config: Config = { path: '/webhooks/inbound-email' };
