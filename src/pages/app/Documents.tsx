import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDate } from '../../domain/dates';
import { useApi } from '../../lib/api';
import { exportCsv } from '../../lib/export';
import { Checkbox, cx, DocStatus, Empty, ErrorState, FilterSelect, PageHeader, Pagination, SearchInput, Skeleton, SortHeader, sortRows, Toolbar, usePaged } from '../../ui';

export default function Documents() {
  const [f, setF] = useState<any>({});
  const { data, error, loading, reload } = useApi<any>('documents.list', f);
  const subs = useApi<any>('subs.list');
  const projects = useApi<any>('projects.list');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [more, setMore] = useState(false);
  const [sort, setSort] = useState<[string, 1 | -1]>(['uploadedAt', -1]);
  const nav = useNavigate();
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v || undefined }));
  const rows = useMemo(() => sortRows((data?.items ?? []).filter((d: any) => (!category || d.category === category) && `${d.title} ${d.subcontractor} ${d.referenceNumber ?? ''} ${d.issuer ?? ''}`.toLowerCase().includes(q.toLowerCase())), sort), [data, q, category, sort]);
  const paged = usePaged(rows, 25);
  const categories = [...new Set((data?.items ?? []).map((d: any) => d.category).filter(Boolean))] as string[];
  const cols = [{ key: 'title', label: 'Document' }, { key: 'subcontractor', label: 'Subcontractor' }, { key: 'category', label: 'Category' }, { key: 'projectsText', label: 'Projects' }, { key: 'issuer', label: 'Issuer' }, { key: 'referenceNumber', label: 'Reference' }, { key: 'issueDate', label: 'Issued' }, { key: 'expiryDate', label: 'Expires' }, { key: 'status', label: 'Status' }, { key: 'versionNumber', label: 'Version' }];
  return (
    <div>
      <PageHeader title="Documents" description="Every document on file, with its review status, validity and full version history."
        actions={<button className="btn-secondary" disabled={!rows.length} onClick={() => exportCsv('Documents', cols, rows.map((r: any) => ({ ...r, projectsText: r.projectNames?.join('; ') })))}>Export CSV</button>} />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Title, subcontractor, policy or reference" className="w-full sm:w-80" />
        <FilterSelect label="Status" value={f.status ?? ''} onChange={(v) => set('status', v)} options={[{ value: 'approved', label: 'Approved' }, { value: 'expiring', label: 'Expiring soon' }, { value: 'expired', label: 'Expired' }, { value: 'awaiting_review', label: 'Awaiting review' }, { value: 'rejected', label: 'Rejected' }, { value: 'info_requested', label: 'More information requested' }]} />
        <FilterSelect label="Project" value={f.projectId ?? ''} onChange={(v) => set('projectId', v)} options={(projects.data?.items ?? []).map((p: any) => ({ value: p.id, label: p.name }))} />
        {categories.length > 1 && <FilterSelect label="Category" value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c }))} />}
        <button className="btn-ghost btn-sm" onClick={() => setMore((m) => !m)} aria-expanded={more}>{more ? 'Fewer filters' : 'More filters'}</button>
      </Toolbar>
      {more && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 pb-6 border-b border-line">
          <label className="block"><span className="label">Subcontractor</span><select className="input" value={f.subcontractorId ?? ''} onChange={(e) => set('subcontractorId', e.target.value)}><option value="">All</option>{subs.data?.items.map((s: any) => <option key={s.id} value={s.id}>{s.legalName}</option>)}</select></label>
          <label className="block"><span className="label">Issuer or insurer</span><input className="input" value={f.issuer ?? ''} onChange={(e) => set('issuer', e.target.value)} /></label>
          <label className="block"><span className="label">Jurisdiction</span><input className="input" value={f.jurisdiction ?? ''} onChange={(e) => set('jurisdiction', e.target.value)} /></label>
          <label className="block"><span className="label">Expires on or before</span><input className="input" type="date" value={f.expiresBefore ?? ''} onChange={(e) => set('expiresBefore', e.target.value)} /></label>
          <label className="block"><span className="label">Uploaded on or after</span><input className="input" type="date" value={f.uploadedAfter ?? ''} onChange={(e) => set('uploadedAfter', e.target.value)} /></label>
          <div className="flex items-end pb-2"><Checkbox checked={!!f.includeArchived} onChange={(v) => set('includeArchived', v)} label="Include archived" /></div>
        </div>
      )}
      {loading && !data ? <Skeleton /> : error ? <ErrorState error={error} onRetry={reload} /> : rows.length === 0 ? (
        <Empty title="No documents found">{Object.keys(f).length || q || category ? 'Try removing a filter.' : 'Documents appear here once subcontractors submit them, or when you upload on their behalf.'}</Empty>
      ) : (
        <>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="table min-w-[1080px]">
              <thead><tr><SortHeader label="Document" k="title" sort={sort} setSort={setSort} /><SortHeader label="Subcontractor" k="subcontractor" sort={sort} setSort={setSort} /><th className="th">Projects</th><SortHeader label="Issued" k="issueDate" sort={sort} setSort={setSort} /><SortHeader label="Expires" k="expiryDate" sort={sort} setSort={setSort} /><SortHeader label="Status" k="status" sort={sort} setSort={setSort} /><SortHeader label="Version" k="versionNumber" sort={sort} setSort={setSort} /></tr></thead>
              <tbody>{paged.slice.map((d: any) => (
                <tr key={d.id} className={cx('tr-link', d.archived && 'opacity-60')} onClick={() => nav(`/app/documents/${d.id}`)}>
                  <td className="td"><div className="font-medium">{d.title}</div><div className="text-sm text-faint">{d.category}{d.referenceNumber ? ` · ${d.referenceNumber}` : ''}</div></td>
                  <td className="td">{d.subcontractor}</td>
                  <td className="td text-sm text-muted">{d.projectNames?.length ? d.projectNames.join(', ') : <span className="text-faint">—</span>}</td>
                  <td className="td whitespace-nowrap tnum text-muted">{formatDate(d.issueDate)}</td>
                  <td className="td whitespace-nowrap tnum">{d.expiryDate ? <span className={cx(d.days !== undefined && d.days < 30 && 'font-medium')}>{formatDate(d.expiryDate)}</span> : <span className="text-faint">No expiry</span>}</td>
                  <td className="td"><DocStatus value={d.status} />{d.complianceImpact === 'blocking' && <div className="text-xs text-muted mt-1">Holding up readiness</div>}</td>
                  <td className="td tnum text-muted">v{d.versionNumber ?? 1}{d.versions > 1 && <span className="text-faint"> of {d.versions}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination {...paged} />
        </>
      )}
    </div>
  );
}
