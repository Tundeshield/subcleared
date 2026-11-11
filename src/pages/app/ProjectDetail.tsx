import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { STATUS_LABELS } from '../../domain/compliance';
import { formatDate, formatDateTime } from '../../domain/dates';
import { api, useApi, useMutation } from '../../lib/api';
import { exportCsv, exportPdf } from '../../lib/export';
import { useSession } from '../../lib/session';
import {
  Callout, Checkbox, Confirm, cx, Dialog, Empty, ErrorState, FormError, humanize, Icon, KeyValue, Menu, PageHeader, PageLoading, ReadinessBadge,
  SearchInput, Section, Spinner, Stat, StatusText, Tabs, useToast,
} from '../../ui';
import { ProjectDialog } from './Projects';
import { RequestDialog } from './shared';

export default function ProjectDetail() {
  const { id } = useParams();
  const { can, me } = useSession();
  const { data, error, loading, reload } = useApi<any>('projects.get', { projectId: id });
  const [tab, setTab] = useState<'compliance' | 'requirements' | 'details'>('compliance');
  const [edit, setEdit] = useState(false);
  const [assign, setAssign] = useState(false);
  const [archive, setArchive] = useState(false);
  const toast = useToast();
  const archiveM = useMutation('projects.archive');
  if (loading && !data) return <PageLoading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const p = data.project;
  const c = data.counts;
  const archived = p.status === 'archived';
  const report = async () => {
    const r = await api('reports.run', { type: 'project_readiness', filters: { projectId: p.id } });
    await exportPdf({ ...r, title: `${p.name} — readiness report`, organisation: r.organisation });
  };
  return (
    <div>
      <PageHeader eyebrow={<Link to="/app/projects" className="hover:text-ink">Projects</Link>} title={<span className="flex items-center gap-3">{p.name}{archived && <span className="text-xs font-normal border border-line rounded px-2 py-0.5 text-muted">Archived</span>}</span>}
        description={[p.code, p.location, humanize(p.status), p.startDate && `${formatDate(p.startDate)} → ${formatDate(p.endDate)}`].filter(Boolean).join(' · ')}
        actions={<>
          <button className="btn-secondary" onClick={() => report().catch((e) => toast(e.message, 'bad'))}>Readiness report (PDF)</button>
          {!archived && can('projects.edit') && <button className="btn-secondary" onClick={() => setAssign(true)}>Assign subcontractors</button>}
          <Menu trigger={(t) => <button className="btn-secondary px-2.5" {...t} aria-label="More actions">•••</button>} items={[
            !archived && can('projects.edit') ? { label: 'Edit project', onClick: () => setEdit(true) } : null,
            can('projects.archive') ? { label: archived ? 'Restore project' : 'Archive project', onClick: () => setArchive(true), danger: !archived } : null,
          ]} />
        </>} />
      {archived && <div className="mb-4"><Callout tone="info">This project is archived. Readiness is frozen at its last recorded state and no reminders are sent for it.</Callout></div>}
      <div className="panel grid grid-cols-3 md:grid-cols-6 divide-x divide-line mb-6 overflow-hidden">
        <Stat label="Assigned" value={c.total} /><Stat label="Ready" value={c.ready} tone="ok" /><Stat label="Action required" value={c.action} tone="warn" />
        <Stat label="Not ready" value={c.notReady} tone="bad" /><Stat label="Pending reviews" value={c.pending} tone="info" /><Stat label="Expiring" value={c.expiring} tone="warn" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'compliance', label: 'Compliance', count: c.total }, { value: 'requirements', label: 'Requirements', count: data.requirements.length }, { value: 'details', label: 'Details' }]} />
      <div className="mt-5">
        {tab === 'compliance' && <ComplianceTab data={data} onAssign={() => setAssign(true)} />}
        {tab === 'requirements' && <RequirementsTab data={data} />}
        {tab === 'details' && (
          <Section title="Project details"><div className="p-4"><KeyValue items={[
            ['Name', p.name], ['Reference', p.code], ['Status', humanize(p.status)], ['Location', p.location], ['Address', p.address], ['Start date', formatDate(p.startDate)], ['Expected completion', formatDate(p.endDate)],
            ['Project manager', data.members?.find?.((m: any) => m.uid === p.managerUid)?.name ?? (p.managerUid ? <MemberName uid={p.managerUid} /> : null)],
            ['Administrators', p.adminUids.length ? p.adminUids.map((u: string) => <MemberName key={u} uid={u} />).reduce((a: any, b: any) => [a, ', ', b]) : null],
            ['Description', p.description], ['Templates applied', p.templateRefs.map((t: any) => `${data.templates.find((x: any) => x.id === t.templateId)?.name ?? 'Template'} v${t.version}`).join(', ')],
            ['Created', formatDateTime(p.createdAt)],
          ]} /></div></Section>
        )}
      </div>
      <ProjectDialog open={edit} onClose={() => setEdit(false)} project={p} />
      <AssignDialog open={assign} onClose={() => setAssign(false)} projectId={p.id} available={data.available} />
      <Confirm open={archive} onClose={() => setArchive(false)} title={archived ? 'Restore project?' : 'Archive project?'} confirmLabel={archived ? 'Restore' : 'Archive'} danger={!archived} busy={archiveM.busy}
        onConfirm={async () => { await archiveM.run({ projectId: p.id, archived: !archived }); setArchive(false); toast(archived ? 'Project restored' : 'Project archived'); }}>
        {archived ? 'Readiness will be recalculated and reminders resume for its subcontractors.' : 'Its readiness records are kept as they are now. Reminders stop for documents that only this project needs. You can restore it later.'}
      </Confirm>
      {me && null}
    </div>
  );
}

function MemberName({ uid }: { uid: string }) {
  const m = useApi<any>('members.list');
  const x = m.data?.members.find((y: any) => y.uid === uid);
  return <>{x ? x.name || x.email : '…'}</>;
}

function ComplianceTab({ data, onAssign }: { data: any; onAssign: () => void }) {
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
  const cols = [{ key: 'legalName', label: 'Company' }, { key: 'trade', label: 'Trade' }, { key: 'contactText', label: 'Contact' }, { key: 'required', label: 'Required' }, { key: 'submitted', label: 'Submitted' }, { key: 'missingText', label: 'Missing' }, { key: 'expiringText', label: 'Expiring' }, { key: 'readinessText', label: 'Compliance status' }, { key: 'summary', label: 'Reason' }, { key: 'last', label: 'Last activity' }];
  const flat = rows.map((s: any) => ({ ...s, contactText: s.contact ? `${s.contact.name} <${s.contact.email}>` : '', missingText: s.missing.join('; '), expiringText: s.expiring.map((e: any) => `${e.name} (${e.date})`).join('; '), readinessText: humanize(s.readiness), last: formatDate(s.lastActivityAt) }));
  if (data.requirements.length === 0) return <Section><Empty title="No requirements on this project yet" action={<span className="text-sm text-muted">Open the Requirements tab to apply a template or add requirements.</span>}>Readiness can't be evaluated until the project says what's needed.</Empty></Section>;
  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search company, trade or contact" className="w-80" />
        <select className="input h-9 w-auto text-sm" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by readiness"><option value="">All statuses</option><option value="not_ready">Not ready</option><option value="action_required">Action required</option><option value="ready">Ready</option><option value="not_evaluated">Not evaluated</option></select>
        <div className="flex-1" />
        <button className="btn-secondary btn-sm" disabled={!rows.length} onClick={() => exportCsv(`${data.project.name} compliance`, cols, flat)}>Export CSV</button>
      </div>
      <div className="panel overflow-x-auto">
        {data.subcontractors.length === 0 ? (
          <Empty title="No subcontractors assigned" action={can('projects.edit') && data.project.status !== 'archived' ? <button className="btn-primary btn-sm" onClick={onAssign}>Assign subcontractors</button> : undefined}>Assign subcontractors to see who is ready to work on this project.</Empty>
        ) : rows.length === 0 ? <Empty title="No matches" /> : (
          <table className="w-full min-w-[1080px]">
            <thead><tr><th className="th w-8" /><th className="th">Company</th><th className="th">Trade</th><th className="th">Contact</th><th className="th text-right">Required</th><th className="th text-right">Submitted</th><th className="th">Missing</th><th className="th">Expiring</th><th className="th">Status</th><th className="th">Last activity</th><th className="th" /></tr></thead>
            <tbody>{rows.map((s: any) => (
              <Fragment key={s.id}>
                <tr className="tr-link" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                  <td className="td text-faint"><span className={cx('inline-block transition-transform', expanded === s.id && 'rotate-90')}>{Icon.chevron()}</span></td>
                  <td className="td"><Link to={`/app/subcontractors/${s.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{s.legalName}</Link>{s.status === 'suspended' && <div className="text-xs text-bad">Suspended</div>}</td>
                  <td className="td text-muted">{s.trade}</td>
                  <td className="td">{s.contact ? <><div className="truncate max-w-[12rem]">{s.contact.name}</div><div className="text-xs text-faint truncate max-w-[12rem]">{s.contact.email}</div></> : <span className="text-faint">None</span>}</td>
                  <td className="td text-right tabular-nums">{s.required}</td><td className="td text-right tabular-nums">{s.submitted}</td>
                  <td className="td">{s.missing.length ? <span className="text-bad">{s.missing.length} · <span className="text-muted">{s.missing.slice(0, 2).join(', ')}{s.missing.length > 2 ? '…' : ''}</span></span> : <span className="text-faint">—</span>}</td>
                  <td className="td">{s.expiring.length ? <span className="text-warn">{s.expiring.map((e: any) => formatDate(e.date)).join(', ')}</span> : s.expired.length ? <span className="text-bad">Expired: {s.expired.join(', ')}</span> : <span className="text-faint">—</span>}</td>
                  <td className="td"><ReadinessBadge value={s.readiness} /></td>
                  <td className="td text-muted whitespace-nowrap">{formatDate(s.lastActivityAt)}</td>
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <Menu trigger={(t) => <button className="btn-ghost btn-sm" {...t} aria-label={`Actions for ${s.legalName}`}>•••</button>} items={[
                      can('requests.send') ? { label: 'Request documents', onClick: () => setRequest(s.id) } : null,
                      { label: 'Open subcontractor', onClick: () => nav(`/app/subcontractors/${s.id}`) },
                      can('projects.edit') ? { label: 'Remove from project', onClick: () => setRemove(s), danger: true } : null,
                    ]} />
                  </td>
                </tr>
                {expanded === s.id && (
                  <tr><td colSpan={11} className="bg-raised/40 border-b border-line px-6 py-4">
                    <div className="text-sm font-medium mb-2">{s.summary}</div>
                    <table className="w-full max-w-4xl">
                      <tbody>{s.results.map((r: any) => (
                        <tr key={r.requirementId} className="border-t border-line/60"><td className="py-2 pr-4 text-sm">{r.requirementName}{!r.mandatory && <span className="text-faint text-xs"> · optional</span>}</td><td className="py-2 pr-4"><StatusText value={r.status} /></td><td className="py-2 text-sm text-muted">{r.reason}</td></tr>
                      ))}</tbody>
                    </table>
                    {can('requests.send') && s.missing.length + s.expiring.length + s.expired.length > 0 && <button className="btn-primary btn-sm mt-3" onClick={() => setRequest(s.id)}>Request outstanding documents</button>}
                  </td></tr>
                )}
              </Fragment>
            ))}</tbody>
          </table>
        )}
      </div>
      {request && <RequestDialog open onClose={() => setRequest(null)} subcontractorId={request} projectId={data.project.id} />}
      <Confirm open={!!remove} onClose={() => setRemove(null)} title={`Remove ${remove?.legalName}?`} confirmLabel="Remove" danger busy={unassign.busy}
        onConfirm={async () => { await unassign.run({ projectId: data.project.id, subcontractorId: remove.id }); setRemove(null); toast('Removed from project'); }}>
        Their documents and history are kept. Readiness for this project is no longer tracked.
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
  return (
    <div className="grid lg:grid-cols-[1fr_20rem] gap-6">
      <Section title="Requirements for this project" description="Mandatory requirements must be approved and in date for a subcontractor to be ready. Optional ones never block readiness.">
        {data.requirements.length === 0 ? <Empty title="No requirements yet">Apply a template or add individual requirements.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px]">
            <thead><tr><th className="th">Requirement</th><th className="th">Category</th><th className="th">Source</th><th className="th">Mandatory</th><th className="th" /></tr></thead>
            <tbody>{data.requirements.map((r: any) => (
              <tr key={r.id}>
                <td className="td"><div className="font-medium">{r.definition?.name}</div><div className="text-xs text-faint">{r.definition?.kind === 'document' ? r.definition?.documentType ?? 'Document' : humanize(r.definition?.kind ?? '')}{r.definition?.expiryRequired ? ' · expires' : ''}{r.definition?.criteria?.length ? ` · ${r.definition.criteria.length} criteria` : ''}</div></td>
                <td className="td text-muted">{r.definition?.category}</td>
                <td className="td text-muted text-xs">{r.source.type === 'template' ? `${data.templates.find((t: any) => t.id === r.source.templateId)?.name ?? 'Template'} v${r.source.version}` : 'Added to project'}</td>
                <td className="td"><Checkbox checked={r.mandatory} disabled={!editable || setReq.busy} onChange={(v) => setReq.run({ projectId: data.project.id, requirementId: r.requirementId, mandatory: v }).then(() => toast(v ? 'Marked mandatory' : 'Marked optional'))} label={r.mandatory ? 'Mandatory' : 'Optional'} /></td>
                <td className="td text-right">{editable && <button className="btn-ghost btn-sm text-bad" onClick={() => setReq.run({ projectId: data.project.id, requirementId: r.requirementId, remove: true }).then(() => toast('Requirement removed from project'))}>Remove</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="px-4 pb-3"><FormError error={setReq.error} /></div>
      </Section>
      {editable && (
        <div className="space-y-4">
          {outdated.length > 0 && <Callout tone="warn" title="Template updated">{outdated.map((t: any) => `${t.name} is now v${t.version} (project uses v${t.appliedVersion})`).join('; ')}. Re-apply to pick up changes — existing decisions are kept in history.</Callout>}
          <Section title="Apply a template"><div className="p-4 space-y-3">
            <select className="input" value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label="Template"><option value="">Choose a template…</option>{data.templates.map((t: any) => <option key={t.id} value={t.id}>{t.name} ({t.items}){t.appliedVersion ? ` — applied v${t.appliedVersion}` : ''}</option>)}</select>
            <button className="btn-primary w-full" disabled={!tpl || apply.busy} onClick={async () => { const r = await apply.run({ projectId: data.project.id, templateId: tpl }); toast(`Template applied: ${r.added} added, ${r.updated} updated`); setTpl(''); }}>{apply.busy && <Spinner />}Apply template</button>
            <p className="text-xs text-muted">Requirements you adjusted on this project are left as they are.</p>
            <FormError error={apply.error} />
          </div></Section>
          <Section title="Add a requirement"><div className="p-4 space-y-3">
            <select className="input" value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Requirement"><option value="">Choose a requirement…</option>{data.allRequirements.filter((r: any) => !used.has(r.id)).map((r: any) => <option key={r.id} value={r.id}>{r.name} · {r.category}</option>)}</select>
            <button className="btn-secondary w-full" disabled={!add || setReq.busy} onClick={async () => { await setReq.run({ projectId: data.project.id, requirementId: add }); toast('Requirement added'); setAdd(''); }}>Add to project</button>
            <Link to="/app/requirements" className="link text-xs">Create a custom requirement</Link>
          </div></Section>
        </div>
      )}
    </div>
  );
}

function AssignDialog({ open, onClose, projectId, available }: { open: boolean; onClose: () => void; projectId: string; available: any[] }) {
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const { run, busy, error } = useMutation('projects.assign');
  const toast = useToast();
  const list = available.filter((s) => `${s.legalName} ${s.trade}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog open={open} onClose={onClose} title="Assign subcontractors" footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={!sel.length || busy} onClick={async () => { await run({ projectId, subcontractorIds: sel }); toast(`${sel.length} assigned`); setSel([]); onClose(); }}>{busy && <Spinner />}Assign {sel.length || ''}</button>
    </>}>
      {available.length === 0 ? <Empty title="Everyone is already assigned" action={<Link to="/app/subcontractors?new=1" className="btn-secondary btn-sm">Add a subcontractor</Link>} /> : (
        <>
          <SearchInput value={q} onChange={setQ} placeholder="Filter" />
          <div className="mt-3 max-h-80 overflow-y-auto space-y-2">{list.map((s) => <Checkbox key={s.id} checked={sel.includes(s.id)} onChange={(v) => setSel(v ? [...sel, s.id] : sel.filter((x) => x !== s.id))} label={s.legalName} hint={s.trade} />)}</div>
          <p className="text-xs text-muted mt-3">Readiness is calculated immediately from the project's requirements and any documents already on file.</p>
          <FormError error={error} />
        </>
      )}
    </Dialog>
  );
}

export { STATUS_LABELS };
