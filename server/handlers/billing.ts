import { billingCurrency } from '../../src/domain/locale';
import type Stripe from 'stripe';
import { getPlan } from '../../src/domain/plans';
import type { Assignment, Member, Organisation, Project, Subcontractor, Subscription } from '../../src/domain/types';
import { audit, bad, C, type Ctx, HttpError, need, oneOf } from '../core';
import type { Db } from '../db';
import type { Services } from '../services';

async function stripeClient(svc: Services): Promise<Stripe> {
  if (!svc.env.stripeSecret) throw new HttpError(503, 'Billing is not configured yet (STRIPE_SECRET_KEY missing).', 'billing_unconfigured');
  const { default: StripeCtor } = await import('stripe');
  return new StripeCtor(svc.env.stripeSecret);
}

export function subscriptionUsable(sub: Subscription, now: Date) {
  if (sub.status === 'active') return true;
  if (sub.status === 'trialing') return !sub.trialEndsAt || new Date(sub.trialEndsAt) > now;
  if (sub.status === 'past_due') return true; // grace period while Stripe retries payment
  return false;
}

export async function usage(db: Db, orgId: string) {
  const [subs, projects, members] = await Promise.all([
    db.list<Subcontractor>(C.col(orgId, 'subcontractors')),
    db.list<Project>(C.col(orgId, 'projects')),
    db.list<Member>(C.col(orgId, 'members')),
  ]);
  return {
    activeSubcontractors: subs.filter((s) => !['archived'].includes(s.status)).length,
    activeProjects: projects.filter((p) => !['archived', 'completed'].includes(p.status)).length,
    users: members.filter((m) => m.status === 'active').length,
  };
}

/** Plan limits are enforced server-side on create. Subcontractors never pay. */
export async function enforceLimit(ctx: Ctx, kind: 'subcontractors' | 'projects' | 'users', adding = 1) {
  const now = ctx.svc.now();
  if (!subscriptionUsable(ctx.org.subscription, now)) {
    throw new HttpError(402, 'Your subscription is inactive. Choose a plan in Settings → Billing to keep adding records.', 'subscription_inactive');
  }
  const plan = getPlan(ctx.svc.env.plans, ctx.org.subscription.plan);
  const u = await usage(ctx.db, ctx.org.id);
  const map = { subcontractors: ['activeSubcontractors', u.activeSubcontractors], projects: ['activeProjects', u.activeProjects], users: ['users', u.users] } as const;
  const [key, current] = map[kind];
  const limit = plan.limits[key];
  if (limit !== null && current + adding > limit) {
    throw new HttpError(402, `Your ${plan.name} plan includes ${limit} ${kind === 'users' ? 'users' : `active ${kind}`}. Upgrade to add more.`, 'plan_limit');
  }
}

export async function getBilling(ctx: Ctx) {
  const records = await ctx.db.list<any>(C.col(ctx.org.id, 'billing'));
  return {
    subscription: ctx.org.subscription,
    plan: getPlan(ctx.svc.env.plans, ctx.org.subscription.plan),
    plans: ctx.svc.env.plans,
    usage: await usage(ctx.db, ctx.org.id),
    history: records.sort((a, b) => b.created.localeCompare(a.created)),
    configured: !!ctx.svc.env.stripeSecret,
    canManage: ctx.member.role === 'owner' || (ctx.member.extraPermissions ?? []).includes('billing.manage'),
  };
}

export async function createCheckout(ctx: Ctx, input: any) {
  need(ctx, 'billing.manage');
  const plan = oneOf(input.plan, ctx.svc.env.plans.map((p) => p.id), 'Plan');
  const interval = oneOf(input.interval, ['month', 'year'] as const, 'Billing interval');
  const price = ctx.svc.env.priceId(plan, interval, billingCurrency(ctx.org.settings.currency));
  if (!price) throw new HttpError(503, `No Stripe price configured for ${plan} (${interval}ly).`, 'billing_unconfigured');
  const stripe = await stripeClient(ctx.svc);
  let customer = ctx.org.subscription.stripeCustomerId;
  if (!customer) {
    const c = await stripe.customers.create({ name: ctx.org.name, email: ctx.member.email, metadata: { orgId: ctx.org.id } });
    customer = c.id;
    await ctx.db.update(C.org(ctx.org.id), { 'subscription.stripeCustomerId': customer });
    await ctx.db.set(`stripeCustomers/${customer}`, { orgId: ctx.org.id });
  }
  // If already subscribed, change the plan in place (proration handled by Stripe).
  if (ctx.org.subscription.stripeSubscriptionId && ['active', 'past_due', 'trialing'].includes(ctx.org.subscription.status)) {
    const sub = await stripe.subscriptions.retrieve(ctx.org.subscription.stripeSubscriptionId);
    if (sub.status !== 'canceled') {
      await stripe.subscriptions.update(sub.id, { items: [{ id: sub.items.data[0].id, price }], proration_behavior: 'create_prorations', metadata: { orgId: ctx.org.id, plan } });
      await audit(ctx, { action: 'billing.plan_change_requested', entity: { type: 'organisation', id: ctx.org.id }, after: { plan, interval } });
      return { url: `${ctx.svc.env.appUrl}/app/billing?updated=1` };
    }
  }
  const trialEnd = ctx.org.subscription.status === 'trialing' && ctx.org.subscription.trialEndsAt ? Math.floor(new Date(ctx.org.subscription.trialEndsAt).getTime() / 1000) : undefined;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', customer, line_items: [{ price, quantity: 1 }], client_reference_id: ctx.org.id,
    subscription_data: { metadata: { orgId: ctx.org.id, plan }, ...(trialEnd && trialEnd > Date.now() / 1000 + 3600 ? { trial_end: trialEnd } : {}) },
    success_url: `${ctx.svc.env.appUrl}/app/billing?checkout=success`, cancel_url: `${ctx.svc.env.appUrl}/app/billing?checkout=cancelled`,
    allow_promotion_codes: true,
  });
  await audit(ctx, { action: 'billing.checkout_started', entity: { type: 'organisation', id: ctx.org.id }, after: { plan, interval } });
  return { url: session.url };
}

export async function createPortal(ctx: Ctx) {
  need(ctx, 'billing.manage');
  if (!ctx.org.subscription.stripeCustomerId) throw bad('There is no billing account yet. Choose a plan first.');
  const stripe = await stripeClient(ctx.svc);
  const s = await stripe.billingPortal.sessions.create({ customer: ctx.org.subscription.stripeCustomerId, return_url: `${ctx.svc.env.appUrl}/app/billing` });
  return { url: s.url };
}

/** Stripe webhook: the only writer of subscription state after checkout. */
export async function handleStripeWebhook(svc: Services, rawBody: string, signature: string | null) {
  if (!svc.env.stripeWebhookSecret) throw new HttpError(503, 'Webhook secret not configured');
  const stripe = await stripeClient(svc);
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(rawBody, signature ?? '', svc.env.stripeWebhookSecret); } catch (e: any) { throw new HttpError(400, `Invalid signature: ${e.message}`); }
  // Idempotency: each event is processed once.
  try { await svc.db.create(`stripeEvents/${event.id}`, { type: event.type, at: svc.now().toISOString() }); } catch { return { duplicate: true }; }

  const orgFor = async (customer: string | Stripe.Customer | Stripe.DeletedCustomer | null, meta?: Stripe.Metadata | null) => {
    if (meta?.orgId) return meta.orgId;
    const cid = typeof customer === 'string' ? customer : customer?.id;
    if (!cid) return null;
    return (await svc.db.get<{ orgId: string }>(`stripeCustomers/${cid}`))?.orgId ?? null;
  };

  if (event.type.startsWith('customer.subscription.')) {
    const sub = event.data.object as Stripe.Subscription;
    const orgId = await orgFor(sub.customer, sub.metadata);
    if (!orgId) return { ignored: true };
    const org = await svc.db.get<Organisation>(C.org(orgId));
    if (!org) return { ignored: true };
    const price = sub.items.data[0]?.price;
    const plan = sub.metadata?.plan || svc.env.plans.find((p) => (['month', 'year'] as const).some((i) => [svc.env.priceId(p.id, i), svc.env.priceId(p.id, i, 'USD'), svc.env.priceId(p.id, i, 'GBP')].includes(price?.id)))?.id || org.subscription.plan;
    const periodEnd = (sub as any).current_period_end ?? sub.items.data[0]?.current_period_end;
    const next: Subscription = {
      ...org.subscription, plan, interval: price?.recurring?.interval === 'year' ? 'year' : 'month',
      status: (['active', 'trialing', 'past_due', 'canceled', 'incomplete'].includes(sub.status) ? sub.status : sub.status === 'unpaid' ? 'past_due' : 'incomplete') as Subscription['status'],
      stripeSubscriptionId: sub.id, stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : undefined, cancelAtPeriodEnd: sub.cancel_at_period_end,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : org.subscription.trialEndsAt,
    };
    if (event.type === 'customer.subscription.deleted') next.status = 'canceled';
    await svc.db.update(C.org(orgId), { subscription: next });
    await audit({ db: svc.db, svc, org, source: 'webhook' }, { action: 'billing.subscription_updated', entity: { type: 'organisation', id: orgId }, before: org.subscription, after: next, actor: { type: 'system', id: 'stripe', name: 'Stripe' } });
  }
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const inv = event.data.object as Stripe.Invoice;
    const orgId = await orgFor(inv.customer, (inv as any).subscription_details?.metadata);
    if (orgId) {
      await svc.db.set(C.doc(orgId, 'billing', inv.id!), {
        id: inv.id, number: inv.number, amount: inv.amount_paid || inv.amount_due, currency: inv.currency, status: event.type === 'invoice.paid' ? 'paid' : 'failed',
        created: new Date(inv.created * 1000).toISOString(), hostedUrl: inv.hosted_invoice_url, pdfUrl: inv.invoice_pdf,
      });
    }
  }
  return { ok: true };
}

export type { Assignment };
