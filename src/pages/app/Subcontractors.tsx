import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatDate } from '../../domain/dates';
import { CSV_TEMPLATE } from '../../domain/importCsv';
import { SUB_TYPES } from '../../domain/library';
import { api, dataChanged, useApi, useMutation } from '../../lib/api';
import { exportCsv } from '../../lib/export';
import { useSession } from '../../lib/session';
import {
  Callout, Checkbox, cx, Dialog, Drawer, Empty, ErrorState, Field, FilterSelect, FormError, Glyph, humanize, PageHeader, Pagination, ReadinessBadge, SampleTag,
  SearchInput, Skeleton, SortHeader, sortRows, Spinner, toneText, Toolbar, usePaged, useToast, newRowKey, withoutRowKey } from '../../ui';

const READINESS_FILTERS = [{ value: 'attention', label: 'Requiring attention' }, { value: 'not_ready', label: 'Not ready' }, { value: 'action_required', label: 'Action required' }, { value: 'ready', label: 'Ready' }, { value: 'not_evaluated', label: 'Not assessed yet' }];

export default function Subcontractors() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useApi<any>('subs.list');
  const projects = useApi<any>('projects.list');
  const [q, setQ] = useState('');
  const readiness = params.get('readiness') ?? '';
  const [status, setStatus] = useState('');
  const [trade, setTrade] = useState('');
  const [issue, setIssue] = useState(params.get('issue') ?? '');
  const [project, setProject] = useState(params.get('project') ?? '');
  const [sort, setSort] = useState<[string, 1 | -1]>(['legalName', 1]);
  const [open, setOpen] = useState(params.get('new') === '1');
  const [importing, setImporting] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [bulkAssign, setBulkAssign] = useState(false);
  const nav = useNavigate();
  const setReadiness = (v: string) => { const p = new URLSearchParams(params); if (v) p.set('readiness', v); else p.delete('readiness'); setParams(p); };
  const rows = useMemo(() => sortRows((data?.items ?? []).filter((s: any) =>
    (!readiness || (readiness === 'attention' ? ['not_ready', 'action_required'].includes(s.readiness) : s.readiness === readiness)) &&
    (status ? s.status === status : s.status !== 'archived') && (!trade || s.trade === trade) && (!project || s.projectIds?.includes(project)) && (!issue || (issue === 'outstanding' ? (s.issues?.missing ?? 0) + (s.issues?.requested ?? 0) + (s.issues?.rejected ?? 0) > 0 : s.issues?.[issue] > 0)) &&
    `${s.legalName} ${s.tradingName ?? ''} ${s.trade} ${s.contact?.email ?? ''} ${s.contact?.name ?? ''} ${s.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())), sort), [data, q, readiness, status, trade, issue, project, sort]);
  const paged = usePaged(rows, 25);
  useEffect(() => setSel([]), [readiness, status, trade, issue, project, q]);
  const trades = [...new Set((data?.items ?? []).map((s: any) => s.trade))].sort() as string[];
  const allOnPage = paged.slice.length > 0 && paged.slice.every((s: any) => sel.includes(s.id));
  const cols = [{ key: 'legalName', label: 'Subcontractor' }, { key: 'trade', label: 'Trade' }, { key: 'status', label: 'Status' }, { key: 'readiness', label: 'Readiness' }, { key: 'projects', label: 'Projects' }, { key: 'outstanding', label: 'Outstanding items' }, { key: 'contactName', label: 'Contact' }, { key: 'contactEmail', label: 'Email' }];
  const flat = (list: any[]) => list.map((r) => ({ ...r, contactName: r.contact?.name, contactEmail: r.contact?.email, readiness: humanize(r.readiness), outstanding: subIssues(r).join('; ') }));
  return (
    <div>
      <PageHeader title="Subcontractors" description="One record per company, shared across every project. Readiness is always worked out per project — open a company to see where it is and isn't ready."
        actions={<>
          {can('subs.manage') && <button className="btn-secondary" onClick={() => setImporting(true)}>Import CSV</button>}
          {can('subs.manage') && <button className="btn-primary" onClick={() => setOpen(true)}>Add subcontractor</button>}
        </>} />
      <Toolbar right={sel.length > 0 ? (
        <div className="flex items-center gap-2 text-sm"><span className="text-muted tnum">{sel.length} selected</span>
          {can('projects.edit') && <button className="btn-secondary btn-sm" onClick={() => setBulkAssign(true)}>Assign to project</button>}
          <button className="btn-secondary btn-sm" onClick={() => exportCsv('Subcontractors (selected)', cols, flat(rows.filter((r: any) => sel.includes(r.id))))}>Export selected</button>
          <button className="btn-ghost btn-sm" onClick={() => setSel([])}>Clear</button>
        </div>
      ) : <button className="btn-secondary btn-sm" disabled={!rows.length} onClick={() => exportCsv('Subcontractors', cols, flat(rows))}>Export CSV</button>}>
        <SearchInput value={q} onChange={setQ} placeholder="Search company, trade or contact" className="w-full sm:w-72" />
        <FilterSelect label="Readiness" value={readiness} onChange={setReadiness} options={READINESS_FILTERS} />
        <FilterSelect label="Status" all="Current" value={status} onChange={setStatus} options={['onboarding', 'active', 'attention', 'suspended', 'archived'].map((s) => ({ value: s, label: s === 'attention' ? 'Attention required' : humanize(s) }))} />
 {(projects.data?.items ?? []).length > 1 && <FilterSelect label="Project" value={project} onChange={setProject} options={(projects.data?.items ?? []).filter((p: any) => p.status !== 'archived').map((p: any) => ({ value: p.id, label: p.name }))} />}
        <FilterSelect label="Paperwork" value={issue} onChange={setIssue} options={[{ value: 'outstanding', label: 'Anything outstanding' }, { value: 'missing', label: 'Not requested' }, { value: 'requested', label: 'Requested, not received' }, { value: 'expired', label: 'Expired' }, { value: 'rejected', label: 'Changes needed' }, { value: 'review', label: 'Needs review' }, { value: 'expiring', label: 'Expiring soon' }]} />
      </Toolbar>
      {loading && !data ? <Skeleton /> : error ? <ErrorState error={error} onRetry={reload} /> : rows.length === 0 ? (
        <Empty title={data.items.length ? 'No subcontractors match' : 'No subcontractors yet'} action={!data.items.length && can('subs.manage') ? <><button className="btn-primary" onClick={() => setOpen(true)}>Add subcontractor</button><button className="btn-secondary" onClick={() => setImporting(true)}>Import CSV</button></> : undefined}>
          {data.items.length ? 'Try a different search or filter.' : 'Add the companies you work with. Each is one record, however many projects they join.'}
        </Empty>
      ) : (
        <>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="table min-w-[1000px]">
              <thead><tr>
                <th className="th w-10"><Checkbox checked={allOnPage} onChange={(v) => setSel(v ? [...new Set([...sel, ...paged.slice.map((s: any) => s.id)])] : sel.filter((id) => !paged.slice.some((s: any) => s.id === id)))} label={<span className="sr-only">Select all on page</span>} /></th>
                <SortHeader label="Subcontractor" k="legalName" sort={sort} setSort={setSort} /><th className="th">Primary contact</th>
                <SortHeader label="Project readiness" k="readiness" sort={sort} setSort={setSort} />
                <SortHeader label="Paperwork" k="outstanding" sort={sort} setSort={setSort} /><SortHeader label="Status" k="status" sort={sort} setSort={setSort} />
                <SortHeader label="Last activity" k="lastActivityAt" sort={sort} setSort={setSort} />
              </tr></thead>
              <tbody>{paged.slice.map((s: any) => (
                <tr key={s.id} className={cx('tr-link', sel.includes(s.id) && 'bg-raised/60')} onClick={() => nav(`/app/subcontractors/${s.id}`)}>
                  <td className="td" onClick={(e) => e.stopPropagation()}><Checkbox checked={sel.includes(s.id)} onChange={(v) => setSel(v ? [...sel, s.id] : sel.filter((x) => x !== s.id))} label={<span className="sr-only">Select {s.legalName}</span>} /></td>
                  <td className="td"><div className="font-medium">{s.legalName}</div><div className="text-sm text-faint">{[s.trade, s.tradingName && `t/a ${s.tradingName}`].filter(Boolean).join(' · ')}{s.tags.includes('Sample') && <> <SampleTag /></>}</div></td>
                  <td className="td">{s.contact ? <><div>{s.contact.name}</div><div className="text-sm text-faint truncate max-w-[15rem]" title={s.contact.email}>{s.contact.email}</div></> : <span className="text-faint">No contact</span>}</td>
                  <td className="td"><ProjectReadiness s={s} /></td>
                  <td className="td text-sm">{s.projects === 0 ? <span className="text-faint">—</span> : subIssues(s).length ? subIssues(s).join(' · ') : <span className="text-success">All approved</span>}</td>
                  <td className="td text-sm">{s.status === 'attention' ? 'Attention required' : humanize(s.status)}</td>
                  <td className="td text-muted whitespace-nowrap">{formatDate(s.lastActivityAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination {...paged} />
        </>
      )}
      <SubDrawer open={open} onClose={() => { setOpen(false); if (params.get('new')) setParams({}); }} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
      <BulkAssign open={bulkAssign} onClose={() => { setBulkAssign(false); setSel([]); }} ids={sel} projects={(projects.data?.items ?? []).filter((p: any) => p.status !== 'archived')} />
    </div>
  );
}

function BulkAssign({ open, onClose, ids, projects }: { open: boolean; onClose: () => void; ids: string[]; projects: any[] }) {
  const [pid, setPid] = useState('');
  const { run, busy, error } = useMutation('projects.assign');
  const toast = useToast();
  return (
    <Dialog open={open} onClose={onClose} title={`Assign ${ids.length} subcontractor${ids.length === 1 ? '' : 's'} to a project`} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!pid || busy} onClick={async () => { await run({ projectId: pid, subcontractorIds: ids }); toast('Assigned'); onClose(); }}>{busy && <Spinner />}Assign</button></>}>
      <Field label="Project"><select className="input" value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Choose a project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <div className="mt-3"><FormError error={error} /></div>
    </Dialog>
  );
}

const CONTACT_ROLES = [['owner', 'Business owner'], ['administrator', 'Administrator'], ['compliance', 'Compliance'], ['project', 'Project contact'], ['submission', 'Sends documents']] as const;

export function SubDrawer({ open, onClose, sub }: { open: boolean; onClose: () => void; sub?: any }) {
  const blank = { legalName: '', tradingName: '', registrationNumber: '', companyType: '', trade: '', subTypes: [] as string[], address: '', country: '', jurisdiction: '', tags: '', contacts: [{ name: '', email: '', phone: '', roles: ['submission'], primary: true }] as any[], ownerUid: '' };
  const keyed = (cs: any[]) => cs.map((c) => ({ ...c, _k: c.id ?? newRowKey() }));
  const [f, setF] = useState<any>(blank);
  const [touched, setTouched] = useState(false);
  const members = useApi<any>(open ? 'members.list' : null);
  const { me } = useSession();
  const { run, busy, error } = useMutation(sub ? 'subs.update' : 'subs.create');
  const toast = useToast();
  const nav = useNavigate();
  useEffect(() => { if (open) { setTouched(false); setF(sub ? { ...blank, ...sub, tags: sub.tags.join(', '), contacts: keyed(sub.contacts.length ? sub.contacts : blank.contacts), ownerUid: sub.ownerUid ?? '' } : { ...blank, contacts: keyed(blank.contacts), country: me?.org?.settings.market === 'US' ? 'United States' : me?.org?.settings.market === 'UK' ? 'United Kingdom' : '' }); } }, [open]); // eslint-disable-line
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const setContact = (i: number, k: string, v: any) => set('contacts', f.contacts.map((c: any, j: number) => (j === i ? { ...c, [k]: v } : k === 'primary' && v ? { ...c, primary: false } : c)));
  const badEmail = (e: string) => e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  const valid = f.legalName.trim() && f.trade.trim() && !f.contacts.some((c: any) => badEmail(c.email) || (c.email && !c.name.trim()));
  const us = me?.org?.settings.market === 'US';
  return (
    <Drawer open={open} onClose={onClose} title={sub ? `Edit ${sub.legalName}` : 'Add a subcontractor'} width="max-w-2xl" footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={busy} onClick={async () => {
        setTouched(true);
        if (!valid) return;
        try {
          const contacts = f.contacts.filter((c: any) => c.name.trim() || c.email.trim()).map(withoutRowKey);
          const r = await run({ ...f, subcontractorId: sub?.id, tags: f.tags.split(',').map((t: string) => t.trim()).filter(Boolean), contacts, ownerUid: f.ownerUid || undefined, subTypes: f.subTypes.length ? f.subTypes : undefined });
          toast(sub ? 'Saved' : 'Subcontractor added'); onClose();
          if (!sub) nav(`/app/subcontractors/${r.subcontractorId}`);
        } catch { /* shown */ }
      }}>{busy && <Spinner />}{sub ? 'Save changes' : 'Add subcontractor'}</button>
    </>}>
      <div className="space-y-9">
        <fieldset className="space-y-5">
          <legend className="eyebrow mb-4">Business</legend>
          <Field label="Legal business name" required error={touched && !f.legalName.trim() ? 'Enter the legal name' : undefined}><input className="input" value={f.legalName} onChange={(e) => set('legalName', e.target.value)} /></Field>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Trading name" optional><input className="input" value={f.tradingName ?? ''} onChange={(e) => set('tradingName', e.target.value)} /></Field>
            <Field label="Trade" required error={touched && !f.trade.trim() ? 'Enter the trade or service' : undefined}><input className="input" value={f.trade} onChange={(e) => set('trade', e.target.value)} placeholder="e.g. Electrical installation" /></Field>
            <Field label={us ? 'EIN or state registration' : 'Company registration number'} optional><input className="input" value={f.registrationNumber ?? ''} onChange={(e) => set('registrationNumber', e.target.value)} /></Field>
            <Field label="Company type" optional><input className="input" value={f.companyType ?? ''} onChange={(e) => set('companyType', e.target.value)} placeholder={us ? 'e.g. LLC, Inc., sole proprietor' : 'e.g. Limited company, sole trader'} /></Field>
          </div>
        </fieldset>
        <fieldset className="space-y-5">
          <legend className="eyebrow mb-4">Location</legend>
          <Field label="Address" optional><input className="input" value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Country" optional><input className="input" value={f.country ?? ''} onChange={(e) => set('country', e.target.value)} /></Field>
            <Field label={us ? 'State' : 'Region or nation'} optional><input className="input" value={f.jurisdiction ?? ''} onChange={(e) => set('jurisdiction', e.target.value)} placeholder={us ? 'e.g. Texas' : 'e.g. England'} /></Field>
          </div>
        </fieldset>
        <fieldset>
          <legend className="eyebrow mb-4">Contacts</legend>
          <div className="space-y-5">{f.contacts.map((c: any, i: number) => (
            <div key={c._k} className={cx(i > 0 && 'pt-5 border-t border-line')}>
              <div className="grid sm:grid-cols-3 gap-3">
                <input className="input" placeholder="Name" value={c.name} onChange={(e) => setContact(i, 'name', e.target.value)} aria-label="Contact name" />
                <input className="input" type="email" placeholder="Email" value={c.email} onChange={(e) => setContact(i, 'email', e.target.value)} aria-label="Contact email" />
                <input className="input" type="tel" placeholder="Telephone" value={c.phone ?? ''} onChange={(e) => setContact(i, 'phone', e.target.value)} aria-label="Contact telephone" />
              </div>
              {touched && badEmail(c.email) && <p className="hint text-ink font-medium">That email address doesn't look right.</p>}
              <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3 items-center">
                {CONTACT_ROLES.map(([r, l]) => <Checkbox key={r} checked={c.roles.includes(r)} onChange={(v) => setContact(i, 'roles', v ? [...c.roles, r] : c.roles.filter((x: string) => x !== r))} label={<span className="text-sm">{l}</span>} />)}
              </div>
              <div className="flex gap-4 mt-2.5"><Checkbox checked={!!c.primary} onChange={(v) => setContact(i, 'primary', v)} label={<span className="text-sm">Primary contact</span>} />
                {f.contacts.length > 1 && <button className="btn-quiet text-ink" onClick={() => set('contacts', f.contacts.filter((_: any, j: number) => j !== i))}>Remove contact</button>}</div>
            </div>
          ))}</div>
          <button className="btn-secondary btn-sm mt-5" onClick={() => set('contacts', [...f.contacts, { _k: newRowKey(), name: '', email: '', phone: '', roles: ['submission'], primary: false }])}>Add another contact</button>
        </fieldset>
        <fieldset className="space-y-5">
          <legend className="eyebrow mb-4">Internal</legend>
          <Field label="Owner on your team" hint="Gets notified about this subcontractor."><select className="input" value={f.ownerUid} onChange={(e) => set('ownerUid', e.target.value)}><option value="">Me</option>{members.data?.members.filter((m: any) => m.status === 'active').map((m: any) => <option key={m.uid} value={m.uid}>{m.name || m.email}</option>)}</select></Field>
          <div><div className="label">Type of work</div><p className="hint -mt-1 mb-3">Decides which requirements apply (an electrical licence only for electrical, for example). Leave blank to work it out from the trade.</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2.5">{SUB_TYPES.map((t) => <Checkbox key={t} checked={f.subTypes.includes(t)} onChange={(v) => set('subTypes', v ? [...f.subTypes, t] : f.subTypes.filter((x: string) => x !== t))} label={<span className="text-sm">{humanize(t)}</span>} />)}</div>
          </div>
          <Field label="Tags" optional hint="Separate with commas."><input className="input" value={f.tags} onChange={(e) => set('tags', e.target.value)} /></Field>
        </fieldset>
        <FormError error={error} />
      </div>
    </Drawer>
  );
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!open) { setCsv(''); setPreview(null); setResult(null); setError(null); } }, [open]);
  const run = async (dryRun: boolean) => {
    setBusy(true); setError(null);
    try { const r = await api('subs.import', { csv, dryRun }); if (dryRun) setPreview(r); else { setResult(r); dataChanged(); } } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Import subcontractors" description="Bring in your existing list from a spreadsheet. You'll see a preview before anything is saved." width="max-w-2xl" footer={result ? <button className="btn-primary" onClick={onClose}>Done</button> : <>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      {preview ? <button className="btn-primary" disabled={busy || !preview.preview.length} onClick={() => run(false)}>{busy && <Spinner />}Import {preview.preview.length}</button>
        : <button className="btn-primary" disabled={busy || !csv.trim()} onClick={() => run(true)}>{busy && <Spinner />}Preview</button>}
    </>}>
      {result ? <Callout tone="ok" title={`${result.created} imported`}>{result.skipped.length ? `${result.skipped.length} skipped because they're already in your directory. ` : ''}{result.errors.length ? `${result.errors.length} rows had problems and were left out.` : ''}</Callout> : preview ? (
        <div className="space-y-4">
          <p>{preview.preview.length} ready to import{preview.skipped.length ? `, ${preview.skipped.length} already in your directory` : ''}{preview.errors.length ? `, ${preview.errors.length} with problems` : ''}.</p>
          {preview.errors.length > 0 && <div className="border-l-2 border-ink pl-3 text-sm max-h-32 overflow-y-auto space-y-1">{preview.errors.map((e: any, i: number) => <div key={i}>Line {e.line}: {e.message}</div>)}</div>}
          <div className="max-h-64 overflow-auto"><table className="table"><thead><tr><th className="th">Company</th><th className="th">Trade</th><th className="th">Contact</th></tr></thead><tbody>{preview.preview.map((r: any) => <tr key={r.legalName}><td className="td py-2.5">{r.legalName}</td><td className="td py-2.5">{r.trade}</td><td className="td py-2.5 text-muted">{r.contactEmail}</td></tr>)}</tbody></table></div>
          <button className="btn-ghost btn-sm" onClick={() => setPreview(null)}>Back</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">Columns: <span className="font-mono text-xs">{CSV_TEMPLATE.trim()}</span>. Only legal name and trade are required.</p>
          <div className="flex gap-2">
            <label className="btn-secondary btn-sm cursor-pointer">Choose a CSV file<input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const fl = e.target.files?.[0]; if (fl) setCsv(await fl.text()); }} /></label>
            <button className="btn-ghost btn-sm" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' })); a.download = 'subcleared-import-template.csv'; a.click(); }}>Download template</button>
          </div>
          <textarea className="input font-mono text-xs" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="…or paste the CSV here" aria-label="CSV content" />
        </div>
      )}
      <div className="mt-3"><FormError error={error} /></div>
    </Dialog>
  );
}

function subIssues(s: any): string[] {
  const i = s.issues ?? {};
  return ([['missing', 'not requested'], ['requested', 'requested'], ['expired', 'expired'], ['rejected', 'changes needed'], ['review', 'to review'], ['expiring', 'expiring soon']] as const)
    .filter(([k]) => i[k] > 0).map(([k, l]) => `${i[k]} ${l}`);
}

function ProjectReadiness({ s }: { s: any }) {
  if (!s.projects) return <span className="text-sm text-faint">Not on a project</span>;
  const tone = s.readyOn === s.projects ? 'ok' : s.readiness === 'not_evaluated' ? 'none' : s.readyOn === 0 ? 'blocked' : 'attention';
  return <span className={cx('inline-flex items-center gap-2 text-sm whitespace-nowrap', toneText(tone))}><Glyph tone={tone} className="w-[13px] h-[13px]" />Ready on {s.readyOn} of {s.projects} project{s.projects === 1 ? '' : 's'}</span>;
}
