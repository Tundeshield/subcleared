import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { READINESS_LABELS, STATUS_LABELS } from '../../domain/compliance';
import { formatDate, formatDateTime } from '../../domain/dates';
import type { RequirementStatus } from '../../domain/types';
import { useApi, useMutation } from '../../lib/api';
import { useSession } from '../../lib/session';
import {
  Callout, Confirm, cx, Dialog, DocStatus, Empty, ErrorState, Field, FormError, humanize, KeyValue, Menu, PageHeader, PageLoading, ReadinessBadge, Section,
  Spinner, StatusText, Tabs, useToast, VerificationLabel,
} from '../../ui';
import { openFile, RequestDialog, UploadDialog } from './shared';
import { SubDialog } from './Subcontractors';

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
  return (
    <div>
      <PageHeader eyebrow={<Link to="/app/subcontractors" className="hover:text-ink">Subcontractors</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{s.legalName}<span className={cx('text-xs font-normal border rounded px-2 py-0.5', s.status === 'suspended' ? 'border-bad/30 text-bad' : s.status === 'attention' ? 'border-warn/30 text-warn' : 'border-line text-muted')}>{s.status === 'attention' ? 'Compliance attention required' : humanize(s.status)}</span></span>}
        description={[s.tradingName && `Trading as ${s.tradingName}`, s.trade, s.jurisdiction || s.country].filter(Boolean).join(' · ')}
        actions={<>
          {can('requests.send') && !inactive && <button className="btn-primary" onClick={() => setRequest({ type: 'request' })}>Request documents</button>}
          <Menu trigger={(t) => <button className="btn-secondary px-2.5" {...t} aria-label="More actions">•••</button>} items={[
            can('subs.manage') ? { label: 'Edit details and contacts', onClick: () => setEdit(true) } : null,
            can('requests.send') && !inactive ? { label: 'Invite to subcontractor portal', onClick: () => setRequest({ type: 'portal_access' }) } : null,
            can('subs.manage') && s.status !== 'suspended' && s.status !== 'archived' ? { label: 'Suspend', onClick: () => setStatusAction('suspended'), danger: true } : null,
            can('subs.manage') && s.status !== 'archived' ? { label: 'Archive', onClick: () => setStatusAction('archived'), danger: true } : null,
            can('subs.manage') && inactive ? { label: 'Restore', onClick: () => setStatusAction('active') } : null,
          ]} />
        </>} />
      {s.status === 'suspended' && <div className="mb-4"><Callout tone="bad" title="Suspended">This subcontractor is not ready on any project while suspended, and their external links are revoked.</Callout></div>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Overview' }, { value: 'projects', label: 'Projects', count: data.projects.length }, { value: 'documents', label: 'Documents', count: data.documents.length },
        { value: 'requirements', label: 'Requirements' }, { value: 'activity', label: 'Activity' }, ...(data.notes ? [{ value: 'notes' as Tab, label: 'Notes', count: data.notes.length }] : []),
      ]} />
      <div className="mt-5">
        {tab === 'overview' && <OverviewTab data={data} />}
        {tab === 'projects' && <ProjectsTab data={data} onRequest={(projectId) => setRequest({ type: 'request', projectId })} />}
        {tab === 'documents' && <DocumentsTab data={data} />}
        {tab === 'requirements' && <RequirementsTab data={data} onRequest={(rid, projectId) => setRequest({ type: 'request', requirementIds: [rid], projectId })} />}
        {tab === 'activity' && <ActivityTab data={data} />}
        {tab === 'notes' && data.notes && <NotesTab data={data} />}
      </div>
      <SubDialog open={edit} onClose={() => setEdit(false)} sub={s} />
      {request && <RequestDialog open onClose={() => setRequest(null)} subcontractorId={s.id} type={request.type} requirementIds={request.requirementIds} projectId={request.projectId} />}
      <Confirm open={!!statusAction} onClose={() => setStatusAction(null)} busy={setStatus.busy} danger={statusAction !== 'active'} requireReason={statusAction !== 'active'}
        title={statusAction === 'active' ? `Restore ${s.legalName}?` : `${statusAction === 'suspended' ? 'Suspend' : 'Archive'} ${s.legalName}?`} confirmLabel={statusAction === 'active' ? 'Restore' : humanize(statusAction ?? '')}
        onConfirm={async (reason) => { await setStatus.run({ subcontractorId: s.id, status: statusAction, reason }); setStatusAction(null); toast('Status updated'); }}>
        {statusAction === 'suspended' ? 'They will show as not ready on every project and all of their external links will be revoked immediately. The reason is recorded in the audit trail.' : statusAction === 'archived' ? 'Archived subcontractors leave your active count and stop receiving reminders. All history is kept.' : 'Readiness is recalculated from their current documents.'}
      </Confirm>
    </div>
  );
}

function OverviewTab({ data }: { data: any }) {
  const s = data.subcontractor;
  const members = useApi<any>('members.list');
  const owner = members.data?.members.find((m: any) => m.uid === s.ownerUid);
  return (
    <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6">
      <Section title="Company"><div className="p-4"><KeyValue items={[
        ['Legal name', s.legalName], ['Trading name', s.tradingName], ['Registration number', s.registrationNumber], ['Company type', s.companyType], ['Primary trade', s.trade],
        ['Types', s.subTypes.map(humanize).join(', ')], ['Address', s.address], ['Country', s.country], ['Jurisdiction', s.jurisdiction], ['Tags', s.tags.join(', ')],
        ['Onboarding date', formatDate(s.onboardingDate)], ['Internal owner', owner ? owner.name || owner.email : null], ['Added', formatDateTime(s.createdAt)],
      ]} /></div></Section>
      <div className="space-y-6">
        <Section title="Readiness by project">{data.projects.length === 0 ? <Empty title="Not assigned to any project" /> : (
          <ul className="divide-y divide-line">{data.projects.map((p: any) => (
            <li key={p.id} className="px-4 py-3 flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-medium truncate">{p.visible ? <Link to={`/app/projects/${p.id}`} className="hover:underline">{p.name}</Link> : p.name}</div><div className="text-xs text-muted">{p.summary}</div></div><ReadinessBadge value={p.readiness} /></li>
          ))}</ul>
        )}</Section>
        <Section title="Contacts">{s.contacts.length === 0 ? <Empty title="No contacts">Add a contact to send document requests.</Empty> : (
          <ul className="divide-y divide-line">{s.contacts.map((c: any) => (
            <li key={c.id} className="px-4 py-3 text-sm"><div className="flex items-center gap-2"><span className="font-medium">{c.name}</span>{c.primary && <span className="text-xs text-accent">Primary</span>}{c.portalAccess && <span className="text-xs text-muted">· Portal access</span>}</div>
              <div className="text-muted">{c.email}{c.phone ? ` · ${c.phone}` : ''}</div><div className="text-xs text-faint">{c.roles.map(humanize).join(', ')}</div></li>
          ))}</ul>
        )}</Section>
      </div>
    </div>
  );
}

function ProjectsTab({ data, onRequest }: { data: any; onRequest: (projectId: string) => void }) {
  const { can } = useSession();
  const [hist, setHist] = useState<string | null>(null);
  if (data.projects.length === 0) return <Section><Empty title="Not assigned to any project">Assign from a project's page. Readiness is calculated separately for each project.</Empty></Section>;
  return (
    <div className="space-y-4">
      {data.projects.map((p: any) => (
        <Section key={p.id} title={<span className="flex items-center gap-3">{p.visible ? <Link to={`/app/projects/${p.id}`} className="hover:underline">{p.name}</Link> : p.name}<ReadinessBadge value={p.readiness} size="sm" /></span>}
          description={`${p.summary ?? ''}${p.evaluatedAt ? ` · evaluated ${formatDateTime(p.evaluatedAt)}` : ''}`}
          actions={<><button className="btn-ghost btn-sm" onClick={() => setHist(p.id)}>History</button>{can('requests.send') && p.readiness !== 'ready' && <button className="btn-secondary btn-sm" onClick={() => onRequest(p.id)}>Request outstanding</button>}</>}>
          <div className="overflow-x-auto"><table className="w-full min-w-[640px]"><tbody>
            {p.results.map((r: any) => (
              <tr key={r.requirementId}><td className="td w-[30%]">{r.requirementName}{!r.mandatory && <span className="text-xs text-faint"> · optional</span>}</td><td className="td w-[16%]"><StatusText value={r.status} /></td><td className="td text-muted">{r.reason}</td></tr>
            ))}
          </tbody></table></div>
        </Section>
      ))}
      {hist && <HistoryDialog subId={data.subcontractor.id} projectId={hist} projectName={data.projects.find((p: any) => p.id === hist)?.name} onClose={() => setHist(null)} />}
    </div>
  );
}

function HistoryDialog({ subId, projectId, projectName, onClose }: { subId: string; projectId: string; projectName: string; onClose: () => void }) {
  const { data } = useApi<any>('compliance.history', { subcontractorId: subId, projectId });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose} title="Compliance history" description={`${projectName} · every change in readiness, with the rules that produced it`} width="max-w-3xl">
      {!data ? <Spinner /> : data.items.length === 0 ? <Empty title="No evaluations yet" /> : (
        <ol className="space-y-2">{data.items.map((e: any) => (
          <li key={e.id} className="rounded border border-line">
            <button className="w-full text-left px-3 py-2.5 flex items-center gap-3" onClick={() => setOpen(open === e.id ? null : e.id)}>
              <ReadinessBadge value={e.readiness} size="sm" /><span className="flex-1 text-sm truncate">{e.summary}</span><span className="text-xs text-faint whitespace-nowrap">{formatDateTime(e.evaluatedAt)}</span>
            </button>
            {open === e.id && (
              <div className="px-3 pb-3 text-sm space-y-2 border-t border-line pt-2">
                <div className="text-xs text-muted">Trigger: {humanize(e.trigger)} · Previous: {e.previousReadiness ? READINESS_LABELS[e.previousReadiness as keyof typeof READINESS_LABELS] : 'none'} · Evaluated for {formatDate(e.ruleSnapshot.today)} ({e.ruleSnapshot.timezone}) · Expiring-soon window {e.ruleSnapshot.expiringSoonDays} days</div>
                <table className="w-full"><tbody>{e.results.map((r: any) => <tr key={r.requirementId} className="border-t border-line/60"><td className="py-1.5 pr-3">{r.requirementName} <span className="text-xs text-faint">v{r.requirementVersion}{r.mandatory ? '' : ' · optional'}</span></td><td className="py-1.5 pr-3"><StatusText value={r.status} /></td><td className="py-1.5 text-muted">{r.reason}</td></tr>)}</tbody></table>
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
    <Section title="Documents" description="Current evidence and every earlier version. Nothing is deleted when a replacement arrives." actions={can('documents.upload') && <button className="btn-secondary btn-sm" onClick={() => setUpload(true)}>Upload on their behalf</button>}>
      {docs.length === 0 ? <Empty title="No documents yet">Send a request so the subcontractor can upload, or upload on their behalf.</Empty> : (
        <div className="divide-y divide-line">{docs.map((d: any) => {
          const approved = d.versions.find((v: any) => v.id === d.approvedVersionId);
          return (
            <div key={d.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><Link to={`/app/documents/${d.id}`} className="font-medium hover:underline">{d.title}</Link>{d.archived && <span className="text-xs text-faint ml-2">Archived</span>}
                  <div className="text-xs text-muted">{d.requirementName ?? 'Ad-hoc document'}{approved?.metadata.expiryDate ? ` · expires ${formatDate(approved.metadata.expiryDate)}` : approved ? ' · no expiry' : ''}</div>
                  {approved && <VerificationLabel value={approved.verification} />}
                </div>
                <Link to={`/app/documents/${d.id}`} className="btn-ghost btn-sm">Details</Link>
              </div>
              <ul className="mt-2 space-y-1">{d.versions.filter((v: any) => v.reviewStatus !== 'uploading').map((v: any) => (
                <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-faint font-mono text-xs w-8">v{v.versionNumber}</span>
                  <button className="hover:underline truncate max-w-[18rem]" onClick={() => openFile(v.id).catch((e) => toast(e.message, 'bad'))} disabled={v.reviewStatus === 'quarantined'}>{v.fileName}</button>
                  <DocStatus value={v.reviewStatus} />
                  <span className="text-xs text-faint">{formatDateTime(v.uploadedAt)} · {v.uploadedBy.name}</span>
                  {v.review?.reason && <span className="text-xs text-muted">“{v.review.reason}”</span>}
                  {['awaiting_review', 'under_review', 'submitted'].includes(v.reviewStatus) && can('documents.review') && <Link to={`/app/reviews/${v.id}`} className="link text-xs">Review</Link>}
                </li>
              ))}</ul>
            </div>
          );
        })}</div>
      )}
      <UploadDialog open={upload} onClose={() => setUpload(false)} subcontractorId={data.subcontractor.id} requirements={data.requirements} />
    </Section>
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
  const projectFocus = params.get('project');
  // Rows = requirement × project, grouped by requirement.
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
  const rank: RequirementStatus[] = ['expired', 'rejected', 'overdue', 'missing', 'requested', 'review_required', 'expiring_soon', 'awaiting_review', 'approved', 'not_applicable'];
  if (rows.length === 0) return <Section><Empty title="No requirements apply yet">Assign this subcontractor to a project with requirements.</Empty></Section>;
  const groups: [string, (r: any) => boolean][] = [
    ['Missing or blocking', (r) => r.perProject.some((x: any) => x.blocking)],
    ['Needs attention', (r) => !r.perProject.some((x: any) => x.blocking) && r.perProject.some((x: any) => ['expiring_soon', 'awaiting_review', 'review_required'].includes(x.status))],
    ['Satisfied', (r) => r.perProject.every((x: any) => ['approved', 'not_applicable'].includes(x.status)) && r.perProject.some((x: any) => x.status === 'approved')],
    ['Optional or not applicable', (r) => r.perProject.every((x: any) => x.status === 'not_applicable' || (!x.mandatory && !['approved'].includes(x.status)))],
  ];
  const placed = new Set<string>();
  return (
    <div className="space-y-4">
      {groups.map(([label, test]) => {
        const items = rows.filter((r) => !placed.has(r.requirementId) && test(r));
        items.forEach((i) => placed.add(i.requirementId));
        if (!items.length) return null;
        return (
          <Section key={label} title={label}>
            <div className="divide-y divide-line">{items.map((r) => {
              const def: any = defs.get(r.requirementId);
              const worst = [...r.perProject].sort((a, b) => rank.indexOf(a.status) - rank.indexOf(b.status))[0];
              const overrides = data.overrides.filter((o: any) => o.requirementId === r.requirementId);
              return (
                <div key={r.requirementId} className={cx('px-4 py-3', projectFocus && r.perProject.some((x: any) => x.projectId === projectFocus) && 'bg-accent/5')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{def?.category}{def?.kind !== 'document' ? ` · ${humanize(def?.kind ?? '')}` : ''}</div></div>
                    <div className="flex flex-wrap gap-2">
                      {def?.kind === 'document' && can('documents.upload') && <button className="btn-ghost btn-sm" onClick={() => setUpload(r.requirementId)}>Upload</button>}
                      {def?.kind === 'document' && can('requests.send') && worst.status !== 'approved' && <button className="btn-ghost btn-sm" onClick={() => onRequest(r.requirementId)}>Request</button>}
                      {def?.kind !== 'document' && can('documents.review') && <button className="btn-secondary btn-sm" onClick={() => setConfirm({ requirementId: r.requirementId, name: r.name, def })}>Record confirmation</button>}
                      {can('requirements.override') && <button className="btn-ghost btn-sm" onClick={() => setNa({ requirementId: r.requirementId, name: r.name, projects: r.perProject })}>Mark not applicable</button>}
                    </div>
                  </div>
                  <table className="w-full mt-2"><tbody>{r.perProject.map((x: any) => (
                    <tr key={x.projectId} className="border-t border-line/50"><td className="py-1.5 pr-3 text-sm w-[28%] text-muted">{x.projectName}{!x.mandatory && ' · optional'}</td><td className="py-1.5 pr-3 w-[18%]"><StatusText value={x.status} /></td><td className="py-1.5 text-sm text-muted">{x.reason}</td></tr>
                  ))}</tbody></table>
                  {overrides.map((o: any) => (
                    <div key={o.id} className="mt-2 text-xs text-muted flex flex-wrap gap-2 items-center"><span>{o.type === 'not_applicable' ? 'Not applicable' : 'Confirmed'} ({o.scope === 'all' ? 'all projects' : data.projects.find((p: any) => p.id === o.scope)?.name ?? 'project'}) by {o.decidedBy.name}, {formatDate(o.decidedAt)}: “{o.reason}”{o.validUntil ? ` · valid until ${formatDate(o.validUntil)}` : ''}</span>
                      {(o.type === 'not_applicable' ? can('requirements.override') : can('documents.review')) && <button className="link" onClick={() => revoke.run({ overrideId: o.id }).then(() => toast('Decision revoked'))}>Revoke</button>}
                    </div>
                  ))}
                </div>
              );
            })}</div>
          </Section>
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
    <Dialog open onClose={onClose} title={type === 'not_applicable' ? `Mark “${state.name}” not applicable` : `Record confirmation: ${state.name}`} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={busy || !reason.trim()} onClick={async () => { await run({ type, subcontractorId, requirementId: state.requirementId, projectId: scope === 'all' ? undefined : scope, reason, validUntil: validUntil || undefined }); toast('Decision recorded'); onClose(); }}>{busy && <Spinner />}Record decision</button>
    </>}>
      <div className="space-y-4">
        <Field label="Applies to"><select className="input" value={scope} onChange={(e) => setScope(e.target.value)}><option value="all">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name} only</option>)}</select></Field>
        <Field label={type === 'not_applicable' ? 'Reason' : 'What was confirmed, and how'} required hint="Recorded with your name in the audit trail and shown wherever this status appears.">
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === 'not_applicable' ? 'e.g. No vehicles are used on this contract' : 'e.g. Signed declaration received by email on 3 March'} />
        </Field>
        {type === 'manual_confirmation' && <Field label="Valid until" hint={state.def?.renewalPeriodDays ? `Defaults to ${state.def.renewalPeriodDays} days from today if left empty.` : 'Optional.'}><input type="date" className="input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>}
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
    <div className="grid xl:grid-cols-[1fr_1fr] gap-6">
      <Section title="Requests and links" description="Each request has its own secure link. Revoking a link cuts off access immediately.">
        {data.requests.length === 0 ? <Empty title="No requests sent" /> : (
          <ul className="divide-y divide-line">{data.requests.map((r: any) => {
            const l = data.links.find((x: any) => x.id === r.linkId);
            const live = l && !l.revokedAt && l.expiresAt > now;
            return (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{r.type === 'portal_access' ? 'Portal invitation' : r.type === 'renewal' ? 'Renewal request' : 'Document request'} → {r.contactEmail}</span><span className="text-muted">{humanize(r.status)}</span></div>
                <div className="text-xs text-muted mt-0.5">{formatDateTime(r.createdAt)} by {r.createdBy.name}{r.dueDate ? ` · due ${formatDate(r.dueDate)}` : ''}{r.acknowledgedAt ? ` · opened ${formatDateTime(r.acknowledgedAt)}` : ''}</div>
                {l && <div className="text-xs mt-1">{l.revokedAt ? <span className="text-bad">Link revoked {formatDateTime(l.revokedAt)}</span> : l.expiresAt < now ? <span className="text-faint">Link expired {formatDate(l.expiresAt)}</span> : <span className="text-ok">Link active until {formatDate(l.expiresAt)}</span>}{l.useCount ? <span className="text-faint"> · opened {l.useCount}×</span> : ''}</div>}
                {can('requests.send') && (
                  <div className="mt-2 flex gap-2">
                    {live && <button className="btn-ghost btn-sm text-bad" onClick={() => revoke.run({ linkId: l.id }).then(() => toast('Link revoked'))}>Revoke link</button>}
                    {['sent', 'acknowledged', 'partially_fulfilled', 'expired'].includes(r.status) && <button className="btn-ghost btn-sm" onClick={() => resend.run({ requestId: r.id }).then(() => toast('Request re-sent with a new link'))}>Re-send</button>}
                  </div>
                )}
              </li>
            );
          })}</ul>
        )}
        <div className="px-4 pb-3"><FormError error={revoke.error || resend.error} /></div>
      </Section>
      <Section title="Activity" description="Submissions, reminders, reviews, approvals and changes">
        {!audit.data ? <Spinner className="m-4" /> : audit.data.items.length === 0 ? <Empty title="No activity yet" /> : (
          <ul className="divide-y divide-line max-h-[640px] overflow-y-auto">{audit.data.items.map((e: any) => (
            <li key={e.id} className="px-4 py-2.5 text-sm"><div><span className="text-muted">{e.actor.name}</span> · {humanize(e.action.replace('.', ' '))}{e.entity.label && <span className="text-muted"> · {e.entity.label}</span>}</div>
              {e.after?.reason && <div className="text-xs text-muted">“{e.after.reason}”</div>}
              {e.action === 'compliance.status_changed' && <div className="text-xs text-muted">{READINESS_LABELS[e.before?.readiness as keyof typeof READINESS_LABELS] ?? 'New'} → {READINESS_LABELS[e.after?.readiness as keyof typeof READINESS_LABELS]}</div>}
              <div className="text-xs text-faint">{formatDateTime(e.at)} · {e.source}</div></li>
          ))}</ul>
        )}
      </Section>
    </div>
  );
}

function NotesTab({ data }: { data: any }) {
  const [text, setText] = useState('');
  const { run, busy, error } = useMutation('subs.addNote');
  return (
    <Section title="Internal notes" description="Visible only to authorised people in your organisation. Never shown to the subcontractor.">
      <div className="p-4 border-b border-line space-y-2">
        <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note" aria-label="New note" />
        <div className="flex justify-end"><button className="btn-primary btn-sm" disabled={busy || !text.trim()} onClick={async () => { await run({ subcontractorId: data.subcontractor.id, text }); setText(''); }}>{busy && <Spinner />}Add note</button></div>
        <FormError error={error} />
      </div>
      {data.notes.length === 0 ? <Empty title="No notes yet" /> : <ul className="divide-y divide-line">{data.notes.map((n: any) => <li key={n.id} className="px-4 py-3"><p className="whitespace-pre-wrap text-sm">{n.text}</p><div className="text-xs text-faint mt-1">{n.by.name} · {formatDateTime(n.at)}</div></li>)}</ul>}
    </Section>
  );
}

export { STATUS_LABELS };
