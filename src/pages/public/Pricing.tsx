import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { money } from '../../domain/locale';
import { DEFAULT_PLANS, planPrice, type Plan } from '../../domain/plans';
import { api } from '../../lib/api';
import { cx, Icon, Segmented } from '../../ui';
import { PublicFooter, PublicNav } from './PublicShell';

const lim = (n: number | null, word: string) => (n === null ? `Unlimited ${word}` : `${n} ${word}`);

export default function Pricing() {
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS);
  const [trial, setTrial] = useState(14);
  const [interval, setInterval] = useState<'month' | 'year'>('year');
  const [currency, setCurrency] = useState<'USD' | 'GBP'>(() => (Intl.DateTimeFormat().resolvedOptions().timeZone?.startsWith('Europe/London') ? 'GBP' : 'USD'));
  useEffect(() => { api('public.plans', {}, { portal: true }).then((r) => { setPlans(r.plans); setTrial(r.trialDays); }).catch(() => undefined); }, []);
  return (
    <div className="min-h-screen">
      <PublicNav />
      <main>
        <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-20 pb-10">
          <h1 className="text-4xl font-medium tracking-[-0.025em]">Pricing</h1>
          <p className="mt-4 text-lg text-muted max-w-2xl leading-relaxed">One subscription per organisation. Every plan starts with a {trial}-day free trial, and subcontractors never pay to submit documents.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Segmented label="Billing interval" value={interval} onChange={setInterval} options={[{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Annual — save about 17%' }]} />
            <Segmented label="Currency" value={currency} onChange={setCurrency} options={[{ value: 'USD', label: 'USD $' }, { value: 'GBP', label: 'GBP £' }]} />
          </div>
        </section>
        <section className="max-w-6xl mx-auto px-5 sm:px-8 grid md:grid-cols-3 gap-x-12 border-t border-ink">
          {plans.map((p, i) => (
            <div key={p.id} className="py-8 flex flex-col border-b border-line md:border-b-0">
              <div className="flex items-baseline justify-between"><h2 className="text-lg font-semibold">{p.name}</h2>{i === 1 && <span className="text-xs text-accent-ink font-medium uppercase tracking-[0.1em]">Most chosen</span>}</div>
              <p className="text-muted mt-1 min-h-[3rem]">{p.description}</p>
              <div className="mt-6"><span className="text-4xl tnum tracking-[-0.02em]">{money(planPrice(p, interval, currency), currency)}</span><span className="text-muted"> / month</span></div>
              <div className="text-sm text-faint mt-1">{interval === 'year' ? `Billed annually, ${money(planPrice(p, interval, currency) * 12, currency)} a year` : 'Billed monthly'}</div>
              <ul className="mt-8 space-y-2.5">
                {[lim(p.limits.activeSubcontractors, 'active subcontractors'), lim(p.limits.activeProjects, 'active projects'), lim(p.limits.users, 'team members'), p.limits.storageGb ? `${p.limits.storageGb} GB document storage` : 'Unlimited storage', ...p.features].map((f) => (
                  <li key={f} className="flex gap-2.5"><span className="text-accent-ink mt-0.5">{Icon.check()}</span><span>{f}</span></li>
                ))}
              </ul>
              <div className="flex-1" />
              <Link to="/signup" className={cx('mt-10', i === 1 ? 'btn-primary' : 'btn-secondary')}>Start free trial</Link>
            </div>
          ))}
        </section>
        <section className="max-w-3xl mx-auto px-5 sm:px-8 mt-24">
          <h2 className="text-2xl font-medium">Questions</h2>
          <dl className="mt-6 border-t border-ink">
            {[
              ['What counts as an active subcontractor?', 'Any company in your directory that isn’t archived. Archived records keep their full history and don’t count toward your limit.'],
              ['Do subcontractors need an account?', 'No. They get a secure, expiring link for exactly what you asked for. Contacts invited to the full portal confirm their email with a one-time code.'],
              ['Can we change plans later?', 'Yes. Upgrade or downgrade any time from Billing; Stripe prorates the difference.'],
              ['What happens when the trial ends?', 'Everything stays. Adding new subcontractors, projects and team members pauses until you choose a plan.'],
            ].map(([q, a]) => <div key={q} className="py-5 border-b border-line"><dt className="font-medium">{q}</dt><dd className="text-muted mt-1.5 leading-relaxed">{a}</dd></div>)}
          </dl>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
