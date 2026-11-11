import { useState } from 'react';
import { Link } from 'react-router-dom';
import { READINESS_LABELS } from '../../domain/compliance';
import { formatDate, formatDateTime } from '../../domain/dates';
import { term } from '../../domain/locale';
import { useApi, useMutation } from '../../lib/api';
import { useSession } from '../../lib/session';
import { cx, ErrorState, FilterSelect, Glyph, humanize, Icon, Metric, PageLoading, ReadinessBar, Spinner, useToast } from '../../ui';

function greeting(timezone: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: timezone }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const STAGE: Record<string, string> = { not_requested: 'Not requested', requested: 'Renewal requested', acknowledged: 'Opened by subcontractor', replacement_received: 'Replacement awaiting review' };

/** Plain-language activity line from an audit event. */
function describe(e: any): string {
  const who = e.actor.name.replace(/ \(.+\)$/, '');
  const what = e.entity.label ?? '';
  const map: Record<string, string> = {
    'document.uploaded': `submitted ${what}`, 'document.replaced': `submitted a new version of ${what}`, 'document.approved': `approved ${what}`, 'document.rejected': `rejected ${what}`,
    'document.info_requested': `asked for more information on ${what}`, 'document.archived': `archived ${what}`, 'request.sent': `requested documents from ${what.split(' — ')[0]}`,
    'request.portal_invited': `invited ${what.split(' — ')[0]} to the portal`, 'subcontractor.created': `added ${what}`, 'subcontractor.imported': 'imported subcontractors',
    'subcontractor.suspended': `suspended ${what}`, 'subcontractor.archived': `archived ${what}`, 'subcontractor.restored': `restored ${what}`, 'project.created': `created ${what}`,
    'project.template_applied': `applied a template to ${what}`, 'project.subcontractor_assigned': `assigned ${what.replace(' → ', ' to ')}`, 'requirement.created': `created the requirement ${what}`,
    'requirement.changed': `updated the requirement ${what}`, 'requirement.marked_not_applicable': `marked a requirement not applicable for ${what}`, 'template.created': `created the template ${what}`,
    'template.changed': `updated the template ${what}`, 'member.joined': 'joined the team', 'member.invited': `invited ${what}`, 'notification.renewal_reminder': `sent a renewal reminder for ${what}`,
  };
  if (e.action === 'compliance.status_changed') return `${what} is now ${(READINESS_LABELS as any)[e.after?.readiness]?.toLowerCase() ?? 'updated'}`;
  return `${who} ${map[e.action] ?? humanize(e.action.split('.').slice(1).join(' '))}`;
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
  const m = data.metrics;
  const fresh = !data.hasProjects || !data.hasSubs || !data.hasAssignments;
  const attention = data.attention.filter((a: any) => a.count > 0);
  return (
    <div>
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{formatDate(data.today)}</p>
          <h1 className="text-2xl font-medium mt-1">{greeting(org.settings.timezone)}{data.firstName ? `, ${data.firstName}` : ''}.</h1>
          <p className="text-muted mt-1.5">{fresh ? `Let's get your first project ready to ${term(org.settings.market, 'mobilise')}.` : `Here's where your subcontractor readiness stands today.`}</p>
        </div>
<div className="flex flex-wrap items-center gap-2">
          {data.hasProjects && <FilterSelect label="Project" all="All active" value={f.projectId ?? ''} onChange={(v) => setF({ projectId: v || undefined })} options={(projects.data?.items ?? []).filter((p: any) => !['archived', 'completed'].includes(p.status)).map((p: any) => ({ value: p.id, label: p.name }))} />}
          {!fresh && can('projects.create') && <Link to="/app/projects?new=1" className="btn-secondary">{Icon.plus()}New project</Link>}
          {!fresh && can('subs.manage') && <Link to="/app/subcontractors?new=1" className="btn-secondary">{Icon.plus()}Add subcontractor</Link>}
        </div>
      </header>

      {fresh && <Onboarding data={data} onSample={can('settings.manage') && !data.hasSample ? async () => { try { await sample.run({}); toast('Sample projects and subcontractors added'); } catch (e: any) { toast(e.message, 'bad'); } } : undefined} sampleBusy={sample.busy} market={org.settings.market} />}

      {!fresh && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-6 pb-8 border-b border-line">
            <Metric label="Active projects" value={m.activeProjects} to="/app/projects" />
            <Metric label="Active subcontractors" value={m.activeSubcontractors} to="/app/subcontractors" />
            <Metric label="Ready to work" value={m.ready} emphasis="success" to="/app/subcontractors?readiness=ready" hint="on every assigned project" />
            <Metric label="Requiring attention" value={m.attention} emphasis={m.attention > 0 ? 'danger' : undefined} to="/app/subcontractors?readiness=attention" hint={`${m.notReady} not ready`} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] [&>section]:min-w-0 gap-x-14 gap-y-12 mt-10">
            <section aria-labelledby="action-h">
              <div className="flex items-baseline justify-between"><h2 id="action-h" className="text-lg font-semibold">Action required</h2>{attention.length > 0 && <span className="text-sm text-faint">{data.actionsTotal} open item{data.actionsTotal === 1 ? '' : 's'}</span>}</div>
              {attention.length === 0 ? (
                <div className="mt-4 flex gap-3 items-start border-t border-line pt-4"><Glyph tone="ok" className="w-4 h-4 mt-1" /><p className="text-muted">Nothing needs your attention. Every assigned subcontractor is ready or has nothing outstanding.</p></div>
              ) : (
                <>
                  <ul className="mt-4 border-t border-line-strong">
                    {attention.map((a: any) => (
                      <li key={a.key} className="border-b border-line">
                        <Link to={a.link} className="group flex items-center gap-4 py-4 hover:bg-raised/50 -mx-3 px-3 rounded">
                          <span className="text-2xl w-12 tnum font-normal">{a.count}</span>
                          <span className="flex-1">{a.label}</span>
                          <span className="text-sm text-accent font-medium flex items-center gap-1 opacity-80 group-hover:opacity-100">{a.action}{Icon.arrow()}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {data.actions.length > 0 && (
                    <div className="mt-6">
                      <div className="eyebrow mb-2">Next steps</div>
                      <ul>{data.actions.map((a: any, i: number) => (
                        <li key={i}><Link to={a.link} className="flex items-start gap-3 py-2.5 hover:bg-raised/50 -mx-3 px-3 rounded">
                          <Glyph tone={a.kind === 'review' ? 'progress' : 'blocked'} className="w-3.5 h-3.5 mt-1" />
                          <span className="min-w-0"><span className="block">{a.title}</span><span className="block text-sm text-faint truncate">{a.detail}</span></span>
                        </Link></li>
                      ))}</ul>
                    </div>
                  )}
                </>
              )}
            </section>

            <section aria-labelledby="ren-h">
              <div className="flex items-baseline justify-between"><h2 id="ren-h" className="text-lg font-semibold">Upcoming renewals</h2><Link to="/app/renewals" className="btn-quiet">Manage renewals</Link></div>
              {data.upcoming.length === 0 ? <p className="mt-4 border-t border-line pt-4 text-muted">No approved documents expire in the next 60 days.</p> : (
                <ul className="mt-4 border-t border-line-strong">{data.upcoming.map((u: any) => (
                  <li key={u.versionId} className="border-b border-line">
                    <Link to={u.replacementVersionId ? `/app/reviews/${u.replacementVersionId}` : `/app/documents/${u.documentId}`} className="flex items-start justify-between gap-4 py-3.5 hover:bg-raised/50 -mx-3 px-3 rounded">
                      <span className="min-w-0"><span className="block truncate">{u.title}</span><span className="block text-sm text-muted truncate">{u.subcontractor}{u.projects.length ? ` · ${u.projects.join(', ')}` : ''}</span><span className="block text-xs text-faint mt-0.5">{STAGE[u.stage] ?? humanize(u.stage)}</span></span>
                      <span className="text-right shrink-0"><span className={cx('block tnum', u.days < 0 || u.days <= 14 ? 'font-medium' : '')}>{u.days < 0 ? `Expired` : u.days === 0 ? 'Today' : `${u.days} days`}</span><span className="block text-xs text-faint">{formatDate(u.expiryDate)}</span></span>
                    </Link>
                  </li>
                ))}</ul>
              )}
            </section>

            <section aria-labelledby="proj-h" className="xl:col-span-1">
              <div className="flex items-baseline justify-between"><h2 id="proj-h" className="text-lg font-semibold">Project readiness</h2><Link to="/app/projects" className="btn-quiet">All projects</Link></div>
              {data.projects.length === 0 ? <p className="mt-4 border-t border-line pt-4 text-muted">No active projects.</p> : (
                <ul className="mt-4 border-t border-line-strong">{data.projects.map((p: any) => (
                  <li key={p.id} className="border-b border-line">
                    <Link to={`/app/projects/${p.id}`} className="block py-4 hover:bg-raised/50 -mx-3 px-3 rounded">
                      <div className="flex items-baseline justify-between gap-4">
                        <span className="min-w-0"><span className="font-medium">{p.name}</span><span className="text-sm text-faint ml-2">{[p.location, p.code].filter(Boolean).join(' · ')}</span></span>
                        <span className="tnum text-sm shrink-0">{p.readyPct === null ? <span className="text-faint">No one assigned</span> : <><span className="font-medium">{p.ready}</span><span className="text-muted"> of {p.assigned} ready</span></>}</span>
                      </div>
                      <ReadinessBar className="mt-3" ready={p.ready} action={p.action} notReady={p.notReady} total={p.assigned} />
                      {(p.notReady > 0 || p.action > 0) && <div className="mt-2 text-xs text-muted">{[p.notReady && `${p.notReady} not ready`, p.action && `${p.action} need attention`].filter(Boolean).join(' · ')}</div>}
                    </Link>
                  </li>
                ))}</ul>
              )}
            </section>

            <section aria-labelledby="act-h">
              <h2 id="act-h" className="text-lg font-semibold">Recent activity</h2>
              {data.recent.length === 0 ? <p className="mt-4 border-t border-line pt-4 text-muted">No activity yet.</p> : (
                <ol className="mt-4 border-t border-line-strong">{data.recent.map((e: any) => (
                  <li key={e.id} className="py-3 border-b border-line"><div className="leading-snug">{describe(e)}</div><div className="text-xs text-faint mt-1">{formatDateTime(e.at)}</div></li>
                ))}</ol>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Onboarding({ data, onSample, sampleBusy, market }: { data: any; onSample?: () => void; sampleBusy: boolean; market?: any }) {
  const steps = [
    { done: data.hasRequirements, title: 'Check your requirement library', body: `Starter requirements and trade templates for ${market === 'UK' ? 'UK' : market === 'US' ? 'US' : 'your'} projects are ready to edit.`, to: '/app/requirements', cta: 'Review requirements' },
    { done: data.hasProjects, title: 'Create a project', body: 'Pick a template so the project knows what each subcontractor must provide.', to: '/app/projects?new=1', cta: 'Create project' },
    { done: data.hasSubs, title: 'Add subcontractors', body: 'Add them one at a time or import a CSV from your current spreadsheet.', to: '/app/subcontractors?new=1', cta: 'Add subcontractors' },
    { done: data.hasAssignments, title: 'Assign and request documents', body: 'Assign subcontractors to the project, then send each contact a secure upload link.', to: '/app/projects', cta: 'Open projects' },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-14">
      <ol className="border-t border-line-strong">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-5 py-6 border-b border-line">
            <span className={cx('w-7 h-7 rounded-full grid place-items-center text-sm shrink-0 tnum', s.done ? 'bg-accent text-canvas' : i === next ? 'border-2 border-ink font-medium' : 'border border-line-strong text-faint')}>{s.done ? Icon.check('w-3.5 h-3.5') : i + 1}</span>
            <div className="flex-1">
              <div className={cx('font-medium', s.done && 'text-muted')}>{s.title}</div>
              <p className="text-muted mt-1">{s.body}</p>
              {!s.done && i === next && <Link to={s.to} className="btn-primary mt-4">{s.cta}</Link>}
            </div>
          </li>
        ))}
      </ol>
      {onSample && (
        <aside className="lg:pt-6">
          <h2 className="font-semibold">Want to look around first?</h2>
          <p className="text-muted mt-2 leading-relaxed">Load a sample set of three {market === 'US' ? 'Texas and Chicago' : 'London, Manchester and Birmingham'} projects with five subcontractors in different states of readiness. Every sample record is labelled and can be removed in one step from Settings.</p>
          <button className="btn-secondary mt-5" disabled={sampleBusy} onClick={onSample}>{sampleBusy && <Spinner />}Load sample data</button>
        </aside>
      )}
    </div>
  );
}
