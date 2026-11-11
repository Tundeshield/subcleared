import { Link } from 'react-router-dom';
import { Glyph, ReadinessBadge, ReadinessBar } from '../../ui';
import { PublicFooter, PublicNav } from './PublicShell';

const EXAMPLE = [
  { co: 'Thameside Electrical Services', trade: 'Electrical', r: 'ready', why: 'All 8 mandatory requirements approved and in date' },
  { co: 'Pennine Roofing & Cladding', trade: 'Roofing', r: 'action_required', why: 'Public liability expires in 18 days — renewal requested' },
  { co: 'Midland Groundworks', trade: 'Groundworks', r: 'not_ready', why: "Employers' liability rejected: named insured doesn't match" },
  { co: 'Northern Mechanical Services', trade: 'HVAC', r: 'action_required', why: 'RAMS submitted, awaiting review' },
];

const CAPABILITIES = [
  ['Readiness per project', 'The same subcontractor can be cleared for one site and held back on another. Each project sets its own requirements, and readiness is worked out for every assignment — with the reason spelled out.'],
  ['Paperwork without the chase', 'Send each contact a secure, expiring link. They upload from a phone without creating an account, see exactly what was rejected and why, and replace it.'],
  ['Review that means something', 'Nothing counts until a reviewer approves it against the requirement. Automatic reading suggests the details; a person confirms them.'],
  ['Renewals on schedule', 'Reminders at 90, 60, 30, 14 and 7 days, on expiry and after — each sent once, in your timezone. The old version is always kept.'],
  ['Evidence you can stand behind', 'Every submission, decision, correction and status change is recorded with who, when and why. Past readiness keeps the rules it was judged by.'],
  ['Reports for the site team', 'Project readiness, outstanding and expiring documents, review activity and a full audit trail — as a clean PDF or CSV.'],
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      <PublicNav />
      <main>
        <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-20 sm:pt-28 pb-20">
          <p className="eyebrow">Subcontractor compliance &amp; readiness</p>
          <h1 className="mt-6 text-4xl sm:text-5xl font-medium tracking-[-0.025em] leading-[1.05] max-w-3xl">Know who's ready to work.</h1>
          <p className="mt-7 text-lg text-muted max-w-2xl leading-relaxed">Manage subcontractor onboarding, project requirements, compliance documents and renewals in one place. See what's outstanding, what's been approved and what needs attention before work begins.</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link to="/signup" className="btn-primary btn-lg">Start a 14-day free trial</Link>
            <Link to="/pricing" className="btn-secondary btn-lg">See pricing</Link>
          </div>
          <p className="mt-5 text-sm text-faint">No card needed. Subcontractors never pay to submit documents.</p>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8" aria-label="Example project view">
          <div className="border-t border-charcoal pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div><div className="text-xl font-medium">Kings Cross Office Fit-out</div><div className="text-sm text-muted mt-1">KCX-114 · London · 4 subcontractors</div></div>
              <span className="text-xs text-faint uppercase tracking-[0.1em]">Illustrative example</span>
            </div>
            <div className="mt-5 max-w-sm"><div className="text-sm tnum"><span className="font-medium">1</span><span className="text-muted"> of 4 ready</span></div><ReadinessBar className="mt-2" ready={1} action={2} notReady={1} total={4} /></div>
            <div className="mt-8 overflow-x-auto">
              <table className="table min-w-[720px]">
                <thead><tr><th className="th">Subcontractor</th><th className="th">Trade</th><th className="th">Readiness</th><th className="th">Why</th></tr></thead>
                <tbody>{EXAMPLE.map((e) => <tr key={e.co}><td className="td font-medium">{e.co}</td><td className="td text-muted">{e.trade}</td><td className="td"><ReadinessBadge value={e.r} size="sm" /></td><td className="td text-muted">{e.why}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8 mt-32 grid lg:grid-cols-[1fr_1.5fr] gap-x-16 gap-y-8">
          <h2 className="text-3xl font-medium tracking-[-0.02em] leading-tight">One question, answered with evidence.</h2>
          <div className="text-lg text-muted leading-relaxed space-y-5">
            <p>Before anyone sets foot on site, you need to know: is this subcontractor ready to work on this project — and can you show why?</p>
            <p>SubCleared turns that from a spreadsheet hunt into an answer you can read at a glance, with the requirement, the document and the decision behind every status.</p>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8 mt-28">
          <ol className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-14 border-t border-charcoal">
            {CAPABILITIES.map(([t, d], i) => (
              <li key={t} className="pt-7 pb-10 border-b border-line">
                <div className="font-mono text-sm text-field">{String(i + 1).padStart(2, '0')}</div>
                <h3 className="mt-3 text-lg font-semibold">{t}</h3>
                <p className="mt-2 text-muted leading-relaxed">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8 mt-28">
          <h2 className="text-3xl font-medium tracking-[-0.02em]">Received, reviewed, verified — never blurred.</h2>
          <div className="mt-10 grid md:grid-cols-3 gap-x-14">
            {[
              ['none', 'Received', 'A file arrived and passed security checks. It doesn’t count yet.'],
              ['ok', 'Reviewed', 'Someone checked it against your stated requirements and approved it.'],
              ['ok', 'Independently verified', 'Confirmed with the broker, insurer or register — and recorded who confirmed it.'],
            ].map(([g, t, d]) => (
              <div key={t} className="py-6 border-t border-line"><div className="flex items-center gap-2.5 font-medium"><Glyph tone={g as any} />{t}</div><p className="mt-2 text-muted leading-relaxed">{d}</p></div>
            ))}
          </div>
          <p className="mt-6 text-sm text-faint max-w-3xl">A certificate of insurance is evidence of cover, not proof of it. SubCleared keeps these states separate and never calls a document verified unless someone recorded a genuine verification.</p>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8 mt-28 grid lg:grid-cols-2 gap-x-16 gap-y-6">
          <div><h2 className="text-3xl font-medium tracking-[-0.02em]">Built for the US and the UK.</h2></div>
          <div className="text-muted leading-relaxed space-y-4 text-lg">
            <p>General contractor or principal contractor. Certificate of insurance or insurance certificate. General liability or public liability, workers' compensation or employers' liability.</p>
            <p>SubCleared speaks your market's language and starts you with templates to match — every requirement stays yours to change.</p>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-5 sm:px-8 mt-28">
          <div className="border-t border-b border-charcoal py-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div><h2 className="text-2xl font-medium">For contractors running 20 to 200 subcontractors.</h2><p className="mt-2 text-muted">Simple enough for a project administrator on day one. Thorough enough for your audit file.</p></div>
            <Link to="/signup" className="btn-primary btn-lg shrink-0">Start free trial</Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
