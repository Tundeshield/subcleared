import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../../domain/dates';
import { api, useApi } from '../../lib/api';
import { exportCsv, exportPdf } from '../../lib/export';
import { useSession } from '../../lib/session';
import { cx, Empty, Field, FormError, Icon, PageHeader, Pagination, Spinner, usePaged, useToast } from '../../ui';

const REPORTS: { id: string; name: string; desc: string; perm?: string; filters: string[]; group: string }[] = [
  { group: 'Readiness', id: 'project_readiness', name: 'Project readiness', desc: 'Every subcontractor on each project, whether they are ready, and what is outstanding.', filters: ['projectId', 'subcontractorId', 'trade', 'status', 'jurisdiction'] },
  { group: 'Readiness', id: 'subcontractor_compliance', name: 'Subcontractor compliance', desc: 'Each company’s weakest readiness across projects, with blocking and expiring items.', filters: ['projectId', 'subcontractorId', 'trade', 'status', 'jurisdiction'] },
  { group: 'Readiness', id: 'missing_documents', name: 'Outstanding requirements', desc: 'Mandatory requirements that are missing, requested, overdue or rejected.', filters: ['projectId', 'subcontractorId', 'trade', 'jurisdiction'] },
  { group: 'Readiness', id: 'historical_compliance', name: 'Historical compliance', desc: 'Every readiness decision over time, with the rule versions that produced it.', filters: ['projectId', 'subcontractorId', 'status', 'from', 'to'] },
  { group: 'Documents', id: 'expiring_documents', name: 'Expiring documents', desc: 'Approved documents expiring within a chosen window.', filters: ['projectId', 'subcontractorId', 'trade', 'documentType', 'days'] },
  { group: 'Documents', id: 'expired_documents', name: 'Expired documents', desc: 'Evidence in force that has expired, and whether a replacement has arrived.', filters: ['projectId', 'subcontractorId', 'trade', 'documentType'] },
  { group: 'Documents', id: 'pending_review', name: 'Documents to review', desc: 'Submissions waiting for a decision and how long they have waited.', filters: ['projectId', 'subcontractorId', 'trade'] },
  { group: 'Documents', id: 'rejected_documents', name: 'Review activity: rejections', desc: 'Rejected documents with the reason given and who decided.', filters: ['subcontractorId', 'trade', 'from', 'to'] },
  { group: 'Operations', id: 'renewal_activity', name: 'Renewal activity', desc: 'Renewal requests sent, opened and completed.', filters: ['subcontractorId', 'trade', 'from', 'to'] },
  { group: 'Operations', id: 'onboarding', name: 'Subcontractor onboarding', desc: 'When each company joined and how far through its mandatory requirements it is.', filters: ['projectId', 'trade', 'from', 'to'] },
  { group: 'Operations', id: 'audit_trail', name: 'Audit trail', desc: 'Who did what and when, across the organisation.', perm: 'audit.view', filters: ['projectId', 'subcontractorId', 'from', 'to'] },
];

export default function Reports() {
  const { can } = useSession();
  const [type, setType] = useState('project_readiness');
  const [filters, setFilters] = useState<any>({});
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projects = useApi<any>('projects.list');
  const subs = useApi<any>('subs.list');
  const toast = useToast();
  const def = REPORTS.find((r) => r.id === type)!;
  const paged = usePaged(result?.rows ?? [], 50);
  const fetchReport = async () => api('reports.run', { type, filters: Object.fromEntries(Object.entries(filters).filter(([k, v]) => v && def.filters.includes(k))) });
  const run = async () => { setBusy('run'); setError(null); try { setResult(await fetchReport()); } catch (e: any) { setError(e.message); } finally { setBusy(null); } };
  const pdf = async () => {
    setBusy('pdf'); setError(null);
    try {
      const r = result ?? await fetchReport();
      const project = filters.projectId ? projects.data?.items.find((p: any) => p.id === filters.projectId) : null;
      await exportPdf({ ...r, subtitle: project?.name, context: project ? [['Reference', project.code || '—'], ['Location', project.location || '—'], ['Project manager', project.manager || '—'], ['Subcontractors', String(project.assigned)]] : undefined });
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(null); }
  };
  const set = (k: string, v: any) => { setFilters((f: any) => ({ ...f, [k]: v || undefined })); setResult(null); };
  const groups = [...new Set(REPORTS.map((r) => r.group))];
  return (
    <div>
      <PageHeader title="Reports" description="Built from live records when you run them. Download as CSV for spreadsheets or as a PDF to share." actions={<Link to="/app/compliance" className="btn-secondary">Open readiness matrix</Link>} />
      <div className="grid lg:grid-cols-[17rem_1fr] gap-x-12 gap-y-8 items-start">
        <nav aria-label="Reports" className="space-y-6">
          {groups.map((g) => (
            <div key={g}><div className="eyebrow mb-2">{g}</div>
              <ul>{REPORTS.filter((r) => r.group === g && (!r.perm || can(r.perm as any))).map((r) => (
                <li key={r.id}><button onClick={() => { setType(r.id); setResult(null); }} aria-current={type === r.id} className={cx('relative w-full text-left px-3 py-2 rounded text-[0.9375rem]', type === r.id ? 'bg-ink/[0.05] font-medium before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:bg-accent' : 'text-muted hover:text-ink')}>{r.name}</button></li>
              ))}</ul>
            </div>
          ))}
        </nav>
        <div className="min-w-0">
          <h2 className="text-xl font-medium">{def.name}</h2><p className="text-muted mt-1">{def.desc}</p>
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
            {def.filters.includes('projectId') && <Field label="Project"><select className="input" value={filters.projectId ?? ''} onChange={(e) => set('projectId', e.target.value)}><option value="">All projects</option>{projects.data?.items.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
            {def.filters.includes('subcontractorId') && <Field label="Subcontractor"><select className="input" value={filters.subcontractorId ?? ''} onChange={(e) => set('subcontractorId', e.target.value)}><option value="">All subcontractors</option>{subs.data?.items.map((s: any) => <option key={s.id} value={s.id}>{s.legalName}</option>)}</select></Field>}
            {def.filters.includes('trade') && <Field label="Trade"><input className="input" value={filters.trade ?? ''} onChange={(e) => set('trade', e.target.value)} /></Field>}
            {def.filters.includes('jurisdiction') && <Field label="Jurisdiction"><input className="input" value={filters.jurisdiction ?? ''} onChange={(e) => set('jurisdiction', e.target.value)} /></Field>}
            {def.filters.includes('documentType') && <Field label="Document type"><input className="input" value={filters.documentType ?? ''} onChange={(e) => set('documentType', e.target.value)} /></Field>}
            {def.filters.includes('status') && <Field label="Readiness"><select className="input" value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}><option value="">Any</option><option value="ready">Ready</option><option value="action_required">Action required</option><option value="not_ready">Not ready</option><option value="not_evaluated">Not evaluated</option></select></Field>}
            {def.filters.includes('days') && <Field label="Within (days)"><input className="input" type="number" min={1} max={365} value={filters.days ?? 60} onChange={(e) => set('days', e.target.value)} /></Field>}
            {def.filters.includes('from') && <Field label="From"><input className="input" type="date" value={filters.from ?? ''} onChange={(e) => set('from', e.target.value)} /></Field>}
            {def.filters.includes('to') && <Field label="To"><input className="input" type="date" value={filters.to ?? ''} onChange={(e) => set('to', e.target.value)} /></Field>}
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={run} disabled={!!busy}>{busy === 'run' && <Spinner />}Run report</button>
            <button className="btn-secondary" onClick={pdf} disabled={!!busy}>{busy === 'pdf' && <Spinner />}Download PDF</button>
            {result && <button className="btn-secondary" onClick={() => exportCsv(result.title, result.columns, result.rows)}>Download CSV</button>}
          </div>
          <div className="mt-4"><FormError error={error} /></div>
          {result && (
            <div className="mt-10">
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-line-strong"><span className="font-medium tnum">{result.rows.length} row{result.rows.length === 1 ? '' : 's'}</span><span className="text-sm text-faint">Generated {formatDateTime(result.generatedAt)}{result.filters.length ? ` · ${result.filters.join(' · ')}` : ''}</span></div>
              {result.rows.length === 0 ? <Empty title="No rows">Nothing matches these filters.</Empty> : (
                <>
                  <div className="overflow-x-auto -mx-4 sm:mx-0"><table className="table min-w-[760px]"><thead><tr>{result.columns.map((c: any) => <th key={c.key} className="th">{c.label}</th>)}</tr></thead>
                    <tbody>{paged.slice.map((r: any, i: number) => <tr key={i}>{result.columns.map((c: any) => <td key={c.key} className="td text-sm">{String(r[c.key] ?? '')}</td>)}</tr>)}</tbody></table></div>
                  <Pagination {...paged} />
                </>
              )}
            </div>
          )}
          {!result && !busy && <p className="text-sm text-faint mt-10 flex items-center gap-2">{Icon.arrow()} Choose filters and run the report, or download the PDF directly.</p>}
        </div>
      </div>
    </div>
  );
}
