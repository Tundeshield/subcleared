import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { api, useApi, useMutation } from '../../lib/api';
import { exportCsv, exportPdf } from '../../lib/export';
import { useSession } from '../../lib/session';
import {
  Callout, Checkbox, Confirm, cx, Dialog, DocStatus, Empty, ErrorState, FilterSelect, FormError, Glyph, humanize, Icon, KeyValue, Menu, Metric, MoreButton,
  PageHeader, PageLoading, ReadinessBadge, ReadinessBar, SampleTag, SearchInput, Spinner, StatusText, Tabs, Toolbar, useToast,
} from '../../ui';
import { ProjectDrawer } from './Projects';
import { activityLine, RequestDialog } from './shared';

type Tab = 'overview' | 'subcontractors' | 'requirements' | 'documents' | 'activity' | 'details';

export default function ProjectDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
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
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Projects', to: '/app/projects' }, { label: p.name }]}
        title={<>{p.name} {p.sample && <SampleTag />}</>}
        meta={<>{p.code && <span>{p.code}</span>}{p.location && <span>{p.location}</span>}<span>{p.managerName ? `Managed by ${p.managerName}` : 'No project manager'}</span><span>{humanize(p.status)}</span>{p.startDate && <span>{formatDate(p.startDate)} – {formatDate(p.endDate)}</span>}</>}
        actions={<>
          <button className="btn-secondary" onClick={report} disabled={exporting}>{exporting && <Spinner />}Export readiness report</button>
          {!archived && can('projects.edit') && <button className="btn-primary" onClick={() => setAssign(true)}>Assign subcontractors</button>}
          <Menu trigger={(t) => <MoreButton label="More project actions" {...t} />} items={[
            !archived && can('projects.edit') && { label: 'Edit project details', onClick: () => setEdit(true) },
            can('requirements.manage') && { label: 'Manage requirements', onClick: () => setTab('requirements') },
            can('projects.archive') && { label: archived ? 'Restore project' : 'Archive project', onClick: () => setArchive(true), danger: !archived },
          ]} />
        </>} />
      {archived && <div className="mb-8"><Callout title="Archived">Readiness is frozen as it was when the project was archived, and reminders stop for documents only this project needs.</Callout></div>}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-y-6 pb-8 mb-8 border-b border-line">
        <Metric label="Assigned" value={c.total} />
        <Metric label="Ready" value={c.ready} emphasis="field" />
        <Metric label="Not ready" value={c.notReady} />
        <Metric label="Awaiting review" value={c.awaitingReview} />
        <Metric label="Expiring soon" value={c.expiring} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Overview' }, { value: 'subcontractors', label: 'Subcontractors', count: c.total }, { value: 'requirements', label: 'Requirements', count: data.requirements.length },
        { value: 'documents', label: 'Documents' }, { value: 'activity', label: 'Activity' }, { value: 'details', label: 'Details' },
      ]} />
      <div className="mt-8">
        {tab === 'overview' && <OverviewTab data={data} onAssign={() => setAssign(true)} goTo={setTab} />}
        {tab === 'subcontractors' && <SubsTab data={data} onAssign={() => setAssign(true)} />}
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

function OverviewTab({ data, onAssign, goTo }: { data: any; onAssign: () => void; goTo: (t: Tab) => void }) {
  const { can } = useSession();
  if (data.requirements.length === 0) return <Empty title="This project has no requirements yet" action={can('requirements.manage') && <button className="btn-primary" onClick={() => goTo('requirements')}>Add requirements</button>}>Readiness can't be worked out until the project says what each subcontractor must provide.</Empty>;
  if (data.subcontractors.length === 0) return <Empty title="No subcontractors assigned" action={can('projects.edit') && data.project.status !== 'archived' && <button className="btn-primary" onClick={onAssign}>Assign subcontractors</button>}>Assign subcontractors to see who is ready to work on this project and what is holding the others back.</Empty>;
  const blocked = data.subcontractors.filter((s: any) => s.readiness === 'not_ready');
  const attention = data.subcontractors.filter((s: any) => s.readiness === 'action_required');
  const ready = data.subcontractors.filter((s: any) => s.readiness === 'ready');
  const c = data.counts;
  return (
    <div className="grid lg:grid-cols-[1.4fr_1fr] gap-x-14 gap-y-10">
      <section>
        <h2 className="text-lg font-semibold">What's stopping subcontractors being ready</h2>
        <div className="mt-3 text-sm text-muted tnum">{c.ready} of {c.total} ready</div>
        <ReadinessBar className="mt-2 max-w-md" ready={c.ready} action={c.action} notReady={c.notReady} total={c.total} />
        {blocked.length + attention.length === 0 ? <p className="mt-6 flex gap-2 items-center text-field"><Glyph tone="ok" />Everyone assigned to this project is ready to work.</p> : (
          <ul className="mt-6 border-t border-charcoal/80">
            {[...blocked, ...attention].map((s: any) => (
              <li key={s.id} className="py-5 border-b border-line">
                <div className="flex flex-wrap items-baseline justify-between gap-3"><Link to={`/app/subcontractors/${s.id}?tab=requirements&project=${data.project.id}`} className="font-medium hover:underline underline-offset-4">{s.legalName}</Link><ReadinessBadge value={s.readiness} size="sm" /></div>
                <ul className="mt-2.5 space-y-1.5">{s.results.filter((r: any) => r.blocking || ['expiring_soon', 'awaiting_review', 'review_required'].includes(r.status)).map((r: any) => (
                  <li key={r.requirementId} className="grid sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] gap-x-6 gap-y-0.5 text-sm"><StatusText wrap value={r.status} label={r.requirementName} /><span className="text-muted pl-[21px] sm:pl-0">{r.reason}</span></li>
                ))}</ul>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-lg font-semibold">Ready to work</h2>
        {ready.length === 0 ? <p className="mt-4 text-muted">No one is ready yet.</p> : (
          <ul className="mt-4 border-t border-charcoal/80">{ready.map((s: any) => (
            <li key={s.id} className="py-3 border-b border-line flex justify-between gap-3"><Link to={`/app/subcontractors/${s.id}`} className="hover:underline underline-offset-4">{s.legalName}</Link><span className="text-sm text-faint">{s.trade}</span></li>
          ))}</ul>
        )}
        <button className="btn-quiet mt-5" onClick={() => goTo('subcontractors')}>See all subcontractors {Icon.arrow()}</button>
      </section>
    </div>
  );
}

function SubsTab({ data, onAssign }: { data: any; onAssign: () => void }) {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [request, setRequest] = useState<string | null>(null);
  const [remove, setRemove] = useState<any>(null);
  const unassign = useMutation('projects.unassign');
  const toast = useToast();
  const nav = useNavigate();
  const rows = useMemo(() => data.subcontractors.filter((s: any) => (!filter || s.readiness === filter) && `${s.legalName} ${s.trade} ${s.contact?.name ?? ''} ${s.contact?.email ?? ''}`.toLowerCase().includes(q.toLowerCase())), [data, q, filter]);
  const flat = rows.map((s: any) => ({ ...s, contactText: s.contact ? `${s.contact.name} <${s.contact.email}>` : '', satisfied: `${s.required - s.missing.length - s.expired.length} of ${s.required}`, outstanding: [...s.missing, ...s.expired.map((e: string) => `${e} (expired)`)].join('; '), readinessText: humanize(s.readiness), last: formatDate(s.lastActivityAt) }));
  if (data.subcontractors.length === 0) return <Empty title="No subcontractors assigned" action={can('projects.edit') && data.project.status !== 'archived' && <button className="btn-primary" onClick={onAssign}>Assign subcontractors</button>}>Assign subcontractors to see who is ready to work on this project.</Empty>;
  return (
    <>
      <Toolbar right={<button className="btn-secondary btn-sm" disabled={!rows.length} onClick={() => exportCsv(`${data.project.name} subcontractors`, [{ key: 'legalName', label: 'Subcontractor' }, { key: 'trade', label: 'Trade' }, { key: 'contactText', label: 'Contact' }, { key: 'satisfied', label: 'Requirements satisfied' }, { key: 'outstanding', label: 'Outstanding' }, { key: 'readinessText', label: 'Readiness' }, { key: 'summary', label: 'Reason' }, { key: 'last', label: 'Last activity' }], flat)}>Export CSV</button>}>
        <SearchInput value={q} onChange={setQ} placeholder="Search company, trade or contact" className="w-full sm:w-80" />
        <FilterSelect label="Readiness" value={filter} onChange={setFilter} options={[{ value: 'not_ready', label: 'Not ready' }, { value: 'action_required', label: 'Action required' }, { value: 'ready', label: 'Ready' }, { value: 'not_evaluated', label: 'Not evaluated' }]} />
      </Toolbar>
      {rows.length === 0 ? <Empty title="No subcontractors match" /> : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="table min-w-[960px]">
            <thead><tr><th className="th w-8"><span className="sr-only">Expand</span></th><th className="th">Subcontractor</th><th className="th">Contact</th><th className="th">Requirements satisfied</th><th className="th w-[26%]">Outstanding</th><th className="th">Readiness</th><th className="th">Last activity</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((s: any) => {
              const outstanding = [...s.missing, ...s.expired.map((e: string) => `${e} (expired)`)];
              const satisfied = Math.max(0, s.required - s.missing.length - s.expired.length);
              return (
                <Fragment key={s.id}>
                  <tr className="tr-link" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                    <td className="td text-faint"><button type="button" className="p-1 -m-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-field" aria-expanded={expanded === s.id} aria-label={`${expanded === s.id ? 'Hide' : 'Show'} details for ${s.legalName}`} onClick={(e) => { e.stopPropagation(); setExpanded(expanded === s.id ? null : s.id); }}><span className={cx('inline-block transition-transform', expanded === s.id && 'rotate-90')}>{Icon.chevron()}</span></button></td>
                    <td className="td"><Link to={`/app/subcontractors/${s.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline underline-offset-4">{s.legalName}</Link><div className="text-sm text-faint">{s.trade}{s.status === 'suspended' && ' · Suspended'}</div></td>
                    <td className="td">{s.contact ? <><div>{s.contact.name}</div><div className="text-sm text-faint truncate max-w-[15rem]" title={s.contact.email}>{s.contact.email}</div></> : <span className="text-faint">No contact</span>}</td>
                    <td className="td tnum">{satisfied} of {s.required}{s.pending > 0 && <div className="text-sm text-faint">{s.pending} awaiting review</div>}</td>
                    <td className="td text-sm">{outstanding.length ? outstanding.join(', ') : s.expiring.length ? <span className="text-muted">Expiring: {s.expiring.map((e: any) => `${e.name} (${formatDate(e.date)})`).join(', ')}</span> : <span className="text-faint">Nothing outstanding</span>}</td>
                    <td className="td"><ReadinessBadge value={s.readiness} size="sm" /></td>
                    <td className="td text-muted whitespace-nowrap">{formatDate(s.lastActivityAt)}</td>
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <Menu trigger={(t) => <MoreButton label={`Actions for ${s.legalName}`} {...t} />} items={[
                        can('requests.send') && { label: 'Request documents', onClick: () => setRequest(s.id) },
                        { label: 'Open subcontractor profile', onClick: () => nav(`/app/subcontractors/${s.id}`) },
                        can('projects.edit') && { label: 'Remove from project', onClick: () => setRemove(s), danger: true },
                      ]} />
                    </td>
                  </tr>
                  {expanded === s.id && (
                    <tr><td colSpan={8} className="bg-paper border-b border-line px-6 sm:px-12 py-5">
                      <p className="font-medium">{s.summary}</p>
                      <table className="w-full max-w-4xl mt-3"><tbody>{s.results.map((r: any) => (
                        <tr key={r.requirementId} className="border-t border-line"><td className="py-2.5 pr-4 w-[30%]">{r.requirementName}{!r.mandatory && <span className="text-faint text-sm"> · optional</span>}</td><td className="py-2.5 pr-4 w-[18%]"><StatusText value={r.status} /></td><td className="py-2.5 text-sm text-muted">{r.reason}</td></tr>
                      ))}</tbody></table>
                      {can('requests.send') && outstanding.length + s.expiring.length > 0 && <button className="btn-primary btn-sm mt-4" onClick={() => setRequest(s.id)}>Request outstanding documents</button>}
                    </td></tr>
                  )}
                </Fragment>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {request && <RequestDialog open onClose={() => setRequest(null)} subcontractorId={request} projectId={data.project.id} />}
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
          <ul className="mt-5 border-t border-charcoal/80">{data.requirements.map((r: any) => (
            <li key={r.id} className="py-4 border-b border-line grid sm:grid-cols-[1fr_auto] gap-3 items-start">
              <div>
                <div className="font-medium">{r.definition?.name}</div>
                <div className="text-sm text-muted mt-0.5">{[r.definition?.category, r.definition?.kind === 'document' ? r.definition?.documentType : humanize(r.definition?.kind ?? ''), r.definition?.expiryRequired ? 'Expires' : 'No expiry', r.definition?.criteria?.length ? `${r.definition.criteria.length} check${r.definition.criteria.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</div>
                <div className={cx('text-xs mt-1', r.source.type === 'template' ? 'text-faint' : 'text-field')}>{source(r)}</div>
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
    <ol className="max-w-3xl border-t border-charcoal/80">{data.items.map((e: any) => (
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
