import { billingCurrency } from '../../domain/locale';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDate } from '../../domain/dates';
import { money } from '../../domain/locale';
import { planPrice } from '../../domain/plans';
import { api, useApi } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Callout, cx, Empty, ErrorState, FormError, humanize, KeyValue, PageHeader, Segmented, Skeleton, Spinner } from '../../ui';

export default function Billing() {
  const { me } = useSession();
  const { data, error, loading, reload } = useApi<any>('billing.get');
  const [params] = useSearchParams();
  const [interval, setInterval] = useState<'month' | 'year'>('year');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const currency = billingCurrency(me?.org?.settings.currency);
  if (loading && !data) return <Skeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const s = data.subscription;
  const go = async (action: string, input: any, key: string) => { setBusy(key); setErr(null); try { const r = await api(action, input); window.location.href = r.url; } catch (e: any) { setErr(e.message); setBusy(null); } };
  const lim = (n: number | null) => (n === null ? 'Unlimited' : n);
  return (
    <div>
      <PageHeader title="Billing" description="One subscription for your organisation. Subcontractors never pay to submit documents." />
      <div className="space-y-12 max-w-5xl">
        {params.get('checkout') === 'success' && <Callout tone="ok" title="Payment received">Your plan will update in a moment once Stripe confirms it.</Callout>}
        {!data.configured && <Callout tone="warn" title="Online payments aren't connected yet">Stripe isn't configured for this deployment. Plan limits still apply.</Callout>}
        <section>
          <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Current plan</h2>
          <div className="grid sm:grid-cols-4 gap-6 pt-5">
            <div><div className="text-sm text-muted">Plan</div><div className="text-xl mt-1">{data.plan.name}</div><div className="text-sm text-muted mt-1">{humanize(s.status)}{s.status === 'trialing' && s.trialEndsAt ? ` until ${formatDate(s.trialEndsAt)}` : ''}{s.cancelAtPeriodEnd ? ' · ends at period end' : ''}</div>{s.currentPeriodEnd && <div className="text-xs text-faint mt-1">Renews {formatDate(s.currentPeriodEnd)}</div>}</div>
            {[['Active subcontractors', data.usage.activeSubcontractors, data.plan.limits.activeSubcontractors], ['Active projects', data.usage.activeProjects, data.plan.limits.activeProjects], ['Team members', data.usage.users, data.plan.limits.users]].map(([l, u, m]: any) => (
              <div key={l}><div className="text-sm text-muted">{l}</div><div className="text-xl mt-1 tnum">{u} <span className="text-muted text-base">of {lim(m)}</span></div>{m !== null && <div className="mt-2 h-1.5 rounded-full bg-raised overflow-hidden"><div className={cx('h-full', u / m > 0.9 ? 'bg-ink' : 'bg-accent')} style={{ width: `${Math.min(100, (u / m) * 100)}%` }} /></div>}</div>
            ))}
          </div>
          {data.canManage && s.stripeCustomerId && <button className="btn-secondary mt-6" disabled={!!busy} onClick={() => go('billing.portal', {}, 'portal')}>{busy === 'portal' && <Spinner />}Payment method, invoices and cancellation</button>}
        </section>
        {data.canManage ? (
          <section>
            <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-line-strong"><h2 className="text-lg font-semibold">Plans</h2><Segmented size="sm" label="Billing interval" value={interval} onChange={setInterval} options={[{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Annual' }]} /></div>
            <div className="grid md:grid-cols-3 gap-x-10">{data.plans.map((p: any) => {
              const current = p.id === s.plan && s.status !== 'trialing' && s.interval === interval;
              return (
                <div key={p.id} className="py-6 border-b border-line md:border-b-0">
                  <div className="font-medium">{p.name}</div><p className="text-sm text-muted mt-1 min-h-[2.5rem]">{p.description}</p>
                  <div className="text-3xl mt-3 tnum">{money(planPrice(p, interval, currency), currency)}<span className="text-sm text-muted"> / month</span></div>
                  <div className="text-xs text-faint mt-1">{interval === 'year' ? 'Billed annually' : 'Billed monthly'}</div>
                  <div className="text-sm text-muted mt-3">{lim(p.limits.activeSubcontractors)} subcontractors · {lim(p.limits.activeProjects)} projects · {lim(p.limits.users)} team members</div>
                  <button className={cx('mt-5 w-full', current ? 'btn-secondary' : 'btn-primary')} disabled={current || !!busy || !data.configured} onClick={() => go('billing.checkout', { plan: p.id, interval }, p.id)}>{busy === p.id && <Spinner />}{current ? 'Current plan' : s.stripeSubscriptionId ? 'Switch to this plan' : 'Choose this plan'}</button>
                </div>
              );
            })}</div>
            <div className="mt-4"><FormError error={err} /></div>
          </section>
        ) : <p className="text-muted">Only the organisation owner can change the plan.</p>}
        <section>
          <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Invoices</h2>
          {data.history.length === 0 ? <Empty title="No invoices yet" /> : (
            <table className="table"><thead><tr><th className="th">Date</th><th className="th">Invoice</th><th className="th">Amount</th><th className="th">Status</th><th className="th"><span className="sr-only">Link</span></th></tr></thead>
              <tbody>{data.history.map((h: any) => <tr key={h.id}><td className="td">{formatDate(h.created)}</td><td className="td">{h.number}</td><td className="td tnum">{(h.amount / 100).toLocaleString(undefined, { style: 'currency', currency: (h.currency || 'usd').toUpperCase() })}</td><td className="td">{humanize(h.status)}</td><td className="td text-right">{h.hostedUrl && <a className="btn-quiet" href={h.hostedUrl} target="_blank" rel="noreferrer">View</a>}</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="max-w-xl"><KeyValue items={[['Payments', 'Processed securely by Stripe'], ['Billing currency', currency]]} /></section>
      </div>
    </div>
  );
}
