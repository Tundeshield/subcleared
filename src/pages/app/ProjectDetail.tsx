import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { api, useApi, useMutation } from '../../lib/api';
import { exportCsv, exportPdf } from '../../lib/export';
import { useSession } from '../../lib/session';
import {
  Callout, Checkbox, Confirm, cx, Dialog, DocStatus, Empty, ErrorState, FormError, Glyph, HelpTip, humanize, Icon, KeyValue, Menu, MoreButton,
  PageHeader, PageLoading, ReadinessBadge, ReadinessBar, SampleTag, SearchInput, Spinner, StatusText, Tabs, Toolbar, useToast,
} from '../../ui';
import { ProjectDrawer } from './Projects';
import { activityLine, RequestDialog } from './shared';

type Tab = 'readiness' | 'requirements' | 'documents' | 'activity' | 'details';
type Focus = 'all' | 'not_ready' | 'review' | 'expiring';

const MISSING = ['missing', 'not_requested'];
const REQUESTED = ['requested', 'overdue'];
const REVIEW = ['awaiting_review', 'submitted', 'review_required'];

/** Concise issue summary for one subcontractor on one project. */
export function issueSummary(results: any[]) {
  const n = (f: (r: any) => boolean) => results.filter(f).length;
  const parts: [number, string][] = [
    [n((r) => r.mandatory && MISSING.includes(r.status)), 'missing'],
    [n((r) => r.mandatory && REQUESTED.includes(r.status)), 'requested, not received'],
    [n((r) => r.status === 'expired'), 'expired'],
    [n((r) => r.status === 'rejected'), 'rejected'],
    [n((r) => REVIEW.includes(r.status)), 'awaiting review'],
    [n((r) => r.status === 'expiring_soon'), 'expiring soon'],
  ];
  return parts.filter(([c]) => c > 0).map(([c, l]) => `${c} ${l}`);
}

export default function ProjectDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = raw === 'requirements' || raw === 'documents' || raw === 'activity' || raw === 'details' ? raw : 'readiness';
  const focus = (params.get('show') as Focus) || 'all';
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<any>('projects.get', { projectId: id });
  const [edit, setEdit] = useState(false);
  const [assign, setAssign] = useState(false);
  const [archive, setArchive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();
  const archiveM = useMutation('projects.archive');
  if (loading && !data) return <PageLoading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const p = data.project;
  const c = data.counts;
  const archived = p.status === 'archived';
  const setTab = (t: Tab) => setParams({ tab: t });
  const setFocus = (f: Focus) => setParams(f === 'all' ? {} : { show: f });
  const reviewSubs = data.subcontractors.filter((s: any) => s.results.some((r: any) => REVIEW.includes(r.status))).length;
  const expiringSubs = data.subcontractors.filter((s: any) => s.results.some((r: any) => r.status === 'expiring_soon')).length;
  const notReadySubs = c.notReady + c.action;
  const report = async () => {
    setExporting(true);
    try {
      const r = await api('reports.run', { type: 'project_readiness', filters: { projectId: p.id } });
      await exportPdf({
        ...r, title: 'Project readiness report', subtitle: p.name,
        context: [['Reference', p.code || '—'], ['Location', p.location || '—'], ['Project manager', p.managerName || '—'], ['Status', humanize(p.status)]],
        summary: [['Assigned', c.total], ['Ready', c.ready], ['Action required', c.action], ['Not ready', c.notReady], ['Awaiting review', c.awaitingReview]],
      });
    } catch (e: any) { toast(e.message, 'bad'); } finally { setExporting(false); }
  };
  const chip = (f: Focus, label: string, n: number) => (
    <button type="button" onClick={() => setParams(f === 'all' || (focus === f && tab === 'readiness') ? {} : { show: f })} aria-pressed={focus === f}
      className={cx('inline-flex items-baseline gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors', focus === f ? 'bg-accent-tint text-accent font-medium' : 'text-muted hover:bg-raised hover:text-ink', n === 0 && focus !== f && 'opacity-60')}>
      <span className="tnum font-medium text-ink">{n}</span>{label}
    </button>
  );
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Projects', to: '/app/projects' }, { label: p.name }]}
        title={<>{p.name} {p.sample && <SampleTag />}</>}
        meta={<>{p.code && <span>{p.code}</span>}{p.location && <span>{p.location}</span>}<span>{p.managerName ? `Managed by ${p.managerName}` : 'No project manager'}</span><span>{humanize(p.status)}</span>{p.startDate && <span>{formatDate(p.startDate)} – {formatDate(p.endDate)}</span>}</>}
        actions={<>
          <button className="btn-secondary" onClick={report} disabled={exporting}>{exporting && <Spinner />}Export readiness report</button>
          {!archived && can('projects.edit') && <button className="btn-primary" onClick={() => setAssign(true)}>{Icon.plus()}Assign subcontractors</button>}
          <Menu trigger={(t) => <MoreButton label="More project actions" {...t} />} items={[
            !archived && can('projects.edit') && { label: 'Edit project details', onClick: () => setEdit(true) },
            can('requirements.manage') && { label: 'Manage requirements', onClick: () => setTab('requirements') },
            can('projects.archive') && { label: archived ? 'Restore project' : 'Archive project', onClick: () => setArchive(true), danger: !archived },
          ]} />
        </>} />
      {archived && <div className="mb-8"><Callout title="Archived">Readiness is frozen as it was when the project was archived, and reminders stop for documents only this project needs.</Callout></div>}
      {c.total > 0 && (
        <section aria-label="Project readiness" className="mb-8 rounded-md border border-line bg-paper px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="min-w-[14rem]">
            <div className="flex items-baseline gap-2"><span className={cx('text-2xl tnum font-medium', c.ready === c.total ? 'text-success' : 'text-ink')}>{c.ready} of {c.total}</span><span className="text-muted">ready to work</span><HelpTip>A subcontractor is ready when every mandatory requirement on this project is approved and in date. The same company can be ready on one project and not another.</HelpTip></div>
            <ReadinessBar className="mt-2 w-full max-w-xs" ready={c.ready} action={c.action} notReady={c.notReady} total={c.total} />
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Show subcontractors">
            {chip('all', 'all', c.total)}{chip('not_ready', 'not ready', notReadySubs)}{chip('review', 'with documents to review', reviewSubs)}{chip('expiring', 'with documents expiring', expiringSubs)}
          </div>
        </section>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'readiness', label: 'Readiness', count: c.total }, { value: 'requirements', label: 'Requirements', count: data.requirements.length },
        { value: 'documents', label: 'Documents' }, { value: 'activity', label: 'Activity' }, { value: 'details', label: 'Details' },
      ]} />
      <div className="mt-6">
        {tab === 'readiness' && <ReadinessTab data={data} focus={focus} setFocus={setFocus} onAssign={() => setAssign(true)} goTo={setTab} />}
        {tab === 'requirements' && <RequirementsTab data={data} />}
        {tab === 'documents' && <DocumentsTab projectId={p.id} />}
        {tab === 'activity' && <ActivityTab projectId={p.id} />}
        {tab === 'details' && (
          <div className="max-w-3xl"><KeyValue items={[
            ['Project name', p.name], ['Reference', p.code], ['Status', humanize(p.status)], ['Location', p.location], ['Address', p.address], ['Start date', formatDate(p.startDate)], ['Expected completion', formatDate(p.endDate)],
            ['Project manager', p.managerName], ['Project administrators', p.adminNames?.join(', ')], ['Description', p.description],
            ['Templates applied', p.templateRefs.map((t: any) => `${data.templates.find((x: any) => x.id === t.templateId)?.name ?? 'Template'} (v${t.version}, ${formatDate(t.appliedAt)})`).join('; ')],
            ['Created', formatDateTime(p.createdAt)],
          ]} />{!archived && can('projects.edit') && <button className="btn-secondary mt-6" onClick={() => setEdit(true)}>Edit details</button>}</div>
        )}
      </div>
      <ProjectDrawer open={edit} onClose={() => setEdit(false)} project={p} />
      <AssignDialog open={assign} onClose={() => setAssign(false)} projectId={p.id} available={data.available} />
      <Confirm open={archive} onClose={() => setArchive(false)} title={archived ? 'Restore this project?' : 'Archive this project?'} confirmLabel={archived ? 'Restore' : 'Archive'} danger={!archived} busy={archiveM.busy}
        onConfirm={async () => { await archiveM.run({ projectId: p.id, archived: !archived }); setArchive(false); toast(archived ? 'Project restored' : 'Project archived'); }}>
        {archived ? 'Readiness is recalculated and reminders resume.' : 'Readiness records are kept exactly as they are now and reminders stop for documents only this project needs. You can restore it later.'}
      </Confirm>
    </div>
  );
}

const ORDER: Record<string, number> = { not_ready: 0, action_required: 1, not_evaluated: 2, ready: 3 };

function ReadinessTab({ data, focus, setFocus, onAssign, goTo }: { data: any; focus: Focus; setFocus: (f: Focus) => void; onAssign: () => void; goTo: (t: Tab) => void }) {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [request, setRequest] = useState<{ sub: string; reqs?: string[] } | null>(null);
  const [remove, setRemove] = useState<any>(null);
  const unassign = useMutation('projects.unassign');
  const toast = useToast();
  const nav = useNavigate();
  const editable = can('projects.edit') && data.project.status !== 'archived';
  const rows = useMemo(() => data.subcontractors
    .filter((s: any) => focus === 'all' || (focus === 'not_ready' && s.readiness !== 'ready') || (focus === 'review' && s.results.some((r: any) => REVIEW.includes(r.status))) || (focus === 'expiring' && s.results.some((r: any) => r.status === 'expiring_soon')))
    .filter((s: any) => `${s.legalName} ${s.trade} ${s.contact?.name ?? ''} ${s.contact?.email ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a: any, b: any) => (ORDER[a.readiness] ?? 9) - (ORDER[b.readiness] ?? 9) || a.legalName.localeCompare(b.legalName)), [data, q, focus]);
  if (data.requirements.length === 0) return <Empty title="This project has no requirements yet" action={can('requirements.manage') && <button className="btn-primary" onClick={() => goTo('requirements')}>Add requirements</button>}>Readiness can't be worked out until the project says what each subcontractor must provide. Start from a template — you can adjust it afterwards.</Empty>;
  if (data.subcontractors.length === 0) return <Empty title="No subcontractors on this project yet" action={editable && <button className="btn-primary" onClick={onAssign}>Assign subcontractors</button>}>Assign the companies working on this project. SubCleared then shows who is ready and exactly what is holding the others back.</Empty>;
  const flat = rows.map((s: any) => ({ ...s, contactText: s.contact ? `${s.contact.name} <${s.contact.email}>` : '', issues: issueSummary(s.results).join('; '), readinessText: humanize(s.readiness), last: formatDate(s.lastActivityAt) }));
  const needs = rows.filter((s: any) => s.readiness !== 'ready');
  const ready = rows.filter((s: any) => s.readiness === 'ready');
  const row = (s: any) => {
    const issues = issueSummary(s.results);
    const toReview = s.results.find((r: any) => REVIEW.includes(r.status) && r.versionId);
    const outstanding = s.results.filter((r: any) => r.mandatory && [...MISSING, ...REQUESTED, 'expired', 'rejected'].includes(r.status) || r.status === 'expiring_soon');
    const isOpen = !!open[s.id];
    const next = toReview && can('documents.review') ? <Link to={`/app/reviews/${toReview.versionId}`} className="btn-primary btn-sm">Review document</Link>
      : outstanding.length && can('requests.send') ? <button className="btn-secondary btn-sm" onClick={() => setRequest({ sub: s.id, reqs: outstanding.map((r: any) => r.requirementId) })}>Request documents</button>
      : null;
    return (
      <li key={s.id} className="border-b border-line">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_9rem_13rem] items-center gap-x-4 gap-y-2 py-4">
          <button type="button" className="p-1.5 -m-1 rounded text-faint hover:text-ink hover:bg-raised" aria-expanded={isOpen} aria-controls={`req-${s.id}`} aria-label={`${isOpen ? 'Hide' : 'Show'} requirements for ${s.legalName}`} onClick={() => setOpen({ ...open, [s.id]: !isOpen })}>
            <span className={cx('inline-block transition-transform', isOpen && 'rotate-90')}>{Icon.chevron()}</span>
          </button>
          <div className="min-w-0">
            <Link to={`/app/subcontractors/${s.id}?project=${data.project.id}`} className="font-medium hover:underline underline-offset-4">{s.legalName}</Link>{s.sample && <> <SampleTag /></>}
            <div className="text-sm text-faint truncate">{[s.trade, s.contact?.name, s.status === 'suspended' && 'Suspended'].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="col-start-2 md:col-start-auto text-sm min-w-0">{issues.length ? <span className="text-ink">{issues.join(' · ')}</span> : <span className="text-faint">All requirements met</span>}</div>
          <div className="col-start-2 md:col-start-auto"><ReadinessBadge value={s.readiness} size="sm" /></div>
          {next && <div className="col-start-2 sm:hidden">{next}</div>}
          <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto flex items-center justify-end gap-2">
            <span className="hidden sm:inline-flex">{next}</span>
            <Menu trigger={(t) => <MoreButton label={`Actions for ${s.legalName}`} {...t} />} items={[
              can('requests.send') && { label: 'Request documents', onClick: () => setRequest({ sub: s.id }) },
              { label: 'Open subcontractor profile', onClick: () => nav(`/app/subcontractors/${s.id}?project=${data.project.id}`) },
              editable && { label: 'Remove from project', onClick: () => setRemove(s), danger: true },
            ]} />
          </div>
        </div>
        {isOpen && (
          <div id={`req-${s.id}`} className="pb-5 md:pl-10">
            <ul className="rounded-md border border-line bg-paper divide-y divide-line">
              {[...s.results].sort((a: any, b: any) => Number(b.blocking) - Number(a.blocking)).map((r: any) => {
                const act = REVIEW.includes(r.status) && r.versionId && can('documents.review') ? <Link className="btn-quiet" to={`/app/reviews/${r.versionId}`}>Review</Link>
                  : [...MISSING, ...REQUESTED, 'expired', 'rejected', 'expiring_soon'].includes(r.status) && can('requests.send') ? <button className="btn-quiet" onClick={() => setRequest({ sub: s.id, reqs: [r.requirementId] })}>{r.status === 'expiring_soon' || r.status === 'expired' ? 'Request renewal' : r.status === 'rejected' ? 'Request replacement' : REQUESTED.includes(r.status) ? 'Send again' : 'Request'}</button>
                  : r.documentId ? <Link className="btn-quiet" to={`/app/documents/${r.documentId}`}>View document</Link> : null;
                return (
                  <li key={r.requirementId} className="grid sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] gap-x-6 gap-y-1 px-4 py-3 text-sm">
                    <div className="min-w-0"><div className="font-medium text-ink">{r.requirementName}{!r.mandatory && <span className="text-faint font-normal"> · optional</span>}</div><StatusText value={r.status} /></div>
                    <div className="text-muted min-w-0">{/^Nothing submitted and no request sent yet\.?$/.test(r.reason) ? <span className="text-faint">Not requested yet</span> : r.reason}</div>
                    <div className="sm:text-right">{act}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </li>
    );
  };
  return (
    <>
      <Toolbar right={<button className="btn-secondary btn-sm" disabled={!rows.length} onClick={() => exportCsv(`${data.project.name} readiness`, [{ key: 'legalName', label: 'Subcontractor' }, { key: 'trade', label: 'Trade' }, { key: 'contactText', label: 'Contact' }, { key: 'readinessText', label: 'Readiness' }, { key: 'issues', label: 'Issues' }, { key: 'summary', label: 'Reason' }, { key: 'last', label: 'Last activity' }], flat)}>Export CSV</button>}>
        <SearchInput value={q} onChange={setQ} placeholder="Search company, trade or contact" className="w-full sm:w-80" />
        {focus !== 'all' && <button className="btn-ghost btn-sm" onClick={() => setFocus('all')}>{Icon.x()}Clear filter</button>}
      </Toolbar>
      {rows.length === 0 ? <Empty title="No subcontractors match">Try a different search or clear the filter.</Empty> : (
        <div className="space-y-10">
          {needs.length > 0 && <section><h2 className="text-md font-semibold flex items-center gap-2">Needs action <span className="text-muted font-normal tnum">{needs.length}</span></h2><ul className="mt-2 border-t border-line-strong">{needs.map(row)}</ul></section>}
          {ready.length > 0 && <section><h2 className="text-md font-semibold flex items-center gap-2">Ready to work <span className="text-muted font-normal tnum">{ready.length}</span></h2><ul className="mt-2 border-t border-line-strong">{ready.map(row)}</ul></section>}
          {needs.length === 0 && focus === 'all' && <p className="flex gap-2 items-center text-success"><Glyph tone="ok" />Everyone assigned to this project is ready to work.</p>}
        </div>
      )}
      {request && <RequestDialog open onClose={() => setRequest(null)} subcontractorId={request.sub} projectId={data.project.id} requirementIds={request.reqs} />}
      <Confirm open={!!remove} onClose={() => setRemove(null)} title={`Remove ${remove?.legalName} from this project?`} confirmLabel="Remove" danger busy={unassign.busy}
        onConfirm={async () => { await unassign.run({ projectId: data.project.id, subcontractorId: remove.id }); setRemove(null); toast('Removed from project'); }}>
        Their documents and history are kept. Readiness for this project stops being tracked.
      </Confirm>
    </>
  );
}

function RequirementsTab({ data }: { data: any }) {
  const { can } = useSession();
  const editable = can('requirements.manage') && data.project.status !== 'archived';
  const setReq = useMutation('projects.setRequirement');
  const apply = useMutation('projects.applyTemplate');
  const [tpl, setTpl] = useState('');
  const [add, setAdd] = useState('');
  const toast = useToast();
  const used = new Set(data.requirements.map((r: any) => r.requirementId));
  const outdated = data.templates.filter((t: any) => t.outdated);
  const source = (r: any) => r.source.type === 'template' ? `Template · ${data.templates.find((t: any) => t.id === r.source.templateId)?.name ?? 'removed template'} v${r.source.version}` : 'Project-specific';
  return (
    <div className="grid lg:grid-cols-[1fr_20rem] gap-x-14 gap-y-10">
      <section>
        <h2 className="text-lg font-semibold">What subcontractors must provide for this project</h2>
        <p className="text-sm text-muted mt-1">Mandatory requirements must be approved and in date for a subcontractor to be ready. Optional ones never block readiness.</p>
        {data.requirements.length === 0 ? <Empty title="No requirements yet">Apply a template or add individual requirements.</Empty> : (
          <ul className="mt-5 border-t border-line-strong">{data.requirements.map((r: any) => (
            <li key={r.id} className="py-4 border-b border-line grid sm:grid-cols-[1fr_auto] gap-3 items-start">
              <div>
                <div className="font-medium">{r.definition?.name}</div>
                <div className="text-sm text-muted mt-0.5">{[r.definition?.category, r.definition?.kind === 'document' ? r.definition?.documentType : humanize(r.definition?.kind ?? ''), r.definition?.expiryRequired ? 'Expires' : 'No expiry', r.definition?.criteria?.length ? `${r.definition.criteria.length} check${r.definition.criteria.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</div>
                <div className={cx('text-xs mt-1', r.source.type === 'template' ? 'text-faint' : 'text-accent')}>{source(r)}</div>
              </div>
              <div className="flex items-center gap-4">
                <Checkbox checked={r.mandatory} disabled={!editable || setReq.busy} onChange={(v) => setReq.run({ projectId: data.project.id, requirementId: r.requirementId, mandatory: v }).then(() => toast(v ? 'Now mandatory' : 'Now optional'))} label="Mandatory" />
                {editable && <button className="btn-ghost btn-sm" onClick={() => setReq.run({ projectId: data.project.id, requirementId: r.requirementId, remove: true }).then(() => toast('Removed from project'))}>Remove</button>}
              </div>
            </li>
          ))}</ul>
        )}
        <div className="mt-4"><FormError error={setReq.error} /></div>
      </section>
      {editable && (
        <aside className="space-y-10">
          {outdated.length > 0 && <Callout tone="warn" title="A template has changed">{outdated.map((t: any) => `${t.name} is now version ${t.version}; this project uses version ${t.appliedVersion}`).join('. ')}. Re-apply it to pick up the changes. Earlier decisions stay in the history.</Callout>}
          <section>
            <h3 className="font-semibold">Apply a template</h3>
            <p className="text-sm text-muted mt-1">Adds the template's requirements. Anything you've adjusted on this project is left alone.</p>
            <select className="input mt-3" value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label="Template"><option value="">Choose a template…</option>{data.templates.map((t: any) => <option key={t.id} value={t.id}>{t.name}{t.appliedVersion ? ` (applied v${t.appliedVersion})` : ''}</option>)}</select>
            <button className="btn-primary w-full mt-3" disabled={!tpl || apply.busy} onClick={async () => { const r = await apply.run({ projectId: data.project.id, templateId: tpl }); toast(`Template applied: ${r.added} added, ${r.updated} updated`); setTpl(''); }}>{apply.busy && <Spinner />}Apply template</button>
            <div className="mt-3"><FormError error={apply.error} /></div>
          </section>
          <section>
            <h3 className="font-semibold">Add a single requirement</h3>
            <select className="input mt-3" value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Requirement"><option value="">Choose a requirement…</option>{data.allRequirements.filter((r: any) => !used.has(r.id)).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            <button className="btn-secondary w-full mt-3" disabled={!add || setReq.busy} onClick={async () => { await setReq.run({ projectId: data.project.id, requirementId: add }); toast('Requirement added'); setAdd(''); }}>Add to project</button>
            <Link to="/app/requirements" className="btn-quiet mt-3">Create a custom requirement</Link>
          </section>
        </aside>
      )}
    </div>
  );
}

function DocumentsTab({ projectId }: { projectId: string }) {
  const { data, error, loading } = useApi<any>('documents.list', { projectId });
  const nav = useNavigate();
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!data.items.length) return <Empty title="No documents yet">Documents from subcontractors on this project appear here once submitted.</Empty>;
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="table min-w-[760px]">
        <thead><tr><th className="th">Document</th><th className="th">Subcontractor</th><th className="th">Expiry</th><th className="th">Status</th><th className="th">Version</th></tr></thead>
        <tbody>{data.items.map((d: any) => (
          <tr key={d.id} className="tr-link" onClick={() => nav(`/app/documents/${d.id}`)}>
            <td className="td"><div className="font-medium">{d.title}</div><div className="text-sm text-faint">{d.category}</div></td>
            <td className="td">{d.subcontractor}</td><td className="td whitespace-nowrap tnum">{d.expiryDate ? formatDate(d.expiryDate) : <span className="text-faint">No expiry</span>}</td>
            <td className="td"><DocStatus value={d.status} /></td><td className="td tnum text-muted">v{d.versionNumber ?? 1}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function ActivityTab({ projectId }: { projectId: string }) {
  const { data, error, loading } = useApi<any>('audit.list', { ref: projectId, limit: 200 });
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!data.items.length) return <Empty title="No activity yet" />;
  return (
    <ol className="max-w-3xl border-t border-line-strong">{data.items.map((e: any) => (
      <li key={e.id} className="py-3.5 border-b border-line"><div>{activityLine(e)}</div><div className="text-xs text-faint mt-1">{formatDateTime(e.at)} · {humanize(e.source)}</div></li>
    ))}</ol>
  );
}

function AssignDialog({ open, onClose, projectId, available }: { open: boolean; onClose: () => void; projectId: string; available: any[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const { run, busy, error } = useMutation('projects.assign');
  const toast = useToast();
  const list = available.filter((s) => `${s.legalName} ${s.trade}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog open={open} onClose={onClose} title="Assign subcontractors" description="Readiness is worked out straight away from this project's requirements and any documents already on file." footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!sel.length || busy} onClick={async () => { await run({ projectId, subcontractorIds: sel }); toast(`${sel.length} assigned`); setSel([]); onClose(); }}>{busy && <Spinner />}Assign {sel.length || ''}</button>
    </>}>
      {available.length === 0 ? <Empty title="Everyone in your directory is already assigned" action={<Link to="/app/subcontractors?new=1" className="btn-secondary btn-sm">Add a subcontractor</Link>} /> : (
        <>
          <SearchInput value={q} onChange={setQ} placeholder="Filter by name or trade" />
          <div className="mt-4 max-h-80 overflow-y-auto divide-y divide-line">{list.map((s) => <div key={s.id} className="py-2.5"><Checkbox checked={sel.includes(s.id)} onChange={(v) => setSel(v ? [...sel, s.id] : sel.filter((x) => x !== s.id))} label={s.legalName} hint={s.trade} /></div>)}</div>
          <div className="mt-3"><FormError error={error} /></div>
        </>
      )}
    </Dialog>
  );
}
