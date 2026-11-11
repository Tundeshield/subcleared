import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { READINESS_LABELS } from '../../domain/compliance';
import { useApi } from '../../lib/api';
import { cx, Empty, ErrorState, PageHeader, ReadinessBadge, SearchInput, Skeleton } from '../../ui';

const CELL: Record<string, string> = { ready: 'bg-ok/15 text-ok', action_required: 'bg-warn/15 text-warn', not_ready: 'bg-bad/15 text-bad', not_evaluated: 'bg-raised text-faint' };

export default function Compliance() {
  const { data, error, loading, reload } = useApi<any>('compliance.overview');
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const subs = useMemo(() => (data?.subcontractors ?? []).filter((s: any) => s.legalName.toLowerCase().includes(q.toLowerCase()) &&
    (!onlyIssues || data.projects.some((p: any) => ['not_ready', 'action_required'].includes(data.cells[`${p.id}__${s.id}`]?.readiness)))), [data, q, onlyIssues]);
  if (loading && !data) return <div className="panel"><Skeleton /></div>;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const cell = focus ? data.cells[focus] : null;
  const [fp, fs] = focus?.split('__') ?? [];
  return (
    <div>
      <PageHeader title="Compliance" description={`Readiness for every subcontractor on every project. A document expiring within ${data.rule.expiringSoonDays} days marks it as needing attention. Select a cell to see exactly why.`} />
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Filter subcontractors" className="w-72" />
        <label className="text-sm flex items-center gap-2"><input type="checkbox" className="accent-[rgb(var(--accent))]" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />Only with issues</label>
        <div className="flex-1" />
        <div className="flex gap-3 text-xs text-muted">{Object.entries(READINESS_LABELS).map(([k, l]) => <span key={k} className="flex items-center gap-1.5"><span className={cx('w-3 h-3 rounded-sm', CELL[k])} />{l}</span>)}</div>
      </div>
      {data.projects.length === 0 || data.subcontractors.length === 0 ? <div className="panel"><Empty title="Nothing to show yet">Assign subcontractors to active projects to see the readiness matrix.</Empty></div> : (
        <div className="grid xl:grid-cols-[1fr_22rem] gap-6 items-start">
          <div className="panel overflow-auto max-h-[75vh]">
            <table className="border-separate border-spacing-0">
              <thead><tr><th className="th sticky left-0 z-[2] min-w-[14rem]">Subcontractor</th>{data.projects.map((p: any) => <th key={p.id} className="th min-w-[8.5rem] whitespace-normal"><Link to={`/app/projects/${p.id}`} className="hover:text-ink">{p.name}</Link></th>)}</tr></thead>
              <tbody>{subs.map((s: any) => (
                <tr key={s.id}>
                  <td className="td sticky left-0 bg-surface z-[1]"><Link to={`/app/subcontractors/${s.id}`} className="font-medium hover:underline">{s.legalName}</Link><div className="text-xs text-faint">{s.trade}</div></td>
                  {data.projects.map((p: any) => {
                    const k = `${p.id}__${s.id}`; const c = data.cells[k];
                    return <td key={p.id} className="td p-1.5">{c ? (
                      <button onClick={() => setFocus(k)} className={cx('w-full rounded px-2 py-1.5 text-xs font-medium text-left', CELL[c.readiness], focus === k && 'ring-2 ring-accent')} title={c.summary}>
                        {READINESS_LABELS[c.readiness as keyof typeof READINESS_LABELS]}{c.blocking.length ? ` · ${c.blocking.length}` : ''}
                      </button>
                    ) : <span className="block text-center text-faint text-xs">—</span>}</td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="panel p-4 xl:sticky xl:top-20">
            {!cell ? <p className="text-sm text-muted">Select a cell to see the reasons behind its status.</p> : (
              <div className="space-y-3">
                <div><div className="font-medium">{data.subcontractors.find((s: any) => s.id === fs)?.legalName}</div><div className="text-sm text-muted">{data.projects.find((p: any) => p.id === fp)?.name}</div></div>
                <ReadinessBadge value={cell.readiness} />
                <p className="text-sm">{cell.summary}</p>
                {cell.blocking.length > 0 && <div><div className="eyebrow mb-1">Blocking</div><ul className="text-sm space-y-1">{cell.blocking.map((b: string) => <li key={b} className="text-bad">{b}</li>)}</ul></div>}
                {cell.attention.length > 0 && <div><div className="eyebrow mb-1">Needs attention</div><ul className="text-sm space-y-1">{cell.attention.map((b: string) => <li key={b} className="text-warn">{b}</li>)}</ul></div>}
                <Link to={`/app/subcontractors/${fs}?tab=requirements&project=${fp}`} className="btn-secondary btn-sm">Open requirements</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
