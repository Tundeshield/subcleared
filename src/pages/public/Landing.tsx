import { Link } from 'react-router-dom';
import { Glyph, Icon, Mark, ReadinessBadge, ReadinessBar } from '../../ui';
import { PublicFooter, PublicNav } from './PublicShell';

// Illustrative content for the product preview. Names are invented.
const PREVIEW = [
  { co: 'Northgate Electrical', trade: 'Electrical · Sam Ortega', r: 'not_ready', issues: '1 missing · 1 rejected', action: 'Request documents' },
  { co: 'Harbourline Mechanical', trade: 'HVAC · Priya Nair', r: 'action_required', issues: '1 awaiting review', action: 'Review document', primary: true },
  { co: 'Ridgeway Roofing', trade: 'Roofing · Tom Ellis', r: 'action_required', issues: '1 expiring soon', action: 'Request renewal' },
  { co: 'Keystone Civils', trade: 'Groundworks · Ana Ruiz', r: 'ready', issues: 'All requirements met' },
  { co: 'Brightwater Plumbing', trade: 'Plumbing · Lee Chen', r: 'ready', issues: 'All requirements met' },
];

const STEPS = [
  ['Set what each project needs', 'Start from a template for the trade, then adjust it for the project. Insurance, licences, registrations, method statements — whatever your contract requires.'],
  ['Request documents in one step', 'Each contact gets a secure, expiring link. They upload from a phone without creating an account, and see exactly what is still needed.'],
  ['Review against your requirements', 'Approve, reject with a reason the subcontractor will understand, or ask for a replacement. Optional automatic reading suggests the details; a person decides.'],
  ['Know who is ready, and why', 'Readiness is worked out for every subcontractor on every project, with the requirement, document and decision behind it.'],
];

const POINTS = [
  ['Readiness per project', 'The same company can be ready for one project and not another. Each project has its own requirements, and each assignment its own answer.'],
  ['Renewals that run themselves', 'Expiry dates are tracked and reminders go out on schedule, once each, in your timezone. The previous version is always kept.'],
  ['A record you can stand behind', 'Every submission, decision and change is recorded with who, when and why. Past decisions keep the rules they were made under.'],
  ['Your requirements, your words', 'Set the country, terminology, date format and currency that fit your business. Templates are starting points, never assumed legal standards.'],
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      <PublicNav />
      <main>
        <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-20 sm:pt-28 pb-16">
          <p className="eyebrow">Subcontractor compliance and project readiness</p>
          <h1 className="mt-6 text-4xl sm:text-5xl font-medium tracking-[-0.025em] leading-[1.06] max-w-3xl">Know who's ready to work on every project.</h1>
          <p className="mt-7 text-lg text-muted max-w-2xl leading-relaxed">Manage subcontractor onboarding, project requirements, compliance documents and renewals in one place. See what's outstanding, what's been approved and what needs attention before work begins.</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link to="/signup" className="btn-primary btn-lg">Start a 14-day free trial</Link>
            <Link to="/pricing" className="btn-secondary btn-lg">See pricing</Link>
          </div>
          <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            <li className="flex items-center gap-2"><Glyph tone="ok" className="w-3.5 h-3.5" />No card needed</li>
            <li className="flex items-center gap-2"><Glyph tone="ok" className="w-3.5 h-3.5" />Subcontractors never pay to submit documents</li>
          </ul>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8" aria-label="Product preview: a project's readiness view">
          <div className="rounded-lg border border-line-strong bg-paper shadow-pop overflow-hidden">
            <div className="flex items-center gap-2 px-4 h-9 border-b border-line bg-canvas"><span className="h-2.5 w-2.5 rounded-full bg-line-strong" /><span className="h-2.5 w-2.5 rounded-full bg-line-strong" /><span className="h-2.5 w-2.5 rounded-full bg-line-strong" /><span className="ml-3 text-xs text-faint">SubCleared · Projects · Riverside Health Centre</span></div>
            <div className="grid md:grid-cols-[12rem_1fr]">
              <aside className="hidden md:block border-r border-line bg-canvas px-3 py-5 text-sm" aria-hidden>
                <div className="flex items-center gap-2 px-2 mb-6"><Mark className="w-5 h-5" /><span className="font-semibold">SubCleared</span></div>
                {['Overview', 'Projects', 'Subcontractors', 'Documents', 'Reviews', 'Renewals', 'Reports'].map((n) => <div key={n} className={n === 'Projects' ? 'rounded px-2 py-1.5 bg-accent-tint text-accent font-medium' : 'px-2 py-1.5 text-muted'}>{n}{n === 'Reviews' && <span className="float-right text-faint">3</span>}</div>)}
              </aside>
              <div className="p-5 sm:p-7 min-w-0">
                <div className="text-xs text-faint">Projects / Riverside Health Centre</div>
                <div className="flex flex-wrap items-end justify-between gap-3 mt-1.5">
                  <div><div className="text-xl font-medium">Riverside Health Centre</div><div className="text-sm text-muted mt-1">RHC-204 · 5 subcontractors · Managed by Jordan Blake</div></div>
                  <span className="btn-primary btn-sm pointer-events-none" aria-hidden>{Icon.plus()}Assign subcontractors</span>
                </div>
                <div className="mt-5 rounded-md border border-line px-4 py-3 flex flex-wrap items-center gap-x-8 gap-y-2">
                  <div><div className="text-sm"><span className="text-lg font-medium tnum">2 of 5</span> <span className="text-muted">ready to work</span></div><ReadinessBar className="mt-1.5 w-56" ready={2} action={2} notReady={1} total={5} /></div>
                  <div className="text-sm text-muted flex flex-wrap gap-x-5"><span><b className="text-ink tnum font-medium">3</b> not ready</span><span><b className="text-ink tnum font-medium">1</b> with documents to review</span><span><b className="text-ink tnum font-medium">1</b> expiring</span></div>
                </div>
                <ul className="mt-5 border-t border-line-strong">
                  {PREVIEW.map((e) => (
                    <li key={e.co} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_9rem_9.5rem] items-center gap-x-4 gap-y-1 py-3 border-b border-line text-sm">
                      <div className="min-w-0"><div className="font-medium text-base truncate">{e.co}</div><div className="text-faint truncate">{e.trade}</div></div>
                      <div className="hidden sm:block text-ink truncate">{e.issues}</div>
                      <div><ReadinessBadge value={e.r} size="sm" /></div>
                      <div className="hidden sm:block text-right">{e.action && <span className={(e.primary ? 'btn-primary' : 'btn-secondary') + ' btn-sm pointer-events-none'} aria-hidden>{e.action}</span>}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-faint">Illustration of the project readiness view. Company names are invented.</p>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8 mt-28 grid lg:grid-cols-[1fr_1.4fr] gap-x-16 gap-y-8">
          <h2 className="text-3xl font-medium tracking-[-0.02em] leading-tight">Before anyone starts on site, you need an answer.</h2>
          <div className="text-lg text-muted leading-relaxed space-y-5">
            <p>Is this subcontractor ready to work on this project — and can you show why? Today that answer lives in inboxes, shared drives and a spreadsheet someone forgot to update.</p>
            <p>SubCleared keeps the requirements, the documents and the decisions together, so the answer is on screen for every project, with the evidence one click away.</p>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8 mt-24">
          <h2 className="text-2xl font-medium">How it works</h2>
          <ol className="mt-8 grid md:grid-cols-2 lg:grid-cols-4 gap-x-10 border-t border-line-strong">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="pt-6 pb-8">
                <div className="font-mono text-sm text-accent">{String(i + 1).padStart(2, '0')}</div>
                <h3 className="mt-3 text-md font-semibold">{t}</h3>
                <p className="mt-2 text-muted leading-relaxed">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8 mt-20">
          <div className="grid md:grid-cols-2 gap-x-14">
            {POINTS.map(([t, d]) => <div key={t} className="py-6 border-t border-line"><h3 className="text-md font-semibold">{t}</h3><p className="mt-2 text-muted leading-relaxed">{d}</p></div>)}
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8 mt-24">
          <h2 className="text-3xl font-medium tracking-[-0.02em]">Received, reviewed, verified — never blurred.</h2>
          <div className="mt-10 grid md:grid-cols-3 gap-x-14">
            {[
              ['none', 'Received', 'A file arrived and passed security checks. It does not count towards readiness yet.'],
              ['progress', 'Reviewed', 'Someone checked it against your stated requirements and approved it. Now it counts.'],
              ['ok', 'Independently verified', 'Confirmed with the broker, insurer or issuing body — with a record of who confirmed it.'],
            ].map(([g, t, d]) => (
              <div key={t} className="py-6 border-t border-line"><div className="flex items-center gap-2.5 font-medium"><Glyph tone={g as any} />{t}</div><p className="mt-2 text-muted leading-relaxed">{d}</p></div>
            ))}
          </div>
          <p className="mt-6 text-sm text-faint max-w-3xl">An insurance certificate is evidence of cover, not proof of it. SubCleared keeps these states separate and never calls a document verified unless someone recorded a genuine verification.</p>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8 mt-24">
          <div className="border-t border-b border-line-strong py-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div><h2 className="text-2xl font-medium">Simple enough for day one. Thorough enough for your audit file.</h2><p className="mt-2 text-muted">For contractors working with anything from a handful to a few hundred subcontractors.</p></div>
            <Link to="/signup" className="btn-primary btn-lg shrink-0">Start free trial</Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
