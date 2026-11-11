import type { Config } from '@netlify/functions';
import { handleInboundEmail } from '../../server/intake';
import { getFirebaseServices } from '../../server/services';

// Receives messages from the inbound email provider (Postmark inbound webhook,
// or any relay posting the generic JSON shape documented in server/intake.ts).
// Authenticated with INBOUND_EMAIL_SECRET as ?token= or an x-inbound-secret header.
// Netlify limits synchronous request bodies to about 6 MB, so very large emails
// are refused by the platform before they reach this code.
export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const svc = await getFirebaseServices();
  const url = new URL(req.url);
  const out = await handleInboundEmail(svc, await req.text(), url.searchParams.get('token') || req.headers.get('x-inbound-secret'));
  return Response.json(out.body, { status: out.status });
};

export const config: Config = { path: '/webhooks/inbound-email' };
