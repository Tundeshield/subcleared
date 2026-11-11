import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { READINESS_LABELS } from '../../domain/compliance';
import { formatDate, formatDateTime } from '../../domain/dates';
import type { RequirementStatus } from '../../domain/types';
import { useApi, useMutation } from '../../lib/api';
import { useSession } from '../../lib/session';
import {
  Callout, Confirm, cx, Dialog, DocStatus, Empty, ErrorState, Field, FormError, humanize, KeyValue, Menu, MoreButton, PageHeader, PageLoading, ReadinessBadge,
  SampleTag, Spinner, StatusText, Tabs, useToast, VerificationLabel,
} from '../../ui';
import { activityLine, openFile, RequestDialog, UploadDialog } from './shared';
import { SubDrawer } from './Subcontractors';

type Tab = 'overview' | 'projects' | 'documents' | 'requirements' | 'activity' | 'notes';

export default function SubDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<any>('subs.get', { subcontractorId: id });
  const [edit, setEdit] = useState(false);
  const [request, setRequest] = useState<null | { type: 'request' | 'portal_access'; requirementIds?: string[]; projectId?: string }>(null);
  const [statusAction, setStatusAction] = useState<null | 'suspended' | 'archived' | 'active'>(null);
  const setStatus = useMutation('subs.setStatus');
  const toast = useToast();
  if (loading && !data) return <PageLoading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const s = data.subcontractor;
  const inactive = ['suspended', 'archived'].includes(s.status);
  const setTab = (t: Tab) => setParams({ tab: t });
  const primary = s.contacts.find((c: any) => c.primary) ?? s.contacts[0];
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Subcontractors', to: '/app/subcontractors' }, { label: s.legalName }]}
        title={<>{s.legalName} {s.sample && <SampleTag />}</>}
        meta={<><span>{s.trade}</span>{s.tradingName && <span>Trading as {s.tradingName}</span>}{(s.jurisdiction || s.country) && <span>{[s.jurisdiction, s.country].filter(Boolean).join(', ')}</span>}<span>{s.status === 'attention' ? 'Attention required' : humanize(s.status)}</span></>}
        actions={<>
          {can('requests.send') && !inactive && <button className="btn-primary" onClick={() => setRequest({ type: 'request' })}>Request documents</button>}
          <Menu trigger={(t) => <MoreButton label="More actions" {...t} />} items={[
            can('subs.manage') && { label: 'Edit details and contacts', onClick: () => setEdit(true) },
            can('requests.send') && !inactive && { label: 'Invite to the subcontractor portal', onClick: () => setRequest({ type: 'portal_access' }) },
            can('subs.manage') && !inactive && { label: 'Suspend', onClick: () => setStatusAction('suspended'), danger: true },
            can('subs.manage') && s.status !== 'archived' && { label: 'Archive', onClick: () => setStatusAction('archived'), danger: true },
            can('subs.manage') && inactive && { label: 'Restore', onClick: () => setStatusAction('active') },
          ]} />
        </>} />
      {s.status === 'suspended' && <div className="mb-8"><Callout tone="bad" title="Suspended">Not ready on any project while suspended, and every upload link they had has been withdrawn.</Callout></div>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Overview' }, { value: 'projects', label: 'Projects', count: data.projects.length }, { value: 'requirements', label: 'Requirements' },
        { value: 'documents', label: 'Documents', count: data.documents.filter((d: any) => d.versions.length).length }, { value: 'activity', label: 'Activity' },
        ...(data.notes ? [{ value: 'notes' as Tab, label: 'Notes', count: data.notes.length }] : []),
      ]} />
      <div className="mt-8">
        {tab === 'overview' && (
          <div className="grid lg:grid-cols-[1.2fr_1fr] gap-x-14 gap-y-10">
            <section>
              <h2 className="text-lg font-semibold mb-2">Readiness by project</h2>
              {data.projects.length === 0 ? <p className="text-muted">Not assigned to any project yet. Assign from a project's page.</p> : (
                <ul className="border-t border-line-strong">{data.projects.map((p: any) => (
                  <li key={p.id} className="py-4 border-b border-line">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">{p.visible ? <Link to={`/app/projects/${p.id}`} className="font-medium hover:underline underline-offset-4">{p.name}</Link> : <span className="font-medium">{p.name}</span>}<ReadinessBadge value={p.readiness} size="sm" /></div>
                    <p className="text-sm text-muted mt-1">{p.summary}</p>
                  </li>
                ))}</ul>
              )}
              <h2 className="text-lg font-semibold mt-10 mb-2">Company</h2>
              <KeyValue items={[
                ['Legal name', s.legalName], ['Trading name', s.tradingName], ['Registration', s.registrationNumber], ['Company type', s.companyType], ['Trade', s.trade],
                ['Type of work', s.subTypes.map(humanize).join(', ')], ['Address', s.address], ['Location', [s.jurisdiction, s.country].filter(Boolean).join(', ')], ['Tags', s.tags.join(', ')],
                ['Onboarded', formatDate(s.onboardingDate)],
              ]} />
            </section>
            <section>
              <h2 className="text-lg font-semibold mb-2">Contacts</h2>
              {s.contacts.length === 0 ? <p className="text-muted">No contacts yet. Add one to send document requests.</p> : (
                <ul className="border-t border-line-strong">{s.contacts.map((c: any) => (
                  <li key={c.id} className="py-4 border-b border-line">
                    <div className="flex items-center gap-2"><span className="font-medium">{c.name}</span>{c.id === primary?.id && <span className="text-xs text-accent">Primary</span>}{c.portalAccess && <span className="text-xs text-faint">· Portal access</span>}</div>
                    <div className="text-muted mt-0.5 break-all">{c.email}</div>{c.phone && <div className="text-muted">{c.phone}</div>}
                    <div className="text-xs text-faint mt-1">{c.roles.map(humanize).join(', ')}</div>
                  </li>
                ))}</ul>
              )}
              {can('subs.manage') && <button className="btn-secondary btn-sm mt-4" onClick={() => setEdit(true)}>Edit contacts</button>}
            </section>
          </div>
        )}
        {tab === 'projects' && <ProjectsTab data={data} onRequest={(projectId) => setRequest({ type: 'request', projectId })} />}
        {tab === 'documents' && <DocumentsTab data={data} />}
        {tab === 'requirements' && <RequirementsTab data={data} onRequest={(rid, projectId) => setRequest({ type: 'request', requirementIds: [rid], projectId })} />}
        {tab === 'activity' && <ActivityTab data={data} />}
        {tab === 'notes' && data.notes && <NotesTab data={data} />}
      </div>
      <SubDrawer open={edit} onClose={() => setEdit(false)} sub={s} />
      {request && <RequestDialog open onClose={() => setRequest(null)} subcontractorId={s.id} type={request.type} requirementIds={request.requirementIds} projectId={request.projectId} />}
      <Confirm open={!!statusAction} onClose={() => setStatusAction(null)} busy={setStatus.busy} danger={statusAction !== 'active'} requireReason={statusAction !== 'active'}
        title={statusAction === 'active' ? `Restore ${s.legalName}?` : `${statusAction === 'suspended' ? 'Suspend' : 'Archive'} ${s.legalName}?`} confirmLabel={statusAction === 'active' ? 'Restore' : humanize(statusAction ?? '')}
        onConfirm={async (reason) => { await setStatus.run({ subcontractorId: s.id, status: statusAction, reason }); setStatusAction(null); toast('Status updated'); }}>
        {statusAction === 'suspended' ? 'They will show as not ready on every project, and all of their upload links will be withdrawn immediately.' : statusAction === 'archived' ? "Archived subcontractors leave your active count and stop receiving reminders. Their history is kept." : 'Readiness is recalculated from their current documents.'}
      </Confirm>
    </div>
  );
}

function ProjectsTab({ data, onRequest }: { data: any; onRequest: (projectId: string) => void }) {
  const { can } = useSession();
  const [hist, setHist] = useState<string | null>(null);
  if (data.projects.length === 0) return <Empty title="Not assigned to any project">Assign this subcontractor from a project's page. Readiness is worked out separately for each project.</Empty>;
  return (
    <div className="space-y-12">
      {data.projects.map((p: any) => (
        <section key={p.id}>
          <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-line-strong">
            <div><h2 className="text-lg font-semibold">{p.visible ? <Link to={`/app/projects/${p.id}`} className="hover:underline underline-offset-4">{p.name}</Link> : p.name}</h2><div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm"><ReadinessBadge value={p.readiness} size="sm" /><span className="text-faint">{p.evaluatedAt && `Checked ${formatDateTime(p.evaluatedAt)}`}</span></div></div>
            <div className="flex gap-2"><button className="btn-ghost btn-sm" onClick={() => setHist(p.id)}>History</button>{can('requests.send') && p.readiness !== 'ready' && <button className="btn-secondary btn-sm" onClick={() => onRequest(p.id)}>Request outstanding</button>}</div>
          </div>
          <table className="w-full"><tbody>{p.results.map((r: any) => (
            <tr key={r.requirementId} className="border-b border-line"><td className="py-3 pr-4 w-[30%] align-top">{r.requirementName}{!r.mandatory && <span className="text-sm text-faint"> · optional</span>}</td><td className="py-3 pr-4 w-[18%] align-top"><StatusText value={r.status} /></td><td className="py-3 text-sm text-muted align-top">{r.reason}</td></tr>
          ))}</tbody></table>
        </section>
      ))}
      {hist && <HistoryDialog subId={data.subcontractor.id} projectId={hist} projectName={data.projects.find((p: any) => p.id === hist)?.name} onClose={() => setHist(null)} />}
    </div>
  );
}

function HistoryDialog({ subId, projectId, projectName, onClose }: { subId: string; projectId: string; projectName: string; onClose: () => void }) {
  const { data } = useApi<any>('compliance.history', { subcontractorId: subId, projectId });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose} title="Compliance history" description={`${projectName} · each change in readiness, with the rule versions that produced it`} width="max-w-3xl">
      {!data ? <Spinner /> : data.items.length === 0 ? <Empty title="No evaluations yet" /> : (
        <ol className="border-t border-line">{data.items.map((e: any) => (
          <li key={e.id} className="border-b border-line">
            <button className="w-full text-left py-3 flex items-center gap-4" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
              <ReadinessBadge value={e.readiness} size="sm" /><span className="flex-1 text-sm text-muted truncate">{e.summary}</span><span className="text-xs text-faint whitespace-nowrap">{formatDateTime(e.evaluatedAt)}</span>
            </button>
            {open === e.id && (
              <div className="pb-4 text-sm space-y-3">
                <div className="text-xs text-faint">Trigger: {humanize(e.trigger)} · Previously: {e.previousReadiness ? (READINESS_LABELS as any)[e.previousReadiness] : 'none'} · Assessed for {formatDate(e.ruleSnapshot.today)} ({e.ruleSnapshot.timezone}) · Expiring-soon window {e.ruleSnapshot.expiringSoonDays} days</div>
                <table className="w-full"><tbody>{e.results.map((r: any) => <tr key={r.requirementId} className="border-t border-line"><td className="py-2 pr-3">{r.requirementName} <span className="text-xs text-faint">v{r.requirementVersion}{r.mandatory ? '' : ' · optional'}</span></td><td className="py-2 pr-3"><StatusText value={r.status} /></td><td className="py-2 text-muted">{r.reason}</td></tr>)}</tbody></table>
              </div>
            )}
          </li>
        ))}</ol>
      )}
    </Dialog>
  );
}

function DocumentsTab({ data }: { data: any }) {
  const { can } = useSession();
  const [upload, setUpload] = useState(false);
  const toast = useToast();
  const docs = data.documents.filter((d: any) => d.versions.some((v: any) => v.reviewStatus !== 'uploading'));
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-line-strong">
        <div><h2 className="text-lg font-semibold">Documents</h2><p className="text-sm text-muted mt-0.5">The evidence in force and every earlier version. Nothing is deleted when a replacement arrives.</p></div>
        {can('documents.upload') && <button className="btn-secondary btn-sm" onClick={() => setUpload(true)}>Upload on their behalf</button>}
      </div>
      {docs.length === 0 ? <Empty title="No documents yet">Send a request so the subcontractor can upload, or upload on their behalf.</Empty> : (
        <div>{docs.map((d: any) => {
          const inForce = d.versions.find((v: any) => v.id === d.approvedVersionId);
          return (
            <div key={d.id} className="py-5 border-b border-line">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="min-w-0"><Link to={`/app/documents/${d.id}`} className="font-medium hover:underline underline-offset-4">{d.title}</Link>{d.archived && <span className="text-xs text-faint ml-2">Archived</span>}
                  <div className="text-sm text-muted">{d.requirementName ?? 'Ad-hoc document'}{inForce ? (inForce.metadata.expiryDate ? ` · Valid until ${formatDate(inForce.metadata.expiryDate)}` : ' · Does not expire') : ''}</div>
                  {inForce && <VerificationLabel value={inForce.verification} />}
                </div>
                <Link to={`/app/documents/${d.id}`} className="btn-quiet">Open</Link>
              </div>
              <ol className="mt-3 space-y-1.5">{d.versions.filter((v: any) => v.reviewStatus !== 'uploading').map((v: any) => (
                <li key={v.id} className="grid grid-cols-[2.5rem_1fr] sm:grid-cols-[2.5rem_minmax(10rem,1fr)_auto_auto] gap-x-4 gap-y-0.5 text-sm items-baseline">
                  <span className="text-faint font-mono text-xs">v{v.versionNumber}</span>
                  <button className="text-left hover:underline underline-offset-4 truncate disabled:no-underline disabled:text-faint" disabled={v.reviewStatus === 'quarantined'} onClick={() => openFile(v.id).catch((e) => toast(e.message, 'bad'))}>{v.fileName}</button>
                  <DocStatus value={v.reviewStatus} />
                  <span className="text-xs text-faint">{formatDateTime(v.uploadedAt)}{['awaiting_review', 'under_review', 'submitted'].includes(v.reviewStatus) && can('documents.review') && <> · <Link to={`/app/reviews/${v.id}`} className="link">Review</Link></>}</span>
                  {v.review?.reason && <span className="col-start-2 sm:col-span-3 text-xs text-muted">“{v.review.reason}”</span>}
                </li>
              ))}</ol>
            </div>
          );
        })}</div>
      )}
      <UploadDialog open={upload} onClose={() => setUpload(false)} subcontractorId={data.subcontractor.id} requirements={data.requirements} />
    </section>
  );
}

function RequirementsTab({ data, onRequest }: { data: any; onRequest: (rid: string, projectId?: string) => void }) {
  const { can } = useSession();
  const [params] = useSearchParams();
  const [na, setNa] = useState<any>(null);
  const [confirm, setConfirm] = useState<any>(null);
  const [upload, setUpload] = useState<string | null>(null);
  const revoke = useMutation('overrides.revoke');
  const toast = useToast();
  const focus = params.get('project');
  const rows = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of data.projects) for (const r of p.results) {
      const row = m.get(r.requirementId) ?? { requirementId: r.requirementId, name: r.requirementName, perProject: [] as any[] };
      row.perProject.push({ projectId: p.id, projectName: p.name, ...r });
      m.set(r.requirementId, row);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const defs = new Map(data.requirements.map((r: any) => [r.id, r]));
  if (rows.length === 0) return <Empty title="No requirements apply yet">Assign this subcontractor to a project that has requirements.</Empty>;
  const groups: [string, (r: any) => boolean][] = [
    ['Outstanding', (r) => r.perProject.some((x: any) => x.blocking)],
    ['Needs attention', (r) => r.perProject.some((x: any) => ['expiring_soon', 'awaiting_review', 'review_required', 'requested'].includes(x.status))],
    ['Satisfied', (r) => r.perProject.some((x: any) => x.status === 'approved')],
    ['Optional or not applicable', () => true],
  ];
  const placed = new Set<string>();
  return (
    <div className="space-y-12">
      {groups.map(([label, test]) => {
        const items = rows.filter((r) => !placed.has(r.requirementId) && test(r));
        items.forEach((i) => placed.add(i.requirementId));
        if (!items.length) return null;
        return (
          <section key={label}>
            <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">{label} <span className="text-faint font-normal tnum">{items.length}</span></h2>
            {items.map((r) => {
              const def: any = defs.get(r.requirementId);
              const overrides = data.overrides.filter((o: any) => o.requirementId === r.requirementId);
              const needed = r.perProject.some((x: any) => x.status !== 'approved' && x.status !== 'not_applicable');
              return (
                <div key={r.requirementId} className={cx('py-5 border-b border-line', focus && r.perProject.some((x: any) => x.projectId === focus) && 'bg-accent/[0.04] -mx-3 px-3 rounded')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="font-medium">{r.name}</div><div className="text-sm text-faint">{def?.category}{def?.kind !== 'document' ? ` · ${def?.kind === 'declaration' ? 'Declaration' : 'Manual check'}` : ''}</div></div>
                    <div className="flex flex-wrap gap-1">
                      {def?.kind === 'document' && can('documents.upload') && <button className="btn-ghost btn-sm" onClick={() => setUpload(r.requirementId)}>Upload</button>}
                      {def?.kind === 'document' && can('requests.send') && needed && <button className="btn-ghost btn-sm" onClick={() => onRequest(r.requirementId)}>Request</button>}
                      {def?.kind !== 'document' && can('documents.review') && <button className="btn-secondary btn-sm" onClick={() => setConfirm({ requirementId: r.requirementId, name: r.name, def })}>Record confirmation</button>}
                      {can('requirements.override') && <button className="btn-ghost btn-sm" onClick={() => setNa({ requirementId: r.requirementId, name: r.name })}>Not applicable…</button>}
                    </div>
                  </div>
                  <table className="w-full mt-3"><tbody>{r.perProject.map((x: any) => (
                    <tr key={x.projectId} className="border-t border-line/70"><td className="py-2 pr-4 text-sm w-[28%] text-muted align-top">{x.projectName}{!x.mandatory && ' · optional'}</td><td className="py-2 pr-4 w-[18%] align-top"><StatusText value={x.status} /></td><td className="py-2 text-sm text-muted align-top">{x.reason}</td></tr>
                  ))}</tbody></table>
                  {overrides.map((o: any) => (
                    <div key={o.id} className="mt-2 text-sm text-muted flex flex-wrap gap-x-3 items-baseline">
                      <span>{o.type === 'not_applicable' ? 'Not applicable' : 'Confirmed'} ({o.scope === 'all' ? 'all projects' : data.projects.find((p: any) => p.id === o.scope)?.name ?? 'project'}) by {o.decidedBy.name}, {formatDate(o.decidedAt)}: “{o.reason}”{o.validUntil ? ` · valid until ${formatDate(o.validUntil)}` : ''}</span>
                      {(o.type === 'not_applicable' ? can('requirements.override') : can('documents.review')) && <button className="btn-quiet" onClick={() => revoke.run({ overrideId: o.id }).then(() => toast('Decision withdrawn'))}>Withdraw</button>}
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}
      <OverrideDialog state={na} type="not_applicable" subcontractorId={data.subcontractor.id} onClose={() => setNa(null)} projects={data.projects} />
      <OverrideDialog state={confirm} type="manual_confirmation" subcontractorId={data.subcontractor.id} onClose={() => setConfirm(null)} projects={data.projects} />
      <UploadDialog open={!!upload} onClose={() => setUpload(null)} subcontractorId={data.subcontractor.id} requirementId={upload ?? undefined} requirements={data.requirements} />
    </div>
  );
}

function OverrideDialog({ state, type, subcontractorId, onClose, projects }: { state: any; type: 'not_applicable' | 'manual_confirmation'; subcontractorId: string; onClose: () => void; projects: any[] }) {
  const [scope, setScope] = useState('all');
  const [reason, setReason] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const { run, busy, error } = useMutation('overrides.set');
  const toast = useToast();
  if (!state) return null;
  return (
    <Dialog open onClose={onClose} title={type === 'not_applicable' ? `Mark “${state.name}” not applicable` : `Record a confirmation: ${state.name}`} description="Recorded with your name in the audit trail and shown wherever this status appears." footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={busy || !reason.trim()} onClick={async () => { await run({ type, subcontractorId, requirementId: state.requirementId, projectId: scope === 'all' ? undefined : scope, reason, validUntil: validUntil || undefined }); toast('Decision recorded'); onClose(); }}>{busy && <Spinner />}Record</button>
    </>}>
      <div className="space-y-5">
        <Field label="Applies to"><select className="input" value={scope} onChange={(e) => setScope(e.target.value)}><option value="all">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name} only</option>)}</select></Field>
        <Field label={type === 'not_applicable' ? 'Why it doesn’t apply' : 'What was confirmed, and how'} required>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === 'not_applicable' ? 'e.g. No vehicles are used on this contract' : 'e.g. Checked the CIS verification number with HMRC on 3 March'} />
        </Field>
        {type === 'manual_confirmation' && <Field label="Valid until" optional hint={state.def?.renewalPeriodDays ? `Defaults to ${state.def.renewalPeriodDays} days from today.` : undefined}><input type="date" className="input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>}
        <FormError error={error} />
      </div>
    </Dialog>
  );
}

function ActivityTab({ data }: { data: any }) {
  const { can } = useSession();
  const audit = useApi<any>('audit.list', { ref: data.subcontractor.id, limit: 300 });
  const revoke = useMutation('links.revoke');
  const resend = useMutation('requests.resend');
  const toast = useToast();
  const now = new Date().toISOString();
  return (
    <div className="grid xl:grid-cols-2 gap-x-14 gap-y-12">
      <section>
        <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Requests and upload links</h2>
        {data.requests.length === 0 ? <p className="text-muted mt-4">No requests sent yet.</p> : (
          <ul>{data.requests.map((r: any) => {
            const l = data.links.find((x: any) => x.id === r.linkId);
            const live = l && !l.revokedAt && l.expiresAt > now;
            return (
              <li key={r.id} className="py-4 border-b border-line">
                <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{r.type === 'portal_access' ? 'Portal invitation' : r.type === 'renewal' ? 'Renewal request' : 'Document request'}</span><span className="text-sm text-muted">{humanize(r.status)}</span></div>
                <div className="text-sm text-muted mt-0.5 break-all">To {r.contactEmail}</div>
                <div className="text-xs text-faint mt-1">{formatDateTime(r.createdAt)} by {r.createdBy.name}{r.dueDate ? ` · due ${formatDate(r.dueDate)}` : ''}{r.acknowledgedAt ? ` · opened ${formatDateTime(r.acknowledgedAt)}` : ''}</div>
                {l && <div className="text-xs mt-1 text-muted">{l.revokedAt ? `Link withdrawn ${formatDateTime(l.revokedAt)}` : l.expiresAt < now ? `Link expired ${formatDate(l.expiresAt)}` : `Link active until ${formatDate(l.expiresAt)}`}{l.useCount ? ` · opened ${l.useCount}×` : ''}</div>}
                {can('requests.send') && (
                  <div className="mt-2.5 flex gap-4">
                    {live && <button className="btn-quiet text-ink" onClick={() => revoke.run({ linkId: l.id }).then(() => toast('Link withdrawn'))}>Withdraw link</button>}
                    {['sent', 'acknowledged', 'partially_fulfilled', 'expired'].includes(r.status) && <button className="btn-quiet" onClick={() => resend.run({ requestId: r.id }).then(() => toast('Sent again with a new link'))}>Send again</button>}
                  </div>
                )}
              </li>
            );
          })}</ul>
        )}
        <div className="mt-3"><FormError error={revoke.error || resend.error} /></div>
      </section>
      <section>
        <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Activity</h2>
        {!audit.data ? <Spinner /> : audit.data.items.length === 0 ? <p className="text-muted mt-4">No activity yet.</p> : (
          <ol className="max-h-[720px] overflow-y-auto">{audit.data.items.map((e: any) => (
            <li key={e.id} className="py-3 border-b border-line"><div>{activityLine(e)}</div>{e.after?.reason && <div className="text-sm text-muted">“{e.after.reason}”</div>}<div className="text-xs text-faint mt-0.5">{formatDateTime(e.at)}</div></li>
          ))}</ol>
        )}
      </section>
    </div>
  );
}

function NotesTab({ data }: { data: any }) {
  const [text, setText] = useState('');
  const { run, busy, error } = useMutation('subs.addNote');
  return (
    <section className="max-w-3xl">
      <p className="text-muted">Internal to your organisation. Never shown to the subcontractor.</p>
      <div className="mt-4 space-y-3">
        <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note" aria-label="New note" />
        <div className="flex justify-end"><button className="btn-primary btn-sm" disabled={busy || !text.trim()} onClick={async () => { await run({ subcontractorId: data.subcontractor.id, text }); setText(''); }}>{busy && <Spinner />}Add note</button></div>
        <FormError error={error} />
      </div>
      {data.notes.length === 0 ? <p className="text-faint mt-6">No notes yet.</p> : <ul className="mt-6 border-t border-line-strong">{data.notes.map((n: any) => <li key={n.id} className="py-4 border-b border-line"><p className="whitespace-pre-wrap">{n.text}</p><div className="text-xs text-faint mt-1.5">{n.by.name} · {formatDateTime(n.at)}</div></li>)}</ul>}
    </section>
  );
}

export type { RequirementStatus };
