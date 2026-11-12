import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatDateTime } from '../../domain/dates';
import { api, dataChanged, useApi } from '../../lib/api';
import { Checkbox, Dialog, Empty, ErrorState, FilterSelect, Glyph, PageHeader, Pagination, SearchInput, Skeleton, Spinner, Toolbar, usePaged, useToast, RowLink, rowClick } from '../../ui';
import { formatDate } from '../../domain/dates';

const AGE = [{ value: '1', label: 'Last 24 hours' }, { value: '7', label: 'Last 7 days' }, { value: 'old', label: 'Waiting over 3 days' }];

/** The review inbox: only submissions that need a human decision. Approved documents live in All documents. */
export default function Reviews() {
  const { data, error, loading, reload } = useApi<any>('reviews.queue');
  const [params, setParams] = useSearchParams();
  const project = params.get('project') ?? '';
  const [sub, setSub] = useState('');
  const [age, setAge] = useState('');
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const items: any[] = data?.items ?? [];
  const projects = useMemo(() => [...new Map(items.flatMap((i) => i.projects).map((p: any) => [p.id, p])).values()].sort((a: any, b: any) => a.name.localeCompare(b.name)), [items]);
  const subs = useMemo(() => [...new Map(items.map((i) => [i.subcontractorId, i.subcontractor])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]))), [items]);
  const rows = items.filter((r) => (!project || r.projects.some((p: any) => p.id === project)) && (!sub || r.subcontractorId === sub)
    && (!age || (age === 'old' ? r.ageHours > 72 : r.ageHours <= Number(age) * 24))
    && `${r.requirement ?? ''} ${r.title ?? ''} ${r.subcontractor ?? ''} ${r.fileName}`.toLowerCase().includes(q.toLowerCase()));
  const paged = usePaged(rows, 25);
  const clean = items.filter((i) => i.triage === 'looks_good' && !i.lockedBy);
  const [bulk, setBulk] = useState(false);
  useEffect(() => { if (params.get('confirm') === '1' && clean.length) setBulk(true); }, [clean.length]); // eslint-disable-line
  const setProject = (v: string) => { const p = new URLSearchParams(params); if (v) p.set('project', v); else p.delete('project'); setParams(p); };
  return (
    <div>
      <PageHeader title="Documents to review" description="Everything waiting for your decision, oldest first. A document only counts towards readiness once it's approved."
        actions={rows.length > 0 && <Link to={`/app/reviews/${rows[0].versionId}`} className="btn-primary">Start reviewing</Link>} />
      {loading && !data ? <Skeleton /> : error ? <ErrorState error={error} onRetry={reload} /> : items.length === 0 ? (
        <Empty title="Nothing to review" action={<Link to="/app/documents" className="btn-secondary">See all documents</Link>}>New submissions appear here as soon as they pass security checks. You'll also see them on the Overview.</Empty>
      ) : (
        <>
          {clean.length > 0 && (
            <div className="mb-6 rounded-lg border border-success/25 bg-success-tint px-5 py-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2.5"><Glyph tone="ok" className="w-4 h-4 mt-0.5" /><div><div className="font-medium">{clean.length} document{clean.length === 1 ? '' : 's'} passed every check</div><div className="text-sm text-muted">Right company, in date, and meets the requirement. Look over what was read, then approve them together.</div></div></div>
              <button className="btn-primary" onClick={() => setBulk(true)}>Review and approve {clean.length}</button>
            </div>
          )}
          <Toolbar>
            <SearchInput value={q} onChange={setQ} placeholder="Search document or subcontractor" className="w-full sm:w-72" />
            {projects.length > 1 && <FilterSelect label="Project" value={project} onChange={setProject} options={projects.map((p: any) => ({ value: p.id, label: p.name }))} />}
            {subs.length > 1 && <FilterSelect label="Subcontractor" value={sub} onChange={setSub} options={subs.map(([id, name]) => ({ value: id, label: String(name) }))} />}
            <FilterSelect label="Submitted" all="Any time" value={age} onChange={setAge} options={AGE} />
          </Toolbar>
          {rows.length === 0 ? <Empty title="Nothing matches these filters" /> : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="table min-w-[900px]">
                <thead><tr><th className="th">Document</th><th className="th">Subcontractor</th><th className="th">Project</th><th className="th">Submitted</th><th className="th">Automatic check</th><th className="th"><span className="sr-only">Action</span></th></tr></thead>
                <tbody>{paged.slice.map((r: any) => (
                  <tr key={r.versionId} className="tr-link" onClick={rowClick(() => nav(`/app/reviews/${r.versionId}`))}>
                    <td className="td"><div><RowLink to={`/app/reviews/${r.versionId}`}>{r.requirement ?? r.title}<span className="sr-only"> from {r.subcontractor}</span></RowLink></div><div className="text-sm text-faint truncate max-w-[18rem]">{r.fileName}{r.versionNumber > 1 ? ` · version ${r.versionNumber}` : ''}{r.replacing ? ' · replaces the approved copy' : ''}</div></td>
                    <td className="td">{r.subcontractor}</td>
                    <td className="td text-sm">{r.projects.length === 0 ? <span className="text-faint">Not on a live project</span> : r.projects.length === 1 ? r.projects[0].name : <span title={r.projects.map((p: any) => p.name).join(', ')}>{r.projects[0].name} <span className="text-faint">+{r.projects.length - 1}</span></span>}</td>
                    <td className="td text-sm"><div>{formatDateTime(r.uploadedAt)}</div><div className={r.ageHours > 72 ? 'text-warning font-medium' : 'text-faint'}>{r.ageHours < 24 ? 'Today' : `Waiting ${Math.floor(r.ageHours / 24)} day${Math.floor(r.ageHours / 24) === 1 ? '' : 's'}`}</div></td>
                    <td className="td text-sm text-muted max-w-[22rem]">{r.lockedBy ? <span className="flex items-center gap-1.5 text-ink"><Glyph tone="progress" className="w-3 h-3" />{r.lockedBy.name} is reviewing</span> : r.triage ? <span className="flex items-start gap-1.5"><Glyph tone={r.triage === 'looks_good' ? 'ok' : r.triage === 'problem' ? 'blocked' : 'attention'} className="w-3 h-3 mt-1 shrink-0" /><span>{r.triage === 'looks_good' ? 'Checks passed — confirm to approve' : r.check}</span></span> : ['queued', 'processing'].includes(r.extraction) ? 'Reading the document…' : 'Check by eye'}</td>
                    <td className="td text-right"><span className="btn-secondary btn-sm">Review</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <Pagination {...paged} />
        </>
      )}
      {bulk && <BulkConfirm items={clean} onClose={() => setBulk(false)} onDone={() => { setBulk(false); reload(); dataChanged(); }} />}
    </div>
  );
}

function BulkConfirm({ items, onClose, onDone }: { items: any[]; onClose: () => void; onDone: () => void }) {
  const [sel, setSel] = useState<string[]>(items.map((i) => i.versionId));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async () => {
    setBusy(true);
    try {
      const r = await api<any>('reviews.confirmChecked', { versionIds: sel });
      const skipped = r.results.filter((x: any) => !x.ok);
      toast(`${r.approved} approved${skipped.length ? ` · ${skipped.length} left for a closer look (${skipped[0].reason})` : ''}`, skipped.length ? 'info' : undefined);
      onDone();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} width="max-w-2xl" title="Approve documents that passed every check"
      description="Each one names the right company, is in date and meets its requirement. Untick anything you want to open first."
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !sel.length} onClick={run}>{busy && <Spinner />}Approve {sel.length} document{sel.length === 1 ? '' : 's'}</button></>}>
      <ul className="divide-y divide-line border-y border-line">
        {items.map((i) => (
          <li key={i.versionId} className="py-3 flex items-start gap-3">
            <Checkbox checked={sel.includes(i.versionId)} onChange={(v) => setSel(v ? [...sel, i.versionId] : sel.filter((x) => x !== i.versionId))} label={<span className="sr-only">Include {i.requirement ?? i.title}</span>} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{i.subcontractor} · {i.requirement ?? i.title}</div>
              <div className="text-sm text-muted">{[i.read?.namedInsured && `“${i.read.namedInsured}”`, i.read?.issuer, i.read?.referenceNumber, i.read?.expiryDate && `valid until ${formatDate(i.read.expiryDate)}`].filter(Boolean).join(' · ') || 'Details read automatically'}</div>
            </div>
            <a className="btn-quiet shrink-0" href={`/app/reviews/${i.versionId}`} target="_blank" rel="noreferrer">Open</a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-faint mt-3">You’re approving these as reviewed against your requirements. It isn’t independent verification with the insurer or issuer.</p>
    </Dialog>
  );
}
