import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { displayReadiness, readinessReason } from '../../domain/compliance';
import { addDays, formatDate, formatDateTime } from '../../domain/dates';
import { rowNext } from '../../lib/followup';
import { api, dataChanged, useApi, useMutation } from '../../lib/api';
import { exportCsv, exportPdf } from '../../lib/export';
import { useSession } from '../../lib/session';
import { Callout, Checkbox, Confirm, cx, Dialog, DocStatus, Drawer, Empty, ErrorState, Field, FormError, Glyph, HelpTip, humanize, Icon, KeyValue, Menu, MoreButton, newRowKey, PageHeader, PageLoading, ReadinessBadge, ReadinessBar, SampleTag, SearchInput, Skeleton, Spinner, StatusText, Tabs, Toolbar, useToast, RowLink, rowClick } from '../../ui';
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
    [n((r) => r.mandatory && MISSING.includes(r.status)), 'not requested'],
    [n((r) => r.mandatory && REQUESTED.includes(r.status)), 'requested'],
    [n((r) => r.status === 'expired'), 'expired'],
    [n((r) => r.status === 'rejected'), 'changes needed'],
    [n((r) => REVIEW.includes(r.status)), 'to review'],
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
  const { can, me } = useSession();
  const { data, error, loading, reload } = useApi<any>('projects.get', { projectId: id });
  const [edit, setEdit] = useState(false);
  const [assign, setAssign] = useState(false);
  const [requesting, setRequesting] = useState<{ ids?: string[] } | null>(null);
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
  const step = archived ? -1 : projectSteps(data).current;
  const report = async () => {
    setExporting(true);
    try {
      const r = await api('reports.run', { type: 'project_readiness', filters: { projectId: p.id } });
      await exportPdf({
        ...r, title: 'Project readiness report', subtitle: p.name,
        context: [['Reference', p.code || '—'], ['Location', p.location || '—'], ['Project manager', p.managerName || '—'], ['Status', humanize(p.status)]],
        summary: [['Assigned', c.total], ['Ready', c.ready], ['Action required', c.action], ['Not ready', c.notReady], ['Documents to review', c.awaitingReview]],
      });
    } catch (e: any) { toast(e.message, 'bad'); } finally { setExporting(false); }
  };
  const chip = (f: Focus, label: string, n: number) => (
    <button type="button" onClick={() => setParams(f === 'all' || (focus === f && tab === 'readiness') ? {} : { show: f })} aria-pressed={focus === f}
      className={cx('inline-flex items-baseline gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors', focus === f ? 'bg-accent-tint text-accent-ink font-medium' : 'text-muted hover:bg-raised hover:text-ink', n === 0 && focus !== f && 'opacity-60')}>
      <span className="tnum font-medium text-ink">{n}</span>{label}
    </button>
  );
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Projects', to: '/app/projects' }, { label: p.name }]}
        title={<>{p.name} {p.sample && <SampleTag />}</>}
        meta={<>{p.code && <span>{p.code}</span>}{p.location && <span>{p.location}</span>}<span>{p.managerName ? `Managed by ${p.managerName}` : 'No project manager'}</span><span>{humanize(p.status)}</span>{p.startDate && <span>{formatDate(p.startDate)} – {formatDate(p.endDate)}</span>}</>}
        actions={<>
          {/* The next-step panel carries the main action; the header only offers what it doesn't. */}
          {!archived && can('projects.edit') && step !== 1 && <button className="btn-secondary" onClick={() => setAssign(true)}>{Icon.plus()}Add subcontractors</button>}
          <Menu trigger={(t) => <MoreButton label="More project actions" {...t} />} items={[
            { label: exporting ? 'Preparing report…' : 'Export readiness report (PDF)', onClick: report },
            !archived && can('requests.send') && c.total > 0 && step !== 2 && step !== 4 && { label: 'Request paperwork from everyone', onClick: () => setRequesting({}) },
            !archived && can('projects.edit') && { label: 'Edit project details', onClick: () => setEdit(true) },
            can('requirements.manage') && { label: 'Change required paperwork', onClick: () => setTab('requirements') },
            can('projects.archive') && { label: archived ? 'Restore project' : 'Archive project', onClick: () => setArchive(true), danger: !archived },
          ]} />
        </>} />
      {archived && <div className="mb-8"><Callout title="Archived">Readiness is frozen as it was when the project was archived, and reminders stop for documents only this project needs.</Callout></div>}
      {!archived && <NextStep data={data} onAdd={() => setAssign(true)} onRequest={() => setRequesting({})} goTo={setTab} />}
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
      <AddSubsDrawer open={assign} onClose={() => setAssign(false)} projectId={p.id} available={data.available} directoryEmpty={data.available.length === 0 && data.subcontractors.length === 0} canSendNow={can('requests.send') && data.requirements.length > 0} onAdded={(ids, sent) => { setAssign(false); if (!sent && can('requests.send') && data.requirements.length > 0) setRequesting({ ids }); }} />
      <RequestPaperworkDialog open={!!requesting} onClose={() => setRequesting(null)} data={data} preselect={requesting?.ids} />
      <Confirm open={archive} onClose={() => setArchive(false)} title={archived ? 'Restore this project?' : 'Archive this project?'} confirmLabel={archived ? 'Restore' : 'Archive'} danger={!archived} busy={archiveM.busy}
        onConfirm={async () => { await archiveM.run({ projectId: p.id, archived: !archived }); setArchive(false); toast(archived ? 'Project restored' : 'Project archived'); }}>
        {archived ? 'Readiness is recalculated and reminders resume.' : 'Readiness records are kept exactly as they are now and reminders stop for documents only this project needs. You can restore it later.'}
      </Confirm>
    </div>
  );
}

const NEEDS_REQUEST = ['missing', 'not_requested'];

function projectSteps(data: any) {
  const subs = data.subcontractors;
  const docReq = new Set(data.requirements.filter((r: any) => r.definition?.kind === 'document').map((r: any) => r.requirementId));
  const toRequest = subs.filter((s: any) => s.results.some((r: any) => docReq.has(r.requirementId) && NEEDS_REQUEST.includes(r.status)));
  const reviewItems = subs.flatMap((s: any) => s.results.filter((r: any) => REVIEW.includes(r.status) && r.versionId));
  const waiting = subs.filter((s: any) => s.readiness !== 'ready' && s.results.some((r: any) => ['requested', 'overdue'].includes(r.status)));
  const allReady = subs.length > 0 && subs.every((s: any) => s.readiness === 'ready');
  const steps = [
    { label: 'Choose paperwork', done: data.requirements.length > 0 },
    { label: 'Add subcontractors', done: subs.length > 0 },
    { label: 'Request paperwork', done: subs.length > 0 && toRequest.length === 0 },
    { label: 'Review submissions', done: subs.length > 0 && toRequest.length === 0 && reviewItems.length === 0 },
    { label: 'Ready to work', done: allReady },
  ];
  return { steps, current: steps.findIndex((x) => !x.done), toRequest, reviewItems, waiting };
}

/** The project's workflow, made explicit: what's done and the one thing to do next. */
function NextStep({ data, onAdd, onRequest, goTo }: { data: any; onAdd: () => void; onRequest: () => void; goTo: (t: Tab) => void }) {
  const { can } = useSession();
  const { steps, current, toRequest, reviewItems, waiting } = projectSteps(data);
  let title: string; let body: string; let action: React.ReactNode = null;
  if (current === -1) return <p className="mb-6 flex items-center gap-2 text-success"><Glyph tone="ok" />Everyone on this project is ready to work.</p>;
  if (current === 0) { title = 'Choose the paperwork this project needs'; body = 'Start from a template for the type of work — you can add or remove items afterwards.'; action = can('requirements.manage') && <button className="btn-primary" onClick={() => goTo('requirements')}>Choose paperwork</button>; }
  else if (current === 1) { title = 'Add the subcontractors working on this project'; body = 'Pick companies you already work with or add new ones with a contact email.'; action = can('projects.edit') && <button className="btn-primary" onClick={onAdd}>{Icon.plus()}Add subcontractors</button>; }
  else if (current === 2) { title = `Request paperwork from ${toRequest.length} subcontractor${toRequest.length === 1 ? '' : 's'}`; body = 'Each contact gets a secure link listing exactly what to upload. No account needed.'; action = can('requests.send') && <button className="btn-primary" onClick={onRequest}>Request paperwork</button>; }
  else if (current === 3) { title = `${reviewItems.length} document${reviewItems.length === 1 ? ' needs' : 's need'} your review`; body = 'Approve them, or explain what needs changing — the subcontractor is told either way.'; action = can('documents.review') && <Link className="btn-primary" to={`/app/reviews/${reviewItems[0].versionId}`}>Review documents</Link>; }
  else { title = waiting.length ? `Waiting for ${waiting.length} subcontractor${waiting.length === 1 ? '' : 's'} to send documents` : 'Some subcontractors still have items to resolve'; body = waiting.length ? 'Reminders go out automatically. You can also send one now.' : 'Open a subcontractor below to see what is outstanding.'; action = waiting.length > 0 && can('requests.send') && <button className="btn-secondary" onClick={onRequest}>Send a reminder</button>; }
  return (
    <section aria-label="Next step" className="mb-6 rounded-md border border-line bg-paper px-5 py-4">
      <ol className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">{steps.map((x, i) => (
        <li key={x.label} className={cx('flex items-center gap-1.5', i === current ? 'text-accent-ink font-medium' : x.done ? 'text-muted' : 'text-faint')} aria-current={i === current ? 'step' : undefined}>
          {x.done ? <Glyph tone="ok" className="w-3.5 h-3.5" /> : <span className={cx('inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[0.55rem]', i === current ? 'border-accent' : 'border-line-strong')}>{i + 1}</span>}{x.label}
        </li>
      ))}</ol>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-md font-semibold">{title}</h2><p className="text-sm text-muted mt-0.5">{body}</p></div>
        {action}
      </div>
    </section>
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
  if (data.requirements.length === 0) return <Empty title="No paperwork chosen yet">Once the project says what each subcontractor must provide, this is where you'll see who is ready.</Empty>;
  if (data.subcontractors.length === 0) return <Empty title="No subcontractors on this project yet">Once you add them, this list shows who is ready to work and exactly what each of the others still needs.</Empty>;
  const flat = rows.map((s: any) => ({ ...s, contactText: s.contact ? `${s.contact.name} <${s.contact.email}>` : '', issues: issueSummary(s.results).join('; '), readinessText: humanize(s.readiness), last: formatDate(s.lastActivityAt) }));
  const needs = rows.filter((s: any) => s.readiness !== 'ready');
  const ready = rows.filter((s: any) => s.readiness === 'ready');
  const docReqIds = new Set<string>(data.requirements.filter((r: any) => r.definition?.kind === 'document').map((r: any) => r.requirementId));
  const row = (s: any) => {
    const issues = issueSummary(s.results);
    const counted = s.results.filter((r: any) => r.mandatory && r.status !== 'not_applicable');
    const approved = counted.filter((r: any) => ['approved', 'expiring_soon'].includes(r.status)).length;
    const isOpen = !!open[s.id];
    // Documents the subcontractor must send vs checks your team makes: never ask them for a check.
    const nx = rowNext(s, docReqIds, { review: can('documents.review'), send: can('requests.send') });
    const checksOut = s.results.filter((r: any) => r.mandatory && !docReqIds.has(r.requirementId) && [...MISSING, ...REQUESTED, 'expired', 'expiring_soon'].includes(r.status));
    const docsOpen = s.results.filter((r: any) => docReqIds.has(r.requirementId) && [...MISSING, ...REQUESTED, 'expired', 'rejected', 'expiring_soon'].includes(r.status));
    const checkLink = (rid: string) => `/app/subcontractors/${s.id}?tab=requirements&project=${data.project.id}&check=${rid}`;
    // Exactly one next step per row; anything manual lives in the row menu.
    const next = nx.kind === 'review' ? <Link to={`/app/reviews/${nx.versionId}`} className="btn-secondary btn-sm">Review document</Link>
      : nx.kind === 'request' ? <button className="btn-secondary btn-sm" onClick={() => setRequest({ sub: s.id, reqs: nx.requirementIds })}>{nx.label}</button>
      : nx.kind === 'check' ? <Link to={checkLink(nx.requirementId)} className="btn-secondary btn-sm" title={nx.names.join(', ')}>Record check</Link>
      : nx.kind === 'ready' ? <span className="text-sm text-success inline-flex items-center gap-1.5"><Glyph tone="ok" className="w-3.5 h-3.5" />Ready</span>
      : <span className="text-sm text-muted text-right" title={nx.detail}>{nx.text}</span>;
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
          <div className="col-start-2 md:col-start-auto text-sm min-w-0"><div className="tnum"><span className="font-medium">{approved} of {counted.length}</span> <span className="text-muted">approved</span></div><div className="text-faint truncate">{issues.length ? issues.join(' · ') : 'Nothing outstanding'}</div></div>
          <div className="col-start-2 md:col-start-auto"><ReadinessBadge value={s.readiness} results={s.results} size="sm" /></div>
          <div className="col-start-2 sm:hidden">{next}</div>
          <div className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto flex items-center justify-end gap-2">
            <span className="hidden sm:inline-flex">{next}</span>
            <Menu trigger={(t) => <MoreButton label={`Actions for ${s.legalName}`} {...t} />} items={[
              can('requests.send') && docsOpen.length > 0 && { label: docsOpen.some((r: any) => REQUESTED.includes(r.status)) ? 'Send a reminder now' : docsOpen.every((r: any) => r.status === 'expiring_soon') ? 'Request renewal now' : 'Request documents', onClick: () => setRequest({ sub: s.id, reqs: docsOpen.map((r: any) => r.requirementId) }) },
              can('documents.review') && checksOut.length > 0 && nx.kind !== 'check' && { label: 'Record check', onClick: () => nav(checkLink(checksOut[0].requirementId)) },
              { label: isOpen ? 'Hide requirements' : 'Show requirements', onClick: () => setOpen({ ...open, [s.id]: !isOpen }) },
              { label: 'Open subcontractor profile', onClick: () => nav(`/app/subcontractors/${s.id}?project=${data.project.id}`) },
              editable && { label: 'Remove from project', onClick: () => setRemove(s), danger: true },
            ]} />
          </div>
        </div>
        {isOpen && (
          <div id={`req-${s.id}`} className="pb-5 md:pl-10">
            <p className="text-sm mb-3"><span className="font-medium">Why: </span><span className="text-muted">{readinessReason(s.results, displayReadiness(s.readiness, s.results))}</span></p>
            <ul className="rounded-md border border-line bg-paper divide-y divide-line">
              {[...s.results].sort((a: any, b: any) => Number(b.blocking) - Number(a.blocking)).map((r: any) => {
                const act = REVIEW.includes(r.status) && r.versionId && can('documents.review') ? <Link className="btn-quiet" to={`/app/reviews/${r.versionId}`}>Review</Link>
                  : !docReqIds.has(r.requirementId) && [...MISSING, ...REQUESTED, 'expired', 'expiring_soon'].includes(r.status) && can('documents.review') ? <Link className="btn-quiet" to={`/app/subcontractors/${s.id}?tab=requirements&project=${data.project.id}&check=${r.requirementId}`}>Record check</Link>
                  : [...MISSING, ...REQUESTED, 'expired', 'rejected', 'expiring_soon'].includes(r.status) && docReqIds.has(r.requirementId) && can('requests.send') ? <button className="btn-quiet" onClick={() => setRequest({ sub: s.id, reqs: [r.requirementId] })}>{r.status === 'expiring_soon' || r.status === 'expired' ? 'Request renewal' : r.status === 'rejected' ? 'Request replacement' : REQUESTED.includes(r.status) ? 'Send again' : 'Request'}</button>
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
          {needs.length > 0 && <section><h2 className="text-md font-semibold flex items-center gap-2">Needs action <span className="text-muted font-normal tnum">{needs.length}</span></h2><div className="mt-3"><div className="hidden md:grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_9rem_13rem] gap-x-4 pb-2 text-xs font-medium text-muted" aria-hidden><span className="w-7" /><span>Subcontractor</span><span>Paperwork</span><span>Status</span><span className="text-right pr-10">Next action</span></div></div><ul className="border-t border-line-strong">{needs.map(row)}</ul></section>}
          {ready.length > 0 && <section><h2 className="text-md font-semibold flex items-center gap-2">Ready to work <span className="text-muted font-normal tnum">{ready.length}</span></h2><div className="mt-3"><div className="hidden md:grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_9rem_13rem] gap-x-4 pb-2 text-xs font-medium text-muted" aria-hidden><span className="w-7" /><span>Subcontractor</span><span>Paperwork</span><span>Status</span><span className="text-right pr-10">Next action</span></div></div><ul className="border-t border-line-strong">{ready.map(row)}</ul></section>}
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
                <div className={cx('text-xs mt-1', r.source.type === 'template' ? 'text-faint' : 'text-accent-ink')}>{source(r)}</div>
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
  if (loading && !data) return <Skeleton rows={3} />;
  if (error) return <ErrorState error={error} />;
  if (!data.items.length) return <Empty title="No documents yet">Documents from subcontractors on this project appear here once submitted.</Empty>;
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="table min-w-[760px]">
        <thead><tr><th className="th">Document</th><th className="th">Subcontractor</th><th className="th">Expiry</th><th className="th">Status</th><th className="th">Version</th></tr></thead>
        <tbody>{data.items.map((d: any) => (
          <tr key={d.id} className="tr-link" onClick={rowClick(() => nav(`/app/documents/${d.id}`))}>
            <td className="td"><div><RowLink to={`/app/documents/${d.id}`}>{d.title}<span className="sr-only"> for {d.subcontractor}</span></RowLink></div><div className="text-sm text-faint">{d.category}</div></td>
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
  if (loading && !data) return <Skeleton rows={3} />;
  if (error) return <ErrorState error={error} />;
  if (!data.items.length) return <Empty title="No activity yet" />;
  return (
    <ol className="max-w-3xl border-t border-line-strong">{data.items.map((e: any) => (
      <li key={e.id} className="py-3.5 border-b border-line"><div>{activityLine(e)}</div><div className="text-xs text-faint mt-1">{formatDateTime(e.at)} · {humanize(e.source)}</div></li>
    ))}</ol>
  );
}

type NewSub = { k: string; legalName: string; trade: string; name: string; email: string };
const blankSub = (): NewSub => ({ k: newRowKey(), legalName: '', trade: '', name: '', email: '' });

/** Add existing directory companies and brand-new ones in one place, then assign them all. */
function AddSubsDrawer({ open, onClose, projectId, available, onAdded, canSendNow, directoryEmpty }: { directoryEmpty?: boolean; open: boolean; onClose: () => void; projectId: string; available: any[]; onAdded: (ids: string[], sent: boolean) => void; canSendNow: boolean }) {
  const { can } = useSession();
  const [sendNow, setSendNow] = useState(true);
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [fresh, setFresh] = useState<NewSub[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const list = available.filter((s) => `${s.legalName} ${s.trade}`.toLowerCase().includes(q.toLowerCase()));
  const filled = fresh.filter((f) => f.legalName.trim());
  const incomplete = filled.find((f) => !f.trade.trim() || !f.name.trim() || !/^\S+@\S+\.\S+$/.test(f.email.trim()));
  const total = sel.length + filled.length;
  const close = () => { setSel([]); setFresh([]); setQ(''); setError(null); onClose(); };
  const [dup, setDup] = useState<{ k: string; existingId: string; existingName: string; code: string } | null>(null);
  // A company that may already be in the directory: say which, and let the person choose.
  const save = async (allowKeys: string[] = []) => {
    setBusy(true); setError(null); setDup(null);
    const ids = [...sel];
    const created: string[] = [];
    try {
      for (const f of filled) {
        try {
          const r = await api('subs.create', { legalName: f.legalName.trim(), trade: f.trade.trim(), contacts: [{ name: f.name.trim(), email: f.email.trim(), primary: true }], allowSimilarName: allowKeys.includes(f.k) });
          ids.push(r.subcontractorId); created.push(f.k);
        } catch (e: any) {
          if (['possible_duplicate', 'duplicate_name', 'duplicate_registration'].includes(e?.code) && e.data?.existingId) {
            // Rows already created stay created; keep them out of the form so a retry doesn't repeat them.
            setFresh((rows) => rows.filter((x) => !created.includes(x.k))); setSel(ids);
            setDup({ k: f.k, ...e.data, code: e.code }); setError(e.message); return;
          }
          throw e;
        }
      }
      // Assigning sends the outstanding requests itself (one step); nothing already approved is asked for again.
      const r = await api<any>('projects.assign', { projectId, subcontractorIds: ids, sendRequests: canSendNow && sendNow });
      let sent = false;
      if (canSendNow && sendNow) {
        const ok = r.requests.filter((x: any) => x.status === 'sent').length;
        const missed = r.results.filter((x: any) => x.status !== 'sent' && x.detail !== 'Nothing outstanding to request');
        toast(`${ids.length} added · ${ok} request${ok === 1 ? '' : 's'} sent${missed.length ? ` · ${missed.length} not sent (${missed[0].detail})` : ''}`, missed.length ? 'info' : undefined);
        sent = true;
      } else toast(`${ids.length} subcontractor${ids.length === 1 ? '' : 's'} added to the project`);
      dataChanged();
      setSel([]); setFresh([]); setQ('');
      onAdded(ids, sent);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Drawer open={open} onClose={close} title="Add subcontractors to this project" description="Choose companies you already work with, or add new ones. SubCleared works out what each one still needs to provide."
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-3">{canSendNow ? <Checkbox checked={sendNow} onChange={setSendNow} label="Send paperwork requests now" hint="Each contact gets a secure link; reminders follow automatically." /> : <span />}<div className="flex gap-2"><button className="btn-secondary" onClick={close}>Cancel</button><button className="btn-primary" disabled={!total || !!incomplete || busy} onClick={() => save()}>{busy && <Spinner />}{canSendNow && sendNow ? `Add ${total || ''} and send requests` : `Add ${total || ''} to project`}</button></div></div>}>
      <div className="space-y-8">
        <section>
          <h3 className="text-md font-semibold">From your directory</h3>
          {available.length === 0 ? <p className="text-sm text-muted mt-2">{directoryEmpty ? 'No subcontractors in your directory yet. Add your first subcontractor below.' : 'Everyone in your directory is already on this project.'}</p> : <>
            {available.length > 6 && <SearchInput value={q} onChange={setQ} placeholder="Search by company or trade" className="mt-3" />}
            <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-line border-y border-line">{list.map((s) => <div key={s.id} className="py-2.5"><Checkbox checked={sel.includes(s.id)} onChange={(v) => setSel(v ? [...sel, s.id] : sel.filter((x) => x !== s.id))} label={s.legalName} hint={s.trade} /></div>)}{list.length === 0 && <p className="py-3 text-sm text-muted">No matches.</p>}</div>
          </>}
        </section>
        {can('subs.manage') && (
          <section>
            <h3 className="text-md font-semibold">New subcontractors</h3>
            <p className="text-sm text-muted mt-1">The contact receives the document requests. You can add more contacts later.</p>
            <div className="mt-4 space-y-5">
              {fresh.map((f, i) => {
                const set = (k: keyof NewSub, v: string) => setFresh(fresh.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
                return (
                  <fieldset key={f.k} className="rounded-md border border-line bg-canvas p-4">
                    <legend className="sr-only">New subcontractor {i + 1}</legend>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <Field label="Company name"><input className="input" value={f.legalName} onChange={(e) => set('legalName', e.target.value)} autoFocus={i === fresh.length - 1} /></Field>
                      <Field label="Trade"><input className="input" value={f.trade} onChange={(e) => set('trade', e.target.value)} placeholder="e.g. Electrical" /></Field>
                      <Field label="Contact name"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
                      <Field label="Contact email"><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
                    </div>
                    <button type="button" className="btn-ghost btn-sm mt-3 -ml-3" onClick={() => setFresh(fresh.filter((_, j) => j !== i))}>Remove</button>
                  </fieldset>
                );
              })}
              <button type="button" className="btn-secondary" onClick={() => setFresh([...fresh, blankSub()])}>{Icon.plus()}{fresh.length ? 'Add another' : 'Add a new subcontractor'}</button>
            </div>
            {incomplete && <p className="hint text-ink">Fill in the trade, contact name and a valid email for {incomplete.legalName}.</p>}
          </section>
        )}
        {dup ? (
          <Callout tone="warn" title={dup.code === 'possible_duplicate' ? 'Possibly already in your directory' : 'Already in your directory'}>
            {error}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-secondary btn-sm" disabled={busy} onClick={() => { setSel((s) => [...new Set([...s, dup.existingId])]); setFresh((rows) => rows.filter((x) => x.k !== dup.k)); setDup(null); setError(null); }}>Use {dup.existingName}</button>
              {dup.code === 'possible_duplicate' && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => save([dup.k])}>It’s a different company — add it</button>}
            </div>
          </Callout>
        ) : <FormError error={error} />}
      </div>
    </Drawer>
  );
}

const REQUESTABLE = ['missing', 'not_requested', 'requested', 'overdue', 'rejected', 'expired', 'expiring_soon'];

/** Request every outstanding document from the chosen subcontractors in one step. */
function RequestPaperworkDialog({ open, onClose, data, preselect }: { open: boolean; onClose: () => void; data: any; preselect?: string[] }) {
  const docReq = new Set(data.requirements.filter((r: any) => r.definition?.kind === 'document').map((r: any) => r.requirementId));
  const rows = data.subcontractors.map((s: any) => {
    const items = s.results.filter((r: any) => docReq.has(r.requirementId) && REQUESTABLE.includes(r.status));
    return { ...s, items, waiting: items.filter((r: any) => ['requested', 'overdue'].includes(r.status)).length };
  });
  const eligible = rows.filter((s: any) => s.items.length && s.contact && s.status !== 'suspended');
  const [sel, setSel] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<any[] | null>(null);
  const { run, busy, error } = useMutation('requests.forProject');
  useEffect(() => {
    if (!open) { setResult(null); return; }
    const pre = (preselect?.length ? preselect : eligible.filter((s: any) => s.items.length > s.waiting).map((s: any) => s.id)).filter((id: string) => eligible.some((e: any) => e.id === id));
    setSel(pre.length ? pre : eligible.map((s: any) => s.id));
    setDue(addDays(new Date().toISOString().slice(0, 10), 14));
  }, [open, eligible.map((e: any) => e.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onClose={onClose} width="max-w-2xl" title="Request paperwork" description={`Each contact gets a secure link to upload everything still needed for ${data.project.name}. No account needed.`}
      footer={result ? <button className="btn-primary" onClick={onClose}>Done</button> : <>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!sel.length || busy} onClick={async () => { try { const r = await run({ projectId: data.project.id, subcontractorIds: sel, dueDate: due || undefined, message: message || undefined }); setResult(r.results); } catch { /* shown */ } }}>{busy && <Spinner />}Send {sel.length ? `${sel.length} request${sel.length === 1 ? '' : 's'}` : 'requests'}</button>
      </>}>
      {result ? (
        <ul className="divide-y divide-line border-y border-line">{result.map((r) => (
          <li key={r.subcontractorId} className="py-3 flex items-start justify-between gap-4"><div><div className="font-medium">{r.name}</div><div className="text-sm text-muted">{r.detail}</div></div>
            <span className={cx('inline-flex items-center gap-1.5 text-sm whitespace-nowrap', r.status === 'sent' ? 'text-success' : r.status === 'failed' ? 'text-danger font-medium' : 'text-muted')}><Glyph tone={r.status === 'sent' ? 'ok' : r.status === 'failed' ? 'blocked' : 'na'} className="w-3.5 h-3.5" />{r.status === 'sent' ? `${r.documents} document${r.documents === 1 ? '' : 's'} requested` : r.status === 'failed' ? 'Not sent' : 'Skipped'}</span></li>
        ))}</ul>
      ) : eligible.length === 0 ? (
        <Empty title="Nothing to request">Everyone on this project has either sent what's needed or has no contact email. Add a contact on the subcontractor's profile to send them requests.</Empty>
      ) : (
        <div className="space-y-6">
          <fieldset><legend className="label">Send to</legend>
            <ul className="divide-y divide-line border-y border-line">{eligible.map((s: any) => (
              <li key={s.id} className="py-2.5"><Checkbox checked={sel.includes(s.id)} onChange={(v) => setSel(v ? [...sel, s.id] : sel.filter((x) => x !== s.id))}
                label={<>{s.legalName} <span className="text-muted">· {s.contact.name}</span></>}
                hint={`${s.items.length} document${s.items.length === 1 ? '' : 's'}: ${s.items.slice(0, 4).map((r: any) => r.requirementName).join(', ')}${s.items.length > 4 ? ` and ${s.items.length - 4} more` : ''}${s.waiting ? ` · ${s.waiting} already requested — this sends a reminder` : ''}`} /></li>
            ))}</ul>
            {rows.some((s: any) => s.items.length && !s.contact) && <p className="hint">Subcontractors without a contact email aren't listed. Add one on their profile.</p>}
          </fieldset>
          <div className="grid sm:grid-cols-[12rem_1fr] gap-4">
            <Field label="Please send by" optional><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label="Note to include" optional><input className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. We start on site on the 3rd" /></Field>
          </div>
          <FormError error={error} />
        </div>
      )}
    </Dialog>
  );
}
