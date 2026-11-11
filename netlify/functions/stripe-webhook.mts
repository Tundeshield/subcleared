import type { Config } from '@netlify/functions';
import { HttpError } from '../../server/core';
import { handleStripeWebhook } from '../../server/handlers/billing';
import { getFirebaseServices } from '../../server/services';

export default async (req: Request) => {
  const svc = await getFirebaseServices();
  try {
    const out = await handleStripeWebhook(svc, await req.text(), req.headers.get('stripe-signature'));
    return Response.json(out);
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error('stripe webhook', e);
    return Response.json({ error: e.message }, { status });
  }
};

export const config: Config = { path: '/webhooks/stripe' };
