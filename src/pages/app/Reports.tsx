import { useState } from 'react';
import { formatDateTime } from '../../domain/dates';
import { api, useApi } from '../../lib/api';
import { exportCsv, exportPdf } from '../../lib/export';
import { useSession } from '../../lib/session';
import { cx, Empty, ErrorState, Field, PageHeader, Spinner, useToast } from '../../ui';

const REPORTS: { id: string; name: string; desc: string; perm?: string; filters: string[] }[] = [
  { id: 'project_readiness', name: 'Project readiness', desc: 'Every subcontractor on each project, with readiness and outstanding issues.', filters: ['projectId', 'subcontractorId', 'trade', 'status', 'jurisdiction'] },
  { id: 'subcontractor_compliance', name: 'Subcontractor compliance', desc: 'Each company’s worst readiness across projects, blocking issues and expiring items.', filters: ['projectId', 'subcontractorId', 'trade', 'status', 'jurisdiction'] },
  { id: 'missing_documents', name: 'Missing documents', desc: 'Mandatory requirements that are missing, requested, overdue or rejected.', filters: ['projectId', 'subcontractorId', 'trade', 'jurisdiction'] },
  { id: 'expiring_documents', name: 'Expiring documents', desc: 'Approved documents expiring within a window.', filters: ['projectId', 'subcontractorId', 'trade', 'documentType', 'days'] },
  { id: 'expired_documents', name: 'Expired documents', desc: 'Evidence in force that has expired, and whether a replacement arrived.', filters: ['projectId', 'subcontractorId', 'trade', 'documentType'] },
  { id: 'rejected_documents', name: 'Rejected documents', desc: 'Rejections with reasons and reviewers.', filters: ['subcontractorId', 'trade', 'from', 'to'] },
  { id: 'pending_review', name: 'Pending review', desc: 'Submissions waiting for a decision and how long they have waited.', filters: ['projectId', 'subcontractorId', 'trade'] },
  { id: 'renewal_activity', name: 'Renewal activity', desc: 'Renewal requests sent, opened and fulfilled.', filters: ['subcontractorId', 'trade', 'from', 'to'] },
  { id: 'onboarding', name: 'Subcontractor onboarding', desc: 'Onboarding dates and progress toward mandatory requirements.', filters: ['projectId', 'trade', 'from', 'to'] },
  { id: 'historical_compliance', name: 'Historical compliance', desc: 'Every readiness decision, with the rule versions that produced it.', filters: ['projectId', 'subcontractorId', 'status', 'from', 'to'] },
  { id: 'audit_trail', name: 'Audit trail', desc: 'Who did what and when, across the organisation.', perm: 'audit.view', filters: ['projectId', 'subcontractorId', 'from', 'to'] },
];

export default function Reports() {
  const { can } = useSession();
  const [type, setType] = useState('project_readiness');
  const [filters, setFilters] = useState<any>({});
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projects = useApi<any>('projects.list');
  const subs = useApi<any>('subs.list');
  const toast = useToast();
  const def = REPORTS.find((r) => r.id === type)!;
  const run = async () => {
    setBusy(true); setError(null);
    try { setResult(await api('reports.run', { type, filters: Object.fromEntries(Object.entries(filters).filter(([k, v]) => v && def.filters.includes(k))) })); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const set = (k: string, v: any) => setFilters((f: any) => ({ ...f, [k]: v || undefined }));
  return (
    <div>
      <PageHeader title="Reports" description="Generated from live records at the moment you run them. Export to CSV for spreadsheets or PDF to share." />
      <div className="grid lg:grid-cols-[17rem_1fr] gap-6 items-start">
        <nav className="panel p-1.5" aria-label="Reports">
          {REPORTS.filter((r) => !r.perm || can(r.perm as any)).map((r) => (
            <button key={r.id} onClick={() => { setType(r.id); setResult(null); }} className={cx('w-full text-left rounded px-3 py-2', type === r.id ? 'bg-raised' : 'hover:bg-raised/60')}>
              <div className={cx('text-sm', type === r.id ? 'font-medium text-ink' : 'text-muted')}>{r.name}</div>
            </button>
          ))}
        </nav>
        <div className="space-y-4 min-w-0">
          <div className="panel p-4">
            <h2 className="font-semibold">{def.name}</h2><p className="text-sm text-muted mt-0.5">{def.desc}</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
              {def.filters.includes('projectId') && <Field label="Project"><select className="input h-9 text-sm" value={filters.projectId ?? ''} onChange={(e) => set('projectId', e.target.value)}><option value="">All</option>{projects.data?.items.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
              {def.filters.includes('subcontractorId') && <Field label="Subcontractor"><select className="input h-9 text-sm" value={filters.subcontractorId ?? ''} onChange={(e) => set('subcontractorId', e.target.value)}><option value="">All</option>{subs.data?.items.map((s: any) => <option key={s.id} value={s.id}>{s.legalName}</option>)}</select></Field>}
              {def.filters.includes('trade') && <Field label="Trade"><input className="input h-9 text-sm" value={filters.trade ?? ''} onChange={(e) => set('trade', e.target.value)} /></Field>}
              {def.filters.includes('jurisdiction') && <Field label="Jurisdiction"><input className="input h-9 text-sm" value={filters.jurisdiction ?? ''} onChange={(e) => set('jurisdiction', e.target.value)} /></Field>}
              {def.filters.includes('documentType') && <Field label="Document type"><input className="input h-9 text-sm" value={filters.documentType ?? ''} onChange={(e) => set('documentType', e.target.value)} placeholder="e.g. Certificate of insurance" /></Field>}
              {def.filters.includes('status') && <Field label="Readiness"><select className="input h-9 text-sm" value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}><option value="">Any</option><option value="ready">Ready</option><option value="action_required">Action required</option><option value="not_ready">Not ready</option><option value="not_evaluated">Not evaluated</option></select></Field>}
              {def.filters.includes('days') && <Field label="Within (days)"><input className="input h-9 text-sm" type="number" min={1} max={365} value={filters.days ?? 60} onChange={(e) => set('days', e.target.value)} /></Field>}
              {def.filters.includes('from') && <Field label="From"><input className="input h-9 text-sm" type="date" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} /></Field>}
              {def.filters.includes('to') && <Field label="To"><input className="input h-9 text-sm" type="date" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} /></Field>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-primary" onClick={run} disabled={busy}>{busy && <Spinner />}Run report</button>
              {result && <><button className="btn-secondary" onClick={() => exportCsv(result.title, result.columns, result.rows)}>Export CSV</button><button className="btn-secondary" onClick={() => exportPdf(result).catch((e) => toast(e.message, 'bad'))}>Export PDF</button></>}
            </div>
            {error && <p className="text-sm text-bad mt-3">{error}</p>}
          </div>
          {result && (
            <div className="panel overflow-x-auto">
              <div className="px-4 py-2.5 border-b border-line text-xs text-muted">{result.rows.length} rows · generated {formatDateTime(result.generatedAt)}{result.filters.length ? ` · ${result.filters.join(' · ')}` : ''}</div>
              {result.rows.length === 0 ? <Empty title="No rows">Nothing matches these filters.</Empty> : (
                <table className="w-full min-w-[720px]"><thead><tr>{result.columns.map((c: any) => <th key={c.key} className="th">{c.label}</th>)}</tr></thead>
                  <tbody>{result.rows.slice(0, 500).map((r: any, i: number) => <tr key={i}>{result.columns.map((c: any) => <td key={c.key} className="td text-sm">{String(r[c.key] ?? '')}</td>)}</tr>)}</tbody></table>
              )}
              {result.rows.length > 500 && <div className="px-4 py-2 text-xs text-muted">Showing the first 500 rows. Exports include all {result.rows.length}.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
