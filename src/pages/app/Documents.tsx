import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { useApi } from '../../lib/api';
import { exportCsv } from '../../lib/export';
import { Checkbox, cx, DocStatus, Empty, ErrorState, PageHeader, SearchInput, Skeleton, SortHeader, sortRows, VerificationLabel } from '../../ui';

export default function Documents() {
  const [f, setF] = useState<any>({});
  const { data, error, loading, reload } = useApi<any>('documents.list', f);
  const subs = useApi<any>('subs.list');
  const projects = useApi<any>('projects.list');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<[string, 1 | -1]>(['uploadedAt', -1]);
  const nav = useNavigate();
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v || undefined }));
  const rows = useMemo(() => sortRows((data?.items ?? []).filter((d: any) => `${d.title} ${d.subcontractor} ${d.referenceNumber ?? ''} ${d.issuer ?? ''} ${d.requirement ?? ''}`.toLowerCase().includes(q.toLowerCase())), sort), [data, q, sort]);
  const cols = [{ key: 'title', label: 'Document' }, { key: 'subcontractor', label: 'Subcontractor' }, { key: 'requirement', label: 'Requirement' }, { key: 'documentType', label: 'Type' }, { key: 'issuer', label: 'Issuer' }, { key: 'referenceNumber', label: 'Reference' }, { key: 'expiryDate', label: 'Expiry' }, { key: 'status', label: 'Status' }, { key: 'verification', label: 'Verification' }, { key: 'uploadedAt', label: 'Last upload' }];
  return (
    <div>
      <PageHeader title="Documents" description="Every document on file, with its current status and full version history." actions={<button className="btn-secondary" disabled={!rows.length} onClick={() => exportCsv('Documents', cols, rows)}>Export CSV</button>} />
      <div className="panel p-3 mb-4 grid sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Title, reference, issuer" className="xl:col-span-2" />
        <select className="input h-9 text-sm" value={f.subcontractorId ?? ''} onChange={(e) => set('subcontractorId', e.target.value)} aria-label="Subcontractor"><option value="">All subcontractors</option>{subs.data?.items.map((s: any) => <option key={s.id} value={s.id}>{s.legalName}</option>)}</select>
        <select className="input h-9 text-sm" value={f.projectId ?? ''} onChange={(e) => set('projectId', e.target.value)} aria-label="Project"><option value="">All projects</option>{projects.data?.items.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="input h-9 text-sm" value={f.documentType ?? ''} onChange={(e) => set('documentType', e.target.value)} aria-label="Document type"><option value="">All types</option>{data?.documentTypes.map((t: string) => <option key={t}>{t}</option>)}</select>
        <select className="input h-9 text-sm" value={f.status ?? ''} onChange={(e) => set('status', e.target.value)} aria-label="Status"><option value="">Any status</option><option value="approved">Approved</option><option value="expiring">Expiring soon</option><option value="expired">Expired</option><option value="awaiting_review">Awaiting review</option><option value="rejected">Rejected</option><option value="info_requested">Info requested</option></select>
        <input className="input h-9 text-sm" type="date" value={f.expiresBefore ?? ''} onChange={(e) => set('expiresBefore', e.target.value)} aria-label="Expires before" title="Expires on or before" />
        <input className="input h-9 text-sm" placeholder="Issuer" value={f.issuer ?? ''} onChange={(e) => set('issuer', e.target.value)} aria-label="Issuer" />
        <input className="input h-9 text-sm" placeholder="Jurisdiction" value={f.jurisdiction ?? ''} onChange={(e) => set('jurisdiction', e.target.value)} aria-label="Jurisdiction" />
        <input className="input h-9 text-sm" type="date" value={f.uploadedAfter ?? ''} onChange={(e) => set('uploadedAfter', e.target.value)} aria-label="Uploaded after" title="Uploaded on or after" />
        <div className="flex items-center px-1"><Checkbox checked={!!f.includeArchived} onChange={(v) => set('includeArchived', v)} label="Include archived" /></div>
      </div>
      <div className="panel overflow-x-auto">
        {loading && !data ? <Skeleton /> : error ? <div className="p-4"><ErrorState error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          <Empty title="No documents found">{Object.keys(f).length || q ? 'Try removing a filter.' : 'Documents appear here once subcontractors upload them or you upload on their behalf.'}</Empty>
        ) : (
          <table className="w-full min-w-[1100px]">
            <thead><tr><SortHeader label="Document" k="title" sort={sort} setSort={setSort} /><SortHeader label="Subcontractor" k="subcontractor" sort={sort} setSort={setSort} /><th className="th">Issuer · reference</th><SortHeader label="Expiry" k="expiryDate" sort={sort} setSort={setSort} /><SortHeader label="Status" k="status" sort={sort} setSort={setSort} /><th className="th">Verification</th><SortHeader label="Versions" k="versions" sort={sort} setSort={setSort} className="text-right" /><SortHeader label="Last upload" k="uploadedAt" sort={sort} setSort={setSort} /></tr></thead>
            <tbody>{rows.map((d: any) => (
              <tr key={d.id} className={cx('tr-link', d.archived && 'opacity-60')} onClick={() => nav(`/app/documents/${d.id}`)}>
                <td className="td"><div className="font-medium">{d.title}</div><div className="text-xs text-faint">{d.documentType ?? d.requirement ?? '—'}</div></td>
                <td className="td">{d.subcontractor}</td>
                <td className="td text-muted"><div>{d.issuer ?? '—'}</div><div className="text-xs font-mono text-faint">{d.referenceNumber}</div></td>
                <td className={cx('td whitespace-nowrap tabular-nums', d.days !== undefined && d.days < 0 ? 'text-bad' : d.days !== undefined && d.days <= 30 ? 'text-warn' : 'text-muted')}>{d.expiryDate ? formatDate(d.expiryDate) : '—'}</td>
                <td className="td"><DocStatus value={d.status} />{d.complianceImpact === 'blocking' && <div className="text-xs text-bad mt-0.5">Blocking readiness</div>}</td>
                <td className="td"><VerificationLabel value={d.verification} /></td>
                <td className="td text-right tabular-nums">{d.versions}</td>
                <td className="td text-muted whitespace-nowrap">{formatDateTime(d.uploadedAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
