import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx, Glyph } from '../../ui';
import { PublicFooter, PublicNav } from './PublicShell';

// Every capability shown here exists in the product. Company and people names
// in the illustrations are invented and labelled as illustrations.

/** Fades sections in as they scroll into view. No-op when reduced motion is preferred (see .reveal in styles.css). */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = [...root.querySelectorAll<HTMLElement>('.reveal')];
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('is-in')); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return ref;
}

export default function Landing() {
  const ref = useReveal();
  useEffect(() => {
    // Arriving from another page at /#how or /#features: scroll to the section once it exists.
    const id = window.location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, []);
  return (
    <div className="min-h-screen bg-canvas" ref={ref}>
      <div className="bg-night text-white relative overflow-hidden">
        <div className="absolute inset-0 night-grid pointer-events-none" aria-hidden />
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full bg-accent-bright/10 blur-3xl pointer-events-none" aria-hidden />
        <PublicNav tone="dark" />
        <Hero />
      </div>
      <main>
        <Problem />
        <HowItWorks />
        <Capabilities />
        <FinalCta />
      </main>
      <PublicFooter />
    </div>
  );
}

// --- Hero ------------------------------------------------------------------------------

function Hero() {
  return (
    <section className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-12 sm:pt-20 pb-20 sm:pb-28">
      <div className="max-w-4xl">
        <p className="rise rise-1 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-sm text-white/75">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-bright" />For contractors managing subcontractor paperwork
        </p>
        <h1 className="rise rise-2 mt-7 text-[2.6rem] leading-[1.04] sm:text-6xl sm:leading-[1.02] font-semibold tracking-[-0.035em]">
          Subcontractor compliance, <span className="text-accent-bright">without the paperwork chase.</span>
        </h1>
        <p className="rise rise-3 mt-6 text-lg sm:text-xl text-white/70 leading-relaxed max-w-2xl">
          Collect, check and track subcontractor documents in one place. SubCleared shows what’s missing, checks it against each project, and follows up for you.
        </p>
        <div className="rise rise-4 mt-9 flex flex-wrap gap-3">
          <Link to="/signup" className="btn btn-lg bg-white text-night hover:bg-white/90">Get started</Link>
          <a href="#how" className="btn btn-lg border border-white/20 text-white hover:bg-white/[0.06]">See how it works</a>
        </div>
        <p className="rise rise-4 mt-5 text-sm text-white/55">14-day free trial · No card needed · Free for subcontractors</p>
      </div>
      <div className="rise rise-5 relative mt-14 sm:mt-16">
        <HeroProduct />
      </div>
    </section>
  );
}

const PROJECT_ROWS: { co: string; status: 'ready' | 'action' | 'review' | 'not'; outstanding: string }[] = [
  { co: 'Thameside Electrical', status: 'ready', outstanding: 'Nothing outstanding' },
  { co: 'Pennine Roofing', status: 'action', outstanding: 'Insurance expires in 9 days' },
  { co: 'Midland Groundworks', status: 'review', outstanding: '1 document to confirm' },
  { co: 'Harbour Scaffolding', status: 'not', outstanding: 'Method statement not sent' },
  { co: 'Keystone Plumbing', status: 'ready', outstanding: 'Nothing outstanding' },
];
const STATUS: Record<string, { label: string; tone: 'ok' | 'attention' | 'progress' | 'blocked'; cls: string }> = {
  ready: { label: 'Ready', tone: 'ok', cls: 'text-success font-medium' },
  action: { label: 'Action required', tone: 'attention', cls: 'text-warning' },
  review: { label: 'Needs review', tone: 'progress', cls: 'text-info' },
  not: { label: 'Not ready', tone: 'blocked', cls: 'text-danger' },
};

function Window({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-xl bg-paper text-ink shadow-[0_30px_80px_-20px_rgba(0,0,0,.55),0_0_0_1px_rgba(255,255,255,.06)] overflow-hidden', className)}>
      <div className="flex items-center gap-1.5 px-4 h-9 border-b border-line bg-canvas">
        <span className="h-2.5 w-2.5 rounded-full bg-line-strong" /><span className="h-2.5 w-2.5 rounded-full bg-line-strong" /><span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 text-xs text-faint truncate">{title}</span>
      </div>
      {children}
    </div>
  );
}

function HeroProduct() {
  return (
    <figure className="relative" aria-label="Illustration of a project in SubCleared: five subcontractors with their readiness and what is outstanding. Company names are invented.">
      <Window title="SubCleared · Projects · Quayside Library" className="max-w-4xl">
        <div className="p-5 sm:p-8" aria-hidden>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><div className="text-xs text-faint">Projects</div><div className="text-xl sm:text-2xl font-semibold tracking-[-0.02em] mt-0.5">Quayside Library</div><div className="mt-1 text-sm text-muted"><span className="text-ink font-semibold tnum">2 of 5</span> subcontractors ready to work</div></div>
          </div>
          <div className="mt-4 h-1.5 rounded-full bg-raised overflow-hidden flex"><span className="bg-success w-[40%]" /><span className="bg-warning w-[20%]" /><span className="bg-info w-[20%]" /><span className="bg-danger w-[20%]" /></div>
          <div className="mt-6 hidden sm:grid grid-cols-[1.3fr_1fr_1.3fr] text-xs font-medium text-muted pb-2 border-b border-line-strong"><span>Subcontractor</span><span>Status</span><span>Outstanding</span></div>
          <ul>
            {PROJECT_ROWS.map((r) => (
              <li key={r.co} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1.3fr_1fr_1.3fr] gap-x-4 gap-y-0.5 items-center py-3 border-b border-line text-[0.9375rem]">
                <span className="font-medium truncate">{r.co}</span>
                <span className={cx('inline-flex items-center gap-2 whitespace-nowrap text-sm', STATUS[r.status].cls)}><Glyph tone={STATUS[r.status].tone} className="w-3.5 h-3.5" />{STATUS[r.status].label}</span>
                <span className="col-span-2 sm:col-span-1 text-sm text-muted truncate">{r.outstanding}</span>
              </li>
            ))}
          </ul>
        </div>
      </Window>
      <div className="hidden lg:block absolute -right-6 top-10 w-[19rem] float-slow" aria-hidden>
        <CheckCard />
      </div>
      <div className="hidden md:flex absolute right-24 -bottom-6 items-center gap-2.5 rounded-full bg-paper text-ink pl-3 pr-4 py-2 text-sm shadow-[0_12px_30px_-10px_rgba(0,0,0,.5)]" aria-hidden>
        <span className="grid place-items-center w-6 h-6 rounded-full bg-accent-tint text-accent">{mailIcon}</span>
        Reminder sent to Harbour Scaffolding · automatically
      </div>
    </figure>
  );
}

const mailIcon = <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="m2.5 4.5 5.5 4 5.5-4" /></svg>;

function CheckCard({ className }: { className?: string }) {
  const rows: [string, string][] = [['Names this subcontractor', 'Midland Groundworks Ltd'], ['In date', 'Valid until 30 Jun 2027'], ['Public liability at least £5m', 'Shows £10,000,000'], ['Lasts for Quayside Library', 'Covers to project end']];
  return (
    <div className={cx('rounded-xl bg-paper text-ink p-4 shadow-[0_24px_60px_-18px_rgba(0,0,0,.6)] ring-1 ring-black/5', className)}>
      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-faint">Read automatically</div>
      <div className="mt-1 text-sm font-semibold">Public liability insurance</div>
      <div className="mt-3 rounded-md bg-success-tint px-3 py-2 text-sm flex items-start gap-2"><Glyph tone="ok" className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span><span className="font-medium">Looks right</span><span className="text-muted"> · confirm to approve</span></span></div>
      <ul className="mt-3 space-y-2.5">
        {rows.map(([l, d]) => <li key={l} className="flex gap-2.5 text-sm"><Glyph tone="ok" className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span><span className="font-medium">{l}</span><span className="block text-muted text-[0.8125rem]">{d}</span></span></li>)}
      </ul>
    </div>
  );
}

// --- Problem ---------------------------------------------------------------------------

const PAINS = [
  { t: 'Chasing documents', d: 'The same emails and calls, every project.', icon: <path d="M3 5.5h14v9H3zM3.5 6l6.5 5 6.5-5" /> },
  { t: 'Checking by hand', d: 'Reading every certificate for names, limits and dates.', icon: <><circle cx="9" cy="9" r="5" /><path d="m13 13 4 4" /></> },
  { t: 'Finding gaps too late', d: 'Discovering missing paperwork when someone is already on site.', icon: <><circle cx="10" cy="10" r="7" /><path d="M10 6.5v4M10 13.2v.3" /></> },
  { t: 'Losing track', d: 'Not knowing who is actually ready to start.', icon: <><path d="M4 5h12M4 10h8M4 15h5" /></> },
];

function Problem() {
  return (
    <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-24 sm:pt-32" aria-labelledby="problem-h">
      <div className="reveal max-w-2xl">
        <p className="eyebrow">The problem</p>
        <h2 id="problem-h" className="mt-4 text-3xl sm:text-4xl font-semibold tracking-[-0.03em] leading-tight">Paperwork shouldn’t decide when work can start.</h2>
      </div>
      <ul className="mt-10 sm:mt-12 grid grid-cols-2 lg:grid-cols-4 gap-x-5 sm:gap-x-8 gap-y-8 sm:gap-y-10">
        {PAINS.map((p, i) => (
          <li key={p.t} className="reveal border-t border-line-strong pt-6" style={{ transitionDelay: `${i * 70}ms` }}>
            <svg viewBox="0 0 20 20" className="w-6 h-6 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p.icon}</svg>
            <h3 className="mt-4 text-md sm:text-lg font-semibold">{p.t}</h3>
            <p className="mt-1.5 text-sm sm:text-base text-muted leading-relaxed">{p.d}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- How it works ----------------------------------------------------------------------

function HowItWorks() {
  const steps = [
    { n: '01', t: 'Request documents', d: 'Add subcontractors to a project and send the paperwork it needs in one step. They upload from a secure link, no account needed.', visual: <RequestVisual /> },
    { n: '02', t: 'Review automatically', d: 'Each document is read and compared with the project’s requirements. You confirm, or see exactly what doesn’t match.', visual: <CheckCard className="shadow-none ring-1 ring-line" /> },
    { n: '03', t: 'Stay on top of it', d: 'See what’s missing, what needs attention and what’s about to expire. Reminders go out on their own and stop when documents arrive.', visual: <StatusVisual /> },
  ];
  return (
    <section id="how" className="max-w-6xl mx-auto px-5 sm:px-8 pt-24 sm:pt-32 scroll-mt-20" aria-labelledby="how-h">
      <div className="reveal max-w-2xl">
        <p className="eyebrow">How it works</p>
        <h2 id="how-h" className="mt-4 text-3xl sm:text-4xl font-semibold tracking-[-0.03em] leading-tight">From request to ready, in three steps.</h2>
      </div>
      <ol className="mt-12 grid lg:grid-cols-3 gap-6">
        {steps.map((s, i) => (
          <li key={s.n} className="reveal min-w-0 rounded-2xl bg-paper border border-line p-6 sm:p-7 flex flex-col" style={{ transitionDelay: `${i * 90}ms` }}>
            <div className="font-mono text-sm text-accent">{s.n}</div>
            <h3 className="mt-3 text-xl font-semibold tracking-[-0.015em]">{s.t}</h3>
            <p className="mt-2 text-muted leading-relaxed">{s.d}</p>
            <div className="mt-7 flex-1 rounded-xl bg-canvas p-4 sm:p-5 flex items-center" aria-hidden>
              <div className="w-full">{s.visual}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RequestVisual() {
  return (
    <div className="rounded-xl bg-paper ring-1 ring-line p-4">
      <div className="text-xs text-faint break-all">To: aoife@leeelectrical.example</div>
      <div className="mt-1 text-sm font-semibold">Harbourline needs documents from Lee Electrical</div>
      <ul className="mt-3 space-y-1.5 text-sm text-muted">
        {['Public liability insurance', "Employers' liability insurance", 'Method statement'].map((d) => <li key={d} className="flex items-center gap-2"><span className="h-1 w-1 rounded-full bg-muted" />{d}</li>)}
      </ul>
      <div className="mt-4 inline-flex items-center rounded bg-accent text-white text-sm font-medium h-9 px-4">Upload documents</div>
      <div className="mt-2 text-xs text-faint">Secure link · works on any phone</div>
    </div>
  );
}

function StatusVisual() {
  const rows: [string, string, 'ok' | 'attention' | 'blocked'][] = [['Thameside Electrical', 'Ready', 'ok'], ['Pennine Roofing', 'Expires in 9 days', 'attention'], ['Harbour Scaffolding', 'Reminder sent, day 3', 'blocked']];
  return (
    <div className="rounded-xl bg-paper ring-1 ring-line p-4">
      <div className="text-sm font-semibold">Needs your attention</div>
      <ul className="mt-2">
        {rows.map(([c, s, t]) => <li key={c} className="flex items-start gap-2.5 py-2.5 border-b border-line last:border-0 text-sm"><Glyph tone={t} className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span className="min-w-0"><span className="block font-medium">{c}</span><span className="block text-muted">{s}</span></span></li>)}
      </ul>
    </div>
  );
}

// --- Capabilities ----------------------------------------------------------------------

const MORE: { t: string; d: string; icon: ReactNode; tag?: string }[] = [
  { t: 'Expiry monitoring', d: 'Renewals are requested before documents lapse.', icon: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></> },
  { t: 'Automatic reminders', d: 'Follow-ups within your working hours, stopped when documents arrive.', icon: <path d="M5 8a5 5 0 0 1 10 0c0 5 2 6 2 6H3s2-1 2-6M8.5 17a1.7 1.7 0 0 0 3 0" /> },
  { t: 'Email documents in', d: 'Subcontractors and brokers can simply email paperwork to your address.', icon: <><rect x="2.5" y="4.5" width="15" height="11" rx="1.5" /><path d="m3 5.5 7 5 7-5" /></> },
  { t: 'Ask about your records', d: 'Plain questions, answered from your own data with links to the records.', icon: <><path d="M4 5.5h12v8H8l-4 3z" /></>, tag: 'Growth plan' },
];

function Capabilities() {
  return (
    <section id="features" className="max-w-6xl mx-auto px-5 sm:px-8 pt-24 sm:pt-32 scroll-mt-20" aria-labelledby="cap-h">
      <div className="reveal max-w-2xl">
        <p className="eyebrow">What it does</p>
        <h2 id="cap-h" className="mt-4 text-3xl sm:text-4xl font-semibold tracking-[-0.03em] leading-tight">The routine work happens on its own.</h2>
        <p className="mt-4 text-lg text-muted leading-relaxed">You step in when a decision is needed. A person always gives the final approval.</p>
      </div>

      <div className="mt-12 grid lg:grid-cols-[1.25fr_1fr] gap-6">
        <div className="reveal rounded-2xl bg-night text-white p-7 sm:p-9 relative overflow-hidden">
          <div className="absolute inset-0 night-grid opacity-60 pointer-events-none" aria-hidden />
          <div className="relative">
            <h3 className="text-2xl font-semibold tracking-[-0.02em]">Every document read and checked</h3>
            <p className="mt-2 text-white/70 leading-relaxed max-w-md">Names, dates, policy numbers and limits are picked out and compared with what each project requires, with the source on the page.</p>
            <div className="mt-8 grid sm:grid-cols-2 gap-3 text-sm" aria-hidden>
              {[['Named insured', 'Midland Groundworks Ltd'], ['Expiry date', '30 Jun 2027'], ['Policy number', 'HM-2231'], ['Liability limit', '£10,000,000']].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-white/[0.06] border border-white/10 px-4 py-3"><div className="text-white/55 text-xs">{k}</div><div className="mt-0.5 font-medium">{v}</div></div>
              ))}
            </div>
          </div>
        </div>
        <div className="reveal rounded-2xl bg-paper border border-line p-7 sm:p-9" style={{ transitionDelay: '90ms' }}>
          <h3 className="text-2xl font-semibold tracking-[-0.02em]">Ready, project by project</h3>
          <p className="mt-2 text-muted leading-relaxed">The same company can be ready on one job and not another. Each status comes with the reason.</p>
          <ul className="mt-7 space-y-3 text-[0.9375rem]" aria-hidden>
            <li className="flex items-start gap-2.5"><Glyph tone="ok" className="w-4 h-4 mt-0.5" /><span><b className="font-medium">Ready</b><span className="block text-muted text-sm">All mandatory paperwork approved and in date</span></span></li>
            <li className="flex items-start gap-2.5"><Glyph tone="attention" className="w-4 h-4 mt-0.5" /><span><b className="font-medium">Action required</b><span className="block text-muted text-sm">Insurance certificate expires in 9 days</span></span></li>
            <li className="flex items-start gap-2.5"><Glyph tone="blocked" className="w-4 h-4 mt-0.5" /><span><b className="font-medium">Not ready</b><span className="block text-muted text-sm">Public liability insurance hasn’t been sent</span></span></li>
          </ul>
        </div>
      </div>

      <ul className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-6 sm:gap-6">
        {MORE.map((m, i) => (
          <li key={m.t} className="reveal py-2" style={{ transitionDelay: `${i * 70}ms` }}>
            <span className="grid place-items-center w-10 h-10 rounded-lg bg-accent-tint text-accent">
              <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{m.icon}</svg>
            </span>
            <h3 className="mt-4 text-md sm:text-lg font-semibold flex flex-wrap items-center gap-x-2">{m.t}{m.tag && <span className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-faint">{m.tag}</span>}</h3>
            <p className="mt-1.5 text-sm sm:text-base text-muted leading-relaxed">{m.d}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Final call to action -------------------------------------------------------------

function FinalCta() {
  return (
    <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-24 sm:pt-32" aria-labelledby="cta-h">
      <div className="reveal relative overflow-hidden rounded-3xl bg-night text-white px-7 py-14 sm:px-14 sm:py-20 text-center">
        <div className="absolute inset-0 night-grid pointer-events-none" aria-hidden />
        <div className="absolute -bottom-40 left-1/2 -translate-x-1/2 w-[700px] h-[360px] rounded-full bg-accent-bright/15 blur-3xl pointer-events-none" aria-hidden />
        <div className="relative">
          <h2 id="cta-h" className="text-3xl sm:text-5xl font-semibold tracking-[-0.035em] leading-[1.08] max-w-3xl mx-auto">Spend less time chasing paperwork. <span className="text-accent-bright">More time keeping projects moving.</span></h2>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/signup" className="btn btn-lg bg-white text-night hover:bg-white/90">Get started</Link>
            <Link to="/pricing" className="btn btn-lg border border-white/20 text-white hover:bg-white/[0.06]">See pricing</Link>
          </div>
          <p className="mt-5 text-sm text-white/55">14-day free trial · No card needed</p>
        </div>
      </div>
    </section>
  );
}
