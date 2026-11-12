import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '../../domain/dates';
import { term } from '../../domain/locale';
import { useApi, useMutation } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Callout, cx, ErrorState, FilterSelect, Glyph, Icon, PageLoading, Spinner, useToast } from '../../ui';
import { AskBox } from './Ask';

function greeting(timezone: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: timezone }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Overview() {
  const { me, can } = useSession();
  const [f, setF] = useState<{ projectId?: string }>({});
  const { data, error, loading, reload } = useApi<any>('dashboard', f);
  const projects = useApi<any>('projects.list');
  const sample = useMutation('org.loadSample');
  const toast = useToast();
  if (loading && !data) return <PageLoading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const org = me!.org!;
  const fresh = !data.hasProjects || !data.hasAssignments || (!data.hasRequests && !data.hasSample);
  return (
    <div>
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{formatDate(data.today)}</p>
          <h1 className="text-2xl font-medium mt-1">{greeting(org.settings.timezone)}{data.firstName ? `, ${data.firstName}` : ''}.</h1>
          <p className="text-muted mt-1.5">{fresh ? 'Three steps to your first answer on who is ready to work.' : 'Here’s what needs your attention today.'}</p>
        </div>
<div className="flex flex-wrap items-center gap-2">
          {data.hasProjects && <FilterSelect label="Project" all="All active" value={f.projectId ?? ''} onChange={(v) => setF({ projectId: v || undefined })} options={(projects.data?.items ?? []).filter((p: any) => !['archived', 'completed'].includes(p.status)).map((p: any) => ({ value: p.id, label: p.name }))} />}
          {!fresh && can('projects.create') && <Link to="/app/projects?new=1" className="btn-secondary">{Icon.plus()}New project</Link>}
          {!fresh && can('subs.manage') && <Link to="/app/subcontractors?new=1" className="btn-secondary">{Icon.plus()}Add subcontractor</Link>}
        </div>
      </header>

      {fresh && <Onboarding data={data} onSample={can('settings.manage') && !data.hasSample ? async () => { try { await sample.run({}); toast('Sample projects and subcontractors added'); } catch (e: any) { toast(e.message, 'bad'); } } : undefined} sampleBusy={sample.busy} market={org.settings.market} />}

      {!fresh && (
        <div className="max-w-3xl">
          {data.mailHealth && data.mailHealth.status !== 'ok' && (
            <div className="mb-8"><Callout tone="bad" title="Emails to subcontractors aren’t being delivered">
              {data.mailHealth.status === 'sender_unverified' ? 'The sending domain isn’t verified with the email provider, so requests and reminders can’t go out. ' : data.mailHealth.status === 'testing_only' ? 'Email is in test mode and only reaches the account owner. ' : 'The last email failed to send. '}
              Requests still create links you can copy. <Link to="/app/settings/delivery" className="link">See how to fix it</Link>
            </Callout></div>
          )}
          <Summary data={data} />
          {data.readingOn && <AskBox className="mt-8" />}

          <section aria-labelledby="action-h" className="mt-10">
            <div className="flex items-baseline justify-between gap-3"><h2 id="action-h" className="text-lg font-semibold">Needs your attention</h2>{data.needsTotal > 0 && <span className="text-sm text-faint tnum">{data.needsTotal} item{data.needsTotal === 1 ? '' : 's'}</span>}</div>
            {data.needs.length === 0 ? (
              <div className="mt-4 flex gap-3 items-start border-t border-line-strong pt-4"><Glyph tone="ok" className="w-4 h-4 mt-1" /><p className="text-muted">You’re all caught up. Requests and reminders are running on their own; anything that needs a decision will appear here.</p></div>
            ) : (
              <ul className="mt-3 border-t border-line-strong">
                {data.needs.map((n: any, i: number) => (
                  <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-3.5 border-b border-line">
                    <Glyph tone={n.tone} className="w-3.5 h-3.5" />
                    <div className="min-w-0"><Link to={n.itemLink} className="font-medium hover:underline underline-offset-4 break-words">{n.item}</Link>{n.context && <span className="text-sm text-faint"> · {n.context}</span>}<div className="text-sm text-muted">{n.issue}</div></div>
                    <Link to={n.link} className={cx('btn-sm whitespace-nowrap', i === 0 ? 'btn-primary' : 'btn-secondary')}>{n.action}</Link>
                  </li>
                ))}
              </ul>
            )}
            {data.needsTotal > data.needs.length && <p className="text-sm text-faint mt-3">Showing the {data.needs.length} most urgent. Open a project to see everything on it.</p>}
          </section>

          {data.projects.length > 0 && (
            <section aria-labelledby="proj-h" className="mt-12">
              <div className="flex items-baseline justify-between"><h2 id="proj-h" className="text-lg font-semibold">Projects</h2><Link to="/app/projects" className="btn-quiet">All projects</Link></div>
              <ul className="mt-3 border-t border-line-strong">{data.projects.slice(0, 6).map((p: any) => (
                <li key={p.id} className="border-b border-line">
                  <Link to={`/app/projects/${p.id}`} className="flex items-center justify-between gap-4 py-3.5 hover:bg-raised/50 -mx-3 px-3 rounded">
                    <span className="min-w-0 font-medium truncate">{p.name}</span>
                    <span className="tnum text-sm shrink-0 text-muted">{p.readyPct === null ? 'No one assigned yet' : p.ready === p.assigned ? <span className="inline-flex items-center gap-1.5"><Glyph tone="ok" className="w-3.5 h-3.5" />All {p.assigned} ready</span> : <><span className="text-ink font-medium">{p.ready}</span> of {p.assigned} ready</>}</span>
                  </Link>
                </li>
              ))}</ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** One plain sentence: what needs attention right now, or that nothing does. */
function Summary({ data }: { data: any }) {
  const m = data.metrics;
  const expired = data.attention.find((a: any) => a.key === 'expired')?.count ?? 0;
  const parts: { n: number; text: string; to: string }[] = [
    { n: m.attention, text: `${m.attention} subcontractor${m.attention === 1 ? ' needs' : 's need'} attention`, to: '/app/subcontractors?readiness=attention' },
    { n: data.review.total, text: data.review.looksGood === data.review.total && data.review.total ? `${data.review.total} document${data.review.total === 1 ? ' is' : 's are'} ready to confirm` : `${data.review.total} document${data.review.total === 1 ? ' needs' : 's need'} review`, to: '/app/reviews' },
    { n: expired, text: `${expired} insurance document${expired === 1 ? ' has' : 's have'} expired`, to: '/app/renewals?window=expired' },
    { n: data.inbox, text: `${data.inbox} emailed document${data.inbox === 1 ? ' needs' : 's need'} matching`, to: '/app/inbox' },
  ].filter((x) => x.n > 0);
  const assessed = m.activeSubcontractors - m.notEvaluated;
  return (
    <div className="border-l-2 border-accent pl-5">
      {parts.length === 0 ? (
        <p className="text-xl font-medium leading-snug">You’re all caught up. No paperwork needs your attention.</p>
      ) : (
        <p className="text-xl font-medium leading-snug">{parts.map((p, i) => <Fragment key={p.to}>{i > 0 && (i === parts.length - 1 ? ' and ' : ', ')}<Link to={p.to} className="underline decoration-line-strong underline-offset-[6px] hover:decoration-ink">{p.text}</Link></Fragment>)}.</p>
      )}
      {assessed > 0 && <p className="text-muted mt-2"><span className="text-ink font-medium tnum">{m.ready}</span> of {assessed} subcontractor{assessed === 1 ? ' is' : 's are'} ready on every project they’re assigned to.</p>}
    </div>
  );
}

function Onboarding({ data, onSample, sampleBusy, market }: { data: any; onSample?: () => void; sampleBusy: boolean; market?: any }) {
  const first = data.projects?.[0];
  const steps = [
    { done: data.hasProjects, title: 'Create your first project', body: 'Give it a name and choose the paperwork it needs from a template. Everything else is optional.', to: '/app/projects?new=1', cta: 'Create a project' },
    { done: data.hasAssignments, title: 'Add the subcontractors working on it', body: 'Pick companies you already have or add new ones with a contact email — right from the project.', to: first ? `/app/projects/${first.id}` : '/app/projects', cta: 'Add subcontractors' },
    { done: data.hasRequests, title: 'Request their paperwork', body: 'One click sends each contact a secure link listing exactly what to upload. They don’t need an account.', to: first ? `/app/projects/${first.id}` : '/app/projects', cta: 'Request paperwork' },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-14">
      <div>
        <p className="text-md">Your workspace is ready. Create your first project to start managing subcontractor paperwork.</p>
        <ol className="mt-6 border-t border-line-strong">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-5 py-6 border-b border-line">
              <span className={cx('w-7 h-7 rounded-full grid place-items-center text-sm shrink-0 tnum', s.done ? 'bg-success text-white' : i === next ? 'border-2 border-accent text-accent-ink font-medium' : 'border border-line-strong text-faint')}>{s.done ? '✓' : i + 1}</span>
              <div className="flex-1">
                <div className={cx('font-medium', s.done && 'text-muted')}>{s.title}</div>
                <p className="text-muted mt-1">{s.body}</p>
                {!s.done && i === next && <Link to={s.to} className="btn-primary mt-4">{s.cta}</Link>}
              </div>
            </li>
          ))}
        </ol>
        <p className="text-sm text-faint mt-4">After that, documents arrive in <span className="text-muted">Documents to review</span>, and each project shows who is ready to work.</p>
      </div>
      {onSample && (
        <aside className="lg:pt-10">
          <h2 className="font-semibold">Want to look around first?</h2>
          <p className="text-muted mt-2 leading-relaxed">Load a few sample projects and subcontractors in different states — some ready, some waiting, some with documents to review. Everything is labelled “Sample” and can be removed in one click.</p>
          <button className="btn-secondary mt-5" disabled={sampleBusy} onClick={onSample}>{sampleBusy && <Spinner />}Load sample data</button>
        </aside>
      )}
    </div>
  );
}
