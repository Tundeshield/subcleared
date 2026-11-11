import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { READINESS_LABELS } from '../../domain/compliance';
import { useApi } from '../../lib/api';
import { Checkbox, cx, Empty, ErrorState, Glyph, PageHeader, ReadinessBadge, SearchInput, Skeleton, Toolbar } from '../../ui';

const TONE: Record<string, any> = { ready: 'ok', action_required: 'attention', not_ready: 'blocked', not_evaluated: 'none' };

export default function Compliance() {
  const { data, error, loading, reload } = useApi<any>('compliance.overview');
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const subs = useMemo(() => (data?.subcontractors ?? []).filter((s: any) => s.legalName.toLowerCase().includes(q.toLowerCase()) &&
    (!onlyIssues || data.projects.some((p: any) => ['not_ready', 'action_required'].includes(data.cells[`${p.id}__${s.id}`]?.readiness)))), [data, q, onlyIssues]);
  if (loading && !data) return <Skeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const cell = focus ? data.cells[focus] : null;
  const [fp, fs] = focus?.split('__') ?? [];
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Reports', to: '/app/reports' }, { label: 'Readiness matrix' }]} title="Readiness matrix" description={`Every subcontractor against every active project. Select a cell to see exactly why. Documents expiring within ${data.rule.expiringSoonDays} days count as needing attention.`} />
      <Toolbar right={<div className="hidden md:flex gap-5 text-sm text-muted">{Object.entries(READINESS_LABELS).map(([k, l]) => <span key={k} className="flex items-center gap-1.5"><Glyph tone={TONE[k]} className="w-3.5 h-3.5" />{l}</span>)}</div>}>
        <SearchInput value={q} onChange={setQ} placeholder="Filter subcontractors" className="w-full sm:w-72" />
        <Checkbox checked={onlyIssues} onChange={setOnlyIssues} label="Only with issues" />
      </Toolbar>
      {data.projects.length === 0 || data.subcontractors.length === 0 ? <Empty title="Nothing to show yet">Assign subcontractors to active projects to see the matrix.</Empty> : (
        <div className="grid xl:grid-cols-[1fr_22rem] gap-10 items-start">
          <div className="overflow-auto max-h-[72vh] border-t border-line-strong">
            <table className="border-separate border-spacing-0">
              <thead><tr><th className="th sticky left-0 top-0 z-[3] min-w-[15rem]">Subcontractor</th>{data.projects.map((p: any) => <th key={p.id} className="th sticky top-0 z-[2] min-w-[9.5rem] whitespace-normal align-bottom"><Link to={`/app/projects/${p.id}`} className="hover:text-ink">{p.name}</Link></th>)}</tr></thead>
              <tbody>{subs.map((s: any) => (
                <tr key={s.id}>
                  <td className="td sticky left-0 bg-canvas z-[1]"><Link to={`/app/subcontractors/${s.id}`} className="font-medium hover:underline underline-offset-4">{s.legalName}</Link><div className="text-sm text-faint">{s.trade}</div></td>
                  {data.projects.map((p: any) => {
                    const k = `${p.id}__${s.id}`; const c = data.cells[k];
                    return <td key={p.id} className="td py-2.5 px-2">{c ? (
                      <button onClick={() => setFocus(k)} aria-pressed={focus === k} className={cx('w-full rounded px-2.5 py-2 text-sm text-left flex items-center gap-2 hover:bg-raised', focus === k && 'bg-raised ring-1 ring-ink/40', c.readiness === 'ready' && 'text-accent')}>
                        <Glyph tone={TONE[c.readiness]} className="w-3.5 h-3.5" /><span>{(READINESS_LABELS as any)[c.readiness]}{c.blocking.length ? <span className="text-faint"> · {c.blocking.length}</span> : ''}</span>
                      </button>
                    ) : <span className="block text-center text-line-strong text-sm" aria-label="Not assigned">—</span>}</td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <aside className="xl:sticky xl:top-24">
            {!cell ? <p className="text-muted">Select a cell to see the reasons behind it.</p> : (
              <div className="space-y-4">
                <div><div className="font-medium">{data.subcontractors.find((s: any) => s.id === fs)?.legalName}</div><div className="text-sm text-muted">{data.projects.find((p: any) => p.id === fp)?.name}</div></div>
                <ReadinessBadge value={cell.readiness} />
                <p className="text-muted">{cell.summary}</p>
                {cell.blocking.length > 0 && <div><div className="eyebrow mb-2">Blocking</div><ul className="space-y-1.5">{cell.blocking.map((b: string) => <li key={b} className="flex gap-2 text-sm"><Glyph tone="blocked" className="w-3.5 h-3.5 mt-0.5" />{b}</li>)}</ul></div>}
                {cell.attention.length > 0 && <div><div className="eyebrow mb-2">Needs attention</div><ul className="space-y-1.5">{cell.attention.map((b: string) => <li key={b} className="flex gap-2 text-sm"><Glyph tone="attention" className="w-3.5 h-3.5 mt-0.5" />{b}</li>)}</ul></div>}
                <Link to={`/app/subcontractors/${fs}?tab=requirements&project=${fp}`} className="btn-secondary btn-sm">Open requirements</Link>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
