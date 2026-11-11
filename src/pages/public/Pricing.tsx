import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_PLANS, type Plan } from '../../domain/plans';
import { api } from '../../lib/api';
import { cx, Icon, Segmented } from '../../ui';
import { PublicFooter, PublicNav } from './PublicShell';

const lim = (n: number | null, word: string) => (n === null ? `Unlimited ${word}` : `${n} ${word}`);

export default function Pricing() {
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS);
  const [trial, setTrial] = useState(14);
  const [interval, setInterval] = useState<'month' | 'year'>('year');
  useEffect(() => { api('public.plans', {}, { portal: true }).then((r) => { setPlans(r.plans); setTrial(r.trialDays); }).catch(() => undefined); }, []);
  return (
    <div className="min-h-screen">
      <PublicNav />
      <section className="max-w-6xl mx-auto px-5 pt-16 pb-8">
        <h1 className="text-4xl font-semibold tracking-tight">Pricing</h1>
        <p className="mt-3 text-lg text-muted max-w-2xl">One subscription per organisation. Every plan starts with a {trial}-day free trial, and subcontractors never pay to submit documents.</p>
        <div className="mt-8"><Segmented value={interval} onChange={setInterval} options={[{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Annual (save ~17%)' }]} /></div>
      </section>
      <section className="max-w-6xl mx-auto px-5 grid md:grid-cols-3 gap-4">
        {plans.map((p, i) => (
          <div key={p.id} className={cx('panel p-6 flex flex-col', i === 1 && 'border-accent/50')}>
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">{p.name}</h2>{i === 1 && <span className="text-xs text-accent">Most chosen</span>}</div>
            <p className="text-sm text-muted mt-1 min-h-[2.5rem]">{p.description}</p>
            <div className="mt-5"><span className="text-4xl font-semibold tabular-nums">${interval === 'year' ? p.annual : p.monthly}</span><span className="text-muted"> / month</span></div>
            <div className="text-xs text-faint mt-1">{interval === 'year' ? `Billed annually ($${p.annual * 12}/yr)` : 'Billed monthly'}</div>
            <ul className="mt-6 space-y-2 text-sm">
              {[lim(p.limits.activeSubcontractors, 'active subcontractors'), lim(p.limits.activeProjects, 'active projects'), lim(p.limits.users, 'internal users'), p.limits.storageGb ? `${p.limits.storageGb} GB document storage` : 'Unlimited storage', ...p.features].map((f) => (
                <li key={f} className="flex gap-2"><span className="text-accent mt-0.5">{Icon.check()}</span><span>{f}</span></li>
              ))}
            </ul>
            <div className="flex-1" />
            <Link to="/signup" className={cx('mt-8', i === 1 ? 'btn-primary' : 'btn-secondary')}>Start free trial</Link>
          </div>
        ))}
      </section>
      <section className="max-w-3xl mx-auto px-5 mt-16 space-y-6 text-sm">
        {[
          ['What counts as an active subcontractor?', 'Any subcontractor in your directory that is not archived. Archived records keep their full history and do not count toward your limit.'],
          ['Do subcontractors need an account?', 'No. They receive a secure, expiring link scoped to what you requested. Contacts you invite to the full portal confirm their email with a one-time code.'],
          ['Can we change plans?', 'Yes — upgrade or downgrade at any time from Settings → Billing. Changes are prorated by Stripe.'],
          ['What happens when a trial ends?', 'Your data stays. Adding new subcontractors, projects and users pauses until you choose a plan.'],
        ].map(([q, a]) => <div key={q}><h3 className="font-medium text-md">{q}</h3><p className="text-muted mt-1">{a}</p></div>)}
      </section>
      <PublicFooter />
    </div>
  );
}
