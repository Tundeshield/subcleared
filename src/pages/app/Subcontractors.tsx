import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatDate } from '../../domain/dates';
import { CSV_TEMPLATE } from '../../domain/importCsv';
import { SUB_TYPES } from '../../domain/library';
import { api, dataChanged, useApi, useMutation } from '../../lib/api';
import { exportCsv } from '../../lib/export';
import { useSession } from '../../lib/session';
import { Callout, Checkbox, cx, Dialog, Empty, ErrorState, Field, FormError, humanize, PageHeader, ReadinessBadge, SearchInput, Skeleton, SortHeader, sortRows, Spinner, useToast } from '../../ui';

export default function Subcontractors() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useApi<any>('subs.list');
  const [q, setQ] = useState('');
  const [readiness, setReadiness] = useState(params.get('readiness') ?? '');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<[string, 1 | -1]>(['legalName', 1]);
  const [open, setOpen] = useState(params.get('new') === '1');
  const [importing, setImporting] = useState(false);
  const nav = useNavigate();
  useEffect(() => { setReadiness(params.get('readiness') ?? ''); }, [params]);
  const rows = useMemo(() => sortRows((data?.items ?? []).filter((s: any) =>
    (!readiness || s.readiness === readiness) && (status ? s.status === status : s.status !== 'archived') &&
    `${s.legalName} ${s.tradingName ?? ''} ${s.trade} ${s.contact?.email ?? ''} ${s.contact?.name ?? ''} ${s.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())), sort), [data, q, readiness, status, sort]);
  return (
    <div>
      <PageHeader title="Subcontractors" description="One record per company, shared across all of your projects."
        actions={<>
          <button className="btn-secondary" disabled={!rows.length} onClick={() => exportCsv('Subcontractors', [{ key: 'legalName', label: 'Company' }, { key: 'trade', label: 'Trade' }, { key: 'status', label: 'Status' }, { key: 'readiness', label: 'Readiness' }, { key: 'projects', label: 'Projects' }, { key: 'outstanding', label: 'Blocking issues' }, { key: 'contactEmail', label: 'Contact' }], rows.map((r: any) => ({ ...r, contactEmail: r.contact?.email })))}>Export CSV</button>
          {can('subs.manage') && <button className="btn-secondary" onClick={() => setImporting(true)}>Import CSV</button>}
          {can('subs.manage') && <button className="btn-primary" onClick={() => setOpen(true)}>Add subcontractor</button>}
        </>} />
      <div className="flex flex-wrap gap-3 mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search name, trade, contact, tag" className="w-80" />
        <select className="input h-9 w-auto text-sm" value={readiness} onChange={(e) => { setReadiness(e.target.value); setParams(e.target.value ? { readiness: e.target.value } : {}); }} aria-label="Readiness"><option value="">Any readiness</option><option value="ready">Ready</option><option value="action_required">Action required</option><option value="not_ready">Not ready</option><option value="not_evaluated">Not evaluated</option></select>
        <select className="input h-9 w-auto text-sm" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Directory status"><option value="">Current (not archived)</option>{['onboarding', 'active', 'attention', 'invited', 'suspended', 'archived'].map((s) => <option key={s} value={s}>{s === 'attention' ? 'Compliance attention required' : humanize(s)}</option>)}</select>
      </div>
      <div className="panel overflow-x-auto">
        {loading && !data ? <Skeleton /> : error ? <div className="p-4"><ErrorState error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          <Empty title={data.items.length ? 'No subcontractors match' : 'No subcontractors yet'} action={!data.items.length && can('subs.manage') ? <><button className="btn-primary btn-sm" onClick={() => setOpen(true)}>Add subcontractor</button><button className="btn-secondary btn-sm" onClick={() => setImporting(true)}>Import CSV</button></> : undefined}>
            {data.items.length ? 'Try a different search or filter.' : 'Add the companies you work with. Each one is a single record, however many projects they join.'}
          </Empty>
        ) : (
          <table className="w-full min-w-[900px]">
            <thead><tr><SortHeader label="Company" k="legalName" sort={sort} setSort={setSort} /><SortHeader label="Trade" k="trade" sort={sort} setSort={setSort} /><th className="th">Primary contact</th><SortHeader label="Projects" k="projects" sort={sort} setSort={setSort} className="text-right" /><SortHeader label="Readiness" k="readiness" sort={sort} setSort={setSort} /><SortHeader label="Blocking" k="outstanding" sort={sort} setSort={setSort} className="text-right" /><SortHeader label="Status" k="status" sort={sort} setSort={setSort} /><SortHeader label="Last activity" k="lastActivityAt" sort={sort} setSort={setSort} /></tr></thead>
            <tbody>{rows.map((s: any) => (
              <tr key={s.id} className="tr-link" onClick={() => nav(`/app/subcontractors/${s.id}`)}>
                <td className="td"><div className="font-medium">{s.legalName}</div>{(s.tradingName || s.tags.length > 0) && <div className="text-xs text-faint">{[s.tradingName && `t/a ${s.tradingName}`, ...s.tags].filter(Boolean).join(' · ')}</div>}</td>
                <td className="td text-muted">{s.trade}</td>
                <td className="td">{s.contact ? <><div>{s.contact.name}</div><div className="text-xs text-faint">{s.contact.email}</div></> : <span className="text-faint">—</span>}</td>
                <td className="td text-right tabular-nums">{s.projects}</td>
                <td className="td"><ReadinessBadge value={s.readiness} /></td>
                <td className={cx('td text-right tabular-nums', s.outstanding && 'text-bad')}>{s.outstanding || '—'}</td>
                <td className="td"><span className={cx('text-sm', s.status === 'suspended' ? 'text-bad' : s.status === 'attention' ? 'text-warn' : 'text-muted')}>{s.status === 'attention' ? 'Attention required' : humanize(s.status)}</span></td>
                <td className="td text-muted whitespace-nowrap">{formatDate(s.lastActivityAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <SubDialog open={open} onClose={() => { setOpen(false); if (params.get('new')) setParams({}); }} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </div>
  );
}

const CONTACT_ROLES = [['owner', 'Business owner'], ['administrator', 'Administrator'], ['compliance', 'Compliance'], ['project', 'Project'], ['submission', 'Document submission']] as const;

export function SubDialog({ open, onClose, sub }: { open: boolean; onClose: () => void; sub?: any }) {
  const blank = { legalName: '', tradingName: '', registrationNumber: '', companyType: '', trade: '', subTypes: [] as string[], address: '', country: '', jurisdiction: '', tags: '', contacts: [{ name: '', email: '', phone: '', roles: ['submission'], primary: true }] as any[], ownerUid: '' };
  const [f, setF] = useState<any>(blank);
  const members = useApi<any>(open ? 'members.list' : null);
  const { run, busy, error } = useMutation(sub ? 'subs.update' : 'subs.create');
  const toast = useToast();
  const nav = useNavigate();
  useEffect(() => { if (open) setF(sub ? { ...blank, ...sub, tags: sub.tags.join(', '), contacts: sub.contacts.length ? sub.contacts : blank.contacts, ownerUid: sub.ownerUid ?? '' } : blank); }, [open]); // eslint-disable-line
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const setContact = (i: number, k: string, v: any) => set('contacts', f.contacts.map((c: any, j: number) => (j === i ? { ...c, [k]: v } : k === 'primary' && v ? { ...c, primary: false } : c)));
  return (
    <Dialog open={open} onClose={onClose} title={sub ? 'Edit subcontractor' : 'Add subcontractor'} width="max-w-3xl" footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={busy || !f.legalName.trim() || !f.trade.trim()} onClick={async () => {
        try {
          const contacts = f.contacts.filter((c: any) => c.name.trim() || c.email.trim());
          const r = await run({ ...f, subcontractorId: sub?.id, tags: f.tags.split(',').map((t: string) => t.trim()).filter(Boolean), contacts, ownerUid: f.ownerUid || undefined, subTypes: f.subTypes.length ? f.subTypes : undefined });
          toast(sub ? 'Saved' : 'Subcontractor added'); onClose();
          if (!sub) nav(`/app/subcontractors/${r.subcontractorId}`);
        } catch { /* shown */ }
      }}>{busy && <Spinner />}{sub ? 'Save changes' : 'Add subcontractor'}</button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Legal business name" required><input className="input" value={f.legalName} onChange={(e) => set('legalName', e.target.value)} /></Field>
        <Field label="Trading name"><input className="input" value={f.tradingName ?? ''} onChange={(e) => set('tradingName', e.target.value)} /></Field>
        <Field label="Primary trade or service" required><input className="input" value={f.trade} onChange={(e) => set('trade', e.target.value)} placeholder="e.g. Electrical installation" /></Field>
        <Field label="Registration number"><input className="input" value={f.registrationNumber ?? ''} onChange={(e) => set('registrationNumber', e.target.value)} /></Field>
        <Field label="Company type"><input className="input" value={f.companyType ?? ''} onChange={(e) => set('companyType', e.target.value)} placeholder="e.g. Limited company, LLC, sole trader" /></Field>
        <Field label="Internal owner" hint="Who on your team looks after this subcontractor."><select className="input" value={f.ownerUid} onChange={(e) => set('ownerUid', e.target.value)}><option value="">Me</option>{members.data?.members.filter((m: any) => m.status === 'active').map((m: any) => <option key={m.uid} value={m.uid}>{m.name || m.email}</option>)}</select></Field>
        <Field label="Address" className="sm:col-span-2"><input className="input" value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Country"><input className="input" value={f.country ?? ''} onChange={(e) => set('country', e.target.value)} /></Field>
        <Field label="Operating jurisdiction" hint="State, province or region, if relevant."><input className="input" value={f.jurisdiction ?? ''} onChange={(e) => set('jurisdiction', e.target.value)} /></Field>
        <fieldset className="sm:col-span-2"><legend className="label">Subcontractor types</legend><p className="hint -mt-1 mb-2">Used to decide which requirements apply (e.g. an electrical licence only for electrical). Leave empty to infer from the trade.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">{SUB_TYPES.map((t) => <Checkbox key={t} checked={f.subTypes.includes(t)} onChange={(v) => set('subTypes', v ? [...f.subTypes, t] : f.subTypes.filter((x: string) => x !== t))} label={humanize(t)} />)}</div>
        </fieldset>
        <Field label="Tags" hint="Comma separated." className="sm:col-span-2"><input className="input" value={f.tags} onChange={(e) => set('tags', e.target.value)} /></Field>
      </div>
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2"><h3 className="font-medium">Contacts</h3><button className="btn-ghost btn-sm" onClick={() => set('contacts', [...f.contacts, { name: '', email: '', phone: '', roles: ['submission'], primary: false }])}>Add contact</button></div>
        <div className="space-y-3">{f.contacts.map((c: any, i: number) => (
          <div key={i} className="rounded border border-line p-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <input className="input" placeholder="Name" value={c.name} onChange={(e) => setContact(i, 'name', e.target.value)} aria-label="Contact name" />
              <input className="input" type="email" placeholder="Email" value={c.email} onChange={(e) => setContact(i, 'email', e.target.value)} aria-label="Contact email" />
              <input className="input" placeholder="Phone" value={c.phone ?? ''} onChange={(e) => setContact(i, 'phone', e.target.value)} aria-label="Contact phone" />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 items-center">
              {CONTACT_ROLES.map(([r, l]) => <Checkbox key={r} checked={c.roles.includes(r)} onChange={(v) => setContact(i, 'roles', v ? [...c.roles, r] : c.roles.filter((x: string) => x !== r))} label={l} />)}
              <span className="flex-1" />
              <Checkbox checked={!!c.primary} onChange={(v) => setContact(i, 'primary', v)} label="Primary" />
              {f.contacts.length > 1 && <button className="btn-ghost btn-sm text-bad" onClick={() => set('contacts', f.contacts.filter((_: any, j: number) => j !== i))}>Remove</button>}
            </div>
          </div>
        ))}</div>
      </div>
      <div className="mt-4"><FormError error={error} /></div>
    </Dialog>
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
    <Dialog open={open} onClose={onClose} title="Import subcontractors from CSV" width="max-w-2xl" footer={result ? <button className="btn-primary" onClick={onClose}>Done</button> : <>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      {preview ? <button className="btn-primary" disabled={busy || !preview.preview.length} onClick={() => run(false)}>{busy && <Spinner />}Import {preview.preview.length}</button>
        : <button className="btn-primary" disabled={busy || !csv.trim()} onClick={() => run(true)}>{busy && <Spinner />}Preview</button>}
    </>}>
      {result ? <Callout tone="ok" title={`${result.created} imported`}>{result.skipped.length ? `${result.skipped.length} skipped because they're already in your directory. ` : ''}{result.errors.length ? `${result.errors.length} rows had problems.` : ''}</Callout> : preview ? (
        <div className="space-y-3">
          <p className="text-sm">{preview.preview.length} ready to import{preview.skipped.length ? `, ${preview.skipped.length} already in your directory` : ''}{preview.errors.length ? `, ${preview.errors.length} with problems` : ''}.</p>
          {preview.errors.length > 0 && <div className="rounded border border-warn/30 bg-warn/5 p-3 text-sm max-h-32 overflow-y-auto">{preview.errors.map((e: any, i: number) => <div key={i}>Line {e.line}: {e.message}</div>)}</div>}
          <div className="max-h-64 overflow-auto border border-line rounded"><table className="w-full"><thead><tr><th className="th">Company</th><th className="th">Trade</th><th className="th">Types</th><th className="th">Contact</th></tr></thead><tbody>{preview.preview.map((r: any) => <tr key={r.legalName}><td className="td">{r.legalName}</td><td className="td">{r.trade}</td><td className="td text-muted">{r.subTypes.join(', ')}</td><td className="td text-muted">{r.contactEmail}</td></tr>)}</tbody></table></div>
          <button className="btn-ghost btn-sm" onClick={() => setPreview(null)}>Back</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">Columns: <span className="font-mono text-xs">{CSV_TEMPLATE.trim()}</span>. Legal name and trade are required. Separate multiple tags or types with semicolons.</p>
          <div className="flex gap-2">
            <label className="btn-secondary btn-sm cursor-pointer">Choose CSV file<input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} /></label>
            <button className="btn-ghost btn-sm" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' })); a.download = 'subcleared-import-template.csv'; a.click(); }}>Download template</button>
          </div>
          <textarea className="input font-mono text-xs" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="…or paste CSV here" aria-label="CSV content" />
        </div>
      )}
      <div className="mt-3"><FormError error={error} /></div>
    </Dialog>
  );
}
