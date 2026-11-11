import { Link } from 'react-router-dom';
import { cx, Icon, ReadinessBadge } from '../../ui';
import { PublicFooter, PublicNav } from './PublicShell';

const EXAMPLE = [
  { co: 'Northgate Electrical', trade: 'Electrical', r: 'ready', why: 'All 6 mandatory requirements approved and in date' },
  { co: 'Harbour Roofing', trade: 'Roofing', r: 'action_required', why: 'General liability expires in 18 days' },
  { co: 'Kestrel Groundworks', trade: 'Civils', r: 'not_ready', why: "Workers' compensation rejected — wrong named insured" },
  { co: 'Fenwick Mechanical', trade: 'HVAC', r: 'action_required', why: 'Risk assessment submitted, awaiting review' },
];

const FEATURES = [
  { t: 'Readiness per project, not per company', d: 'The same subcontractor can be cleared for one site and blocked on another. Requirements are set per project and readiness is calculated for every assignment.' },
  { t: 'Collect paperwork without the email chase', d: 'Send a secure, expiring link. Subcontractors upload from their phone without creating an account, see what was rejected and why, and replace it.' },
  { t: 'Review, don’t just receive', d: 'Nothing counts until a reviewer approves it against the requirement. AI proposes fields; a person confirms them. Received, reviewed and independently verified are kept distinct.' },
  { t: 'Renewals that run themselves', d: 'Reminders at 90, 60, 30, 14 and 7 days, on expiry and after — once each, in your timezone. Replacements are reviewed and the old version is kept.' },
  { t: 'Evidence you can stand behind', d: 'Every upload, decision, metadata correction and status change is recorded with who, when and why. Historical readiness keeps the rules that produced it.' },
  { t: 'Reports a project manager can use', d: 'Project readiness, missing and expiring documents, rejected items and audit trails — filtered, exported to CSV or PDF in a click.' },
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      <PublicNav />
      <section className="relative overflow-hidden border-b border-line">
        <div className="absolute inset-0 grid-bg opacity-40 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" aria-hidden />
        <div className="relative max-w-6xl mx-auto px-5 pt-20 pb-16 sm:pt-28 sm:pb-24">
          <p className="eyebrow text-accent">Subcontractor compliance &amp; readiness</p>
          <h1 className="mt-4 text-4xl sm:text-5xl font-semibold tracking-tight max-w-4xl leading-[1.05]">
            Know which subcontractors are ready to work, what’s missing and what needs attention.
          </h1>
          <p className="mt-6 text-lg text-muted max-w-2xl">
            Manage subcontractor onboarding, project requirements, compliance documents and renewals in one place. Collect paperwork without endless email follow-ups and keep reliable records across every project.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/signup" className="btn-primary btn-lg">Start a 14-day free trial</Link>
            <Link to="/pricing" className="btn-secondary btn-lg">See pricing</Link>
          </div>
          <p className="mt-4 text-sm text-faint">No card required. Subcontractors never pay to submit documents.</p>

          <div className="mt-14 panel overflow-hidden shadow-pop">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line">
              <div className="text-sm font-medium">Riverside Apartments · Phase 2 <span className="text-faint font-normal">— readiness</span></div>
              <span className="text-xs text-faint">Illustrative example</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead><tr><th className="th">Subcontractor</th><th className="th">Trade</th><th className="th">Readiness</th><th className="th">Why</th></tr></thead>
                <tbody>{EXAMPLE.map((e) => (
                  <tr key={e.co}><td className="td font-medium">{e.co}</td><td className="td text-muted">{e.trade}</td><td className="td"><ReadinessBadge value={e.r} /></td><td className="td text-muted">{e.why}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 py-20">
        <div className="grid lg:grid-cols-[1fr_1.4fr] gap-10 items-start">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">One question, answered with evidence.</h2>
            <p className="mt-4 text-muted text-lg">Is this subcontractor ready to work on this project — and can you show why?</p>
          </div>
          <ol className="grid sm:grid-cols-2 gap-px bg-line border border-line rounded-md overflow-hidden">
            {['Set requirements per project, from templates you control.', 'Assign subcontractors and send one secure request link.', 'Review each submission against the requirement.', 'See readiness, with the exact reason behind every status.'].map((s, i) => (
              <li key={i} className="bg-surface p-5"><div className="text-accent font-mono text-sm">0{i + 1}</div><div className="mt-2">{s}</div></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-y border-line bg-surface/50">
        <div className="max-w-6xl mx-auto px-5 py-20 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-12">
          {FEATURES.map((f) => (
            <div key={f.t}>
              <div className="w-8 h-8 rounded grid place-items-center bg-accent/10 text-accent">{Icon.check()}</div>
              <h3 className="mt-4 text-lg font-semibold">{f.t}</h3>
              <p className="mt-2 text-muted">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 py-20">
        <div className="grid md:grid-cols-3 gap-6">
          {[
            ['Received', 'A file arrived and passed security checks.', 'text-faint'],
            ['Reviewed', 'A person checked it against your stated requirements.', 'text-ok'],
            ['Independently verified', 'Confirmed with the broker, insurer or register — and recorded who confirmed it.', 'text-accent'],
          ].map(([t, d, c]) => (
            <div key={t} className="panel p-5"><div className={cx('text-sm font-medium', c)}>{t}</div><p className="mt-2 text-muted">{d}</p></div>
          ))}
        </div>
        <p className="mt-6 text-sm text-faint max-w-3xl">A certificate of insurance is evidence, not proof of coverage. SubCleared keeps these three states separate and never claims a document was verified unless someone recorded a genuine verification.</p>
      </section>

      <section className="max-w-6xl mx-auto px-5">
        <div className="panel p-8 sm:p-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div><h2 className="text-2xl font-semibold">Built for contractors running 20 to 200 subcontractors.</h2><p className="mt-2 text-muted">Simple enough for a project administrator on day one. Robust enough for your audit file.</p></div>
          <Link to="/signup" className="btn-primary btn-lg shrink-0">Start free trial</Link>
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}
