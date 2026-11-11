import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { useApi } from '../../lib/api';
import { useSession } from '../../lib/session';
import { cx, Empty, ErrorState, humanize, Icon, PageHeader, PageLoading, Section, Stat } from '../../ui';

export default function Overview() {
  const { me } = useSession();
  const [f, setF] = useState<{ projectId?: string; subcontractorId?: string; status?: string; days: number }>({ days: 60 });
  const { data, error, loading, reload } = useApi<any>('dashboard', f);
  const projects = useApi<any>('projects.list');
  const subs = useApi<any>('subs.list');
  const nav = useNavigate();
  if (loading && !data) return <PageLoading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const m = data.metrics;
  const setup = !data.hasProjects || !data.hasSubs;
  return (
    <div>
      <PageHeader title={`Overview`} description={`${me?.org?.name} · ${formatDate(data.today)}`} actions={
        <div className="flex flex-wrap gap-2">
          <select className="input h-9 w-auto text-sm" value={f.projectId ?? ''} onChange={(e) => setF({ ...f, projectId: e.target.value || undefined })} aria-label="Filter by project">
            <option value="">All projects</option>{projects.data?.items.filter((p: any) => p.status !== 'archived').map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="input h-9 w-auto text-sm" value={f.subcontractorId ?? ''} onChange={(e) => setF({ ...f, subcontractorId: e.target.value || undefined })} aria-label="Filter by subcontractor">
            <option value="">All subcontractors</option>{subs.data?.items.map((s: any) => <option key={s.id} value={s.id}>{s.legalName}</option>)}
          </select>
          <select className="input h-9 w-auto text-sm" value={f.status ?? ''} onChange={(e) => setF({ ...f, status: e.target.value || undefined })} aria-label="Filter by status">
            <option value="">Any readiness</option><option value="ready">Ready</option><option value="action_required">Action required</option><option value="not_ready">Not ready</option>
          </select>
          <select className="input h-9 w-auto text-sm" value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })} aria-label="Expiry horizon">
            {[30, 60, 90, 180].map((d) => <option key={d} value={d}>Expiring within {d} days</option>)}
          </select>
        </div>
      } />

      {setup && <SetupGuide data={data} />}

      <div className="panel grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 divide-x divide-y xl:divide-y-0 divide-line overflow-hidden mb-6">
        <Stat label="Subcontractors" value={m.totalSubcontractors} onClick={() => nav('/app/subcontractors')} />
        <Stat label="Ready to work" value={m.ready} tone="ok" onClick={() => nav('/app/subcontractors?readiness=ready')} />
        <Stat label="Need attention" value={m.attention} tone="warn" onClick={() => nav('/app/subcontractors?readiness=action_required')} />
        <Stat label="Not ready" value={m.notReady} tone="bad" onClick={() => nav('/app/subcontractors?readiness=not_ready')} />
        <Stat label="Outstanding items" value={m.outstandingRequirements} hint={`${m.subsWithOutstanding} subcontractors`} onClick={() => nav('/app/compliance')} />
        <Stat label="Awaiting review" value={m.pendingReviews} tone="info" onClick={() => nav('/app/reviews')} />
        <Stat label="Expiring soon" value={m.expiringSoon} tone="warn" hint={`within ${me?.org?.settings.expiringSoonDays} days`} onClick={() => nav('/app/renewals')} />
        <Stat label="Expired documents" value={m.expiredDocuments} tone="bad" hint={`${m.expired} subcontractors`} onClick={() => nav('/app/renewals')} />
      </div>

      <div className="grid xl:grid-cols-[1.35fr_1fr] gap-6">
        <div className="space-y-6 min-w-0">
          <Section title="Needs attention today" description={`${data.actionsTotal} outstanding action${data.actionsTotal === 1 ? '' : 's'}, most urgent first`}>
            {data.actions.length === 0 ? <Empty title="Nothing outstanding">Every assigned subcontractor is ready, or nothing has been requested yet.</Empty> : (
              <ul className="divide-y divide-line">
                {data.actions.map((a: any, i: number) => (
                  <li key={i}><Link to={a.link} className="flex items-center gap-3 px-4 py-3 hover:bg-raised/60">
                    <span className={cx('w-1.5 h-1.5 rounded-full shrink-0', a.priority === 0 ? 'bg-bad' : a.priority === 1 ? 'bg-info' : a.priority === 2 ? 'bg-bad/70' : 'bg-warn')} />
                    <span className="flex-1 min-w-0"><span className="block truncate">{a.title}</span><span className="block text-xs text-muted truncate">{a.detail}</span></span>
                    <span className="text-faint">{Icon.chevron()}</span>
                  </Link></li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Project readiness" actions={<Link to="/app/projects" className="btn-ghost btn-sm">All projects</Link>}>
            {data.projects.length === 0 ? <Empty title="No active projects" action={<Link to="/app/projects?new=1" className="btn-primary btn-sm">Create project</Link>} /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead><tr><th className="th">Project</th><th className="th text-right">Assigned</th><th className="th text-right">Ready</th><th className="th text-right">Attention</th><th className="th text-right">Not ready</th><th className="th text-right">Blocking issues</th></tr></thead>
                  <tbody>{data.projects.map((p: any) => (
                    <tr key={p.id} className="tr-link" onClick={() => nav(`/app/projects/${p.id}`)}>
                      <td className="td"><div className="font-medium">{p.name}</div><div className="text-xs text-faint">{p.code || humanize(p.status)}</div></td>
                      <td className="td text-right tabular-nums">{p.assigned}</td>
                      <td className="td text-right tabular-nums text-ok">{p.ready}</td>
                      <td className="td text-right tabular-nums text-warn">{p.action}</td>
                      <td className="td text-right tabular-nums text-bad">{p.notReady}</td>
                      <td className="td text-right tabular-nums">{p.issues}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-6 min-w-0">
          <Section title="Upcoming expirations" description={`Approved documents expiring within ${f.days} days`} actions={<Link to="/app/renewals" className="btn-ghost btn-sm">Renewals</Link>}>
            {data.upcoming.length === 0 ? <Empty title="Nothing expiring">No approved documents expire in this window.</Empty> : (
              <ul className="divide-y divide-line">{data.upcoming.map((u: any) => (
                <li key={u.versionId}><Link to={`/app/documents/${u.documentId}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-raised/60">
                  <span className="min-w-0"><span className="block truncate text-sm">{u.title}</span><span className="block text-xs text-muted truncate">{u.subcontractor}</span></span>
                  <span className="text-right shrink-0"><span className={cx('block text-sm tabular-nums', u.days <= 14 ? 'text-bad' : u.days <= 30 ? 'text-warn' : 'text-muted')}>{u.days === 0 ? 'Today' : `${u.days} days`}</span><span className="block text-xs text-faint">{formatDate(u.expiryDate)}</span></span>
                </Link></li>
              ))}</ul>
            )}
          </Section>
          <Section title="Recent activity">
            {data.recent.length === 0 ? <Empty title="No activity yet" /> : (
              <ul className="divide-y divide-line">{data.recent.map((e: any) => (
                <li key={e.id} className="px-4 py-2.5 text-sm"><div className="truncate"><span className="text-muted">{e.actor.name}</span> · {humanize(e.action.split('.').slice(1).join(' '))} <span className="text-muted">{e.entity.label}</span></div><div className="text-xs text-faint">{formatDateTime(e.at)}</div></li>
              ))}</ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function SetupGuide({ data }: { data: any }) {
  const steps = [
    { done: data.hasRequirements, label: 'Review your requirement library and templates', to: '/app/requirements' },
    { done: data.hasProjects, label: 'Create your first project and apply a template', to: '/app/projects?new=1' },
    { done: data.hasSubs, label: 'Add subcontractors (one by one or CSV import)', to: '/app/subcontractors?new=1' },
    { done: false, label: 'Assign subcontractors to the project and send a document request', to: '/app/projects' },
  ];
  return (
    <div className="panel p-5 mb-6">
      <h2 className="font-semibold">Get set up</h2>
      <p className="text-sm text-muted mt-1">Four steps to your first readiness answer.</p>
      <ol className="mt-4 grid md:grid-cols-4 gap-3">
        {steps.map((s, i) => (
          <li key={i}><Link to={s.to} className={cx('block rounded border px-3 py-3 h-full hover:border-line-strong', s.done ? 'border-ok/30 bg-ok/5' : 'border-line')}>
            <div className={cx('text-xs font-mono', s.done ? 'text-ok' : 'text-accent')}>{s.done ? '✓ Done' : `Step ${i + 1}`}</div>
            <div className="text-sm mt-1">{s.label}</div>
          </Link></li>
        ))}
      </ol>
    </div>
  );
}
