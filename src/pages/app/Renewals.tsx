import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { useApi, useMutation } from '../../lib/api';
import { exportCsv } from '../../lib/export';
import { followUpText, localToday, MANUAL_WHY } from '../../lib/followup';
import { useSession } from '../../lib/session';
import { Checkbox, cx, Empty, ErrorState, FilterSelect, FormError, Glyph, toneText, humanize, Menu, MoreButton, PageHeader, Pagination, Skeleton, Spinner, Toolbar, usePaged, useToast } from '../../ui';

const STAGES: Record<string, [string, 'none' | 'progress' | 'attention' | 'blocked' | 'ok']> = {
  not_requested: ['Automatic reminder', 'progress'], requested: ['Renewal requested', 'progress'], acknowledged: ['Opened by subcontractor', 'progress'],
  replacement_received: ['New version needs review', 'progress'], replacement_rejected: ['Replacement rejected', 'blocked'], renewed: ['Renewed', 'ok'],
};
const WINDOWS = [
  { value: 'expired', label: 'Expired', test: (d: number) => d < 0 }, { value: '7', label: 'Within 7 days', test: (d: number) => d >= 0 && d <= 7 },
  { value: '30', label: 'Within 30 days', test: (d: number) => d >= 0 && d <= 30 }, { value: '60', label: 'Within 60 days', test: (d: number) => d >= 0 && d <= 60 },
  { value: '90', label: 'Within 90 days', test: (d: number) => d >= 0 && d <= 90 },
];

export default function Renewals() {
  const { can, me } = useSession();
  const [params, setParams] = useSearchParams();
  const win = params.get('window') ?? 'open';
  const { data, error, loading, reload } = useApi<any>('renewals.list', { days: 365 });
  const [project, setProject] = useState('');
  const [sub, setSub] = useState('');
  const [category, setCategory] = useState('');
  const [stage, setStage] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const request = useMutation('renewals.request');
  const toast = useToast();
  const items: any[] = data?.items ?? [];
  const counts = Object.fromEntries(WINDOWS.map((w) => [w.value, items.filter((i) => i.stage !== 'renewed' && w.test(i.days)).length]));
  const rows = useMemo(() => items.filter((r) => {
    if (win === 'completed') { if (r.stage !== 'renewed') return false; }
    else if (win === 'open') { if (r.stage === 'renewed' || r.days > 90) return false; }
    else { const w = WINDOWS.find((x) => x.value === win); if (!w || !w.test(r.days) || r.stage === 'renewed') return false; }
    return (!project || r.projects.some((p: any) => p.id === project)) && (!sub || r.subcontractorId === sub) && (!category || r.category === category) && (!stage || r.stage === stage);
  }), [items, win, project, sub, category, stage]);
  const paged = usePaged(rows, 25);
  const selectable = rows.filter((r) => ['not_requested', 'replacement_rejected'].includes(r.stage) && r.contacts.length);
  const setWin = (v: string) => { setParams(v === 'open' ? {} : { window: v }); setSel([]); };
  const sched: number[] = me?.org?.settings.reminderSchedule ?? [];
  const before = sched.filter((d) => d > 0), after = sched.filter((d) => d < 0).map((d) => -d);
  const schedule = [before.length ? `${before.join(', ')} days before expiry` : '', sched.includes(0) ? 'on the expiry date' : '', after.length ? `${after.join(', ')} day${after.length === 1 && after[0] === 1 ? '' : 's'} after` : ''].filter(Boolean).join(', ');
  const today = localToday();
  const ask = async (versionIds: string[]) => { const r = await request.run({ versionIds }); const failed = r.results.filter((x: any) => x.error); toast(`${r.results.length - failed.length} renewal request${r.results.length - failed.length === 1 ? '' : 's'} sent${failed.length ? `; ${failed.length} skipped (no contact)` : ''}`); setSel([]); };
  const projects = [...new Map(items.flatMap((i) => i.projects).map((p: any) => [p.id, p])).values()] as any[];
  const subs = [...new Map(items.map((i) => [i.subcontractorId, i.subcontractor])).entries()];
  const cats = [...new Set(items.map((i) => i.category).filter(Boolean))] as string[];
  return (
    <div>
      <PageHeader title="Renewals" description={sched.length ? `Automatic reminders are active: subcontractors are emailed ${schedule}, once each. Each row shows what happens next.` : 'Automatic reminders are off, so renewals need requesting by hand.'}
        actions={<>
          <button className="btn-secondary" disabled={!rows.length} onClick={() => exportCsv('Renewals', [{ key: 'subcontractor', label: 'Subcontractor' }, { key: 'title', label: 'Document' }, { key: 'category', label: 'Category' }, { key: 'projectsText', label: 'Projects' }, { key: 'expiryDate', label: 'Expiry' }, { key: 'days', label: 'Days' }, { key: 'stageText', label: 'Stage' }], rows.map((r) => ({ ...r, projectsText: r.projects.map((p: any) => p.name).join('; '), stageText: stageOf(r, today)[0] })))}>Export CSV</button>
          {can('requests.send') && sel.length > 0 && <button className="btn-secondary" disabled={request.busy} onClick={() => ask(sel)}>{request.busy && <Spinner />}Request now ({sel.length})</button>}
        </>} />
      <div className="flex gap-6 border-b border-line overflow-x-auto mb-6" role="tablist" aria-label="Expiry window">
        {[{ value: 'open', label: 'All open' }, ...WINDOWS, { value: 'completed', label: 'Completed' }].map((w) => (
          <button key={w.value} role="tab" aria-selected={win === w.value} onClick={() => setWin(w.value)} className={cx('pb-3 pt-1 border-b-2 -mb-px whitespace-nowrap text-[0.9375rem]', win === w.value ? 'border-accent font-medium' : 'border-transparent text-muted hover:text-ink')}>
            {w.label}{counts[w.value] !== undefined && <span className="ml-1.5 text-faint tnum font-normal">{counts[w.value]}</span>}
          </button>
        ))}
      </div>
      <Toolbar>
        {projects.length > 0 && <FilterSelect label="Project" value={project} onChange={setProject} options={projects.map((p) => ({ value: p.id, label: p.name }))} />}
        {subs.length > 1 && <FilterSelect label="Subcontractor" value={sub} onChange={setSub} options={subs.map(([id, n]) => ({ value: id, label: n }))} />}
        {cats.length > 1 && <FilterSelect label="Category" value={category} onChange={setCategory} options={cats.map((c) => ({ value: c, label: c }))} />}
        <FilterSelect label="Stage" value={stage} onChange={setStage} options={Object.entries(STAGES).map(([k, [l]]) => ({ value: k, label: l }))} />
      </Toolbar>
      <FormError error={request.error} />
      {loading && !data ? <Skeleton /> : error ? <ErrorState error={error} onRetry={reload} /> : rows.length === 0 ? (
        <Empty title={win === 'completed' ? 'No completed renewals yet' : 'Nothing to renew here'}>{win === 'completed' ? 'Renewed documents appear here once the replacement is approved.' : 'No approved documents fall in this window.'}</Empty>
      ) : (
        <>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="table min-w-[980px]">
              <thead><tr>
                <th className="th w-10">{can('requests.send') && selectable.length > 0 && <Checkbox checked={sel.length > 0 && sel.length === selectable.length} onChange={(v) => setSel(v ? selectable.map((r) => r.versionId) : [])} label={<span className="sr-only">Select all</span>} />}</th>
                <th className="th">Document</th><th className="th">Subcontractor</th><th className="th">Projects</th><th className="th">Expiry</th><th className="th">Stage</th><th className="th"><span className="sr-only">Next step</span></th>
              </tr></thead>
              <tbody>{paged.slice.map((r) => {
                const [label, tone] = stageOf(r, today);
                const canSelect = selectable.includes(r) && can('requests.send');
                return (
                  <tr key={r.versionId}>
                    <td className="td">{canSelect && <Checkbox checked={sel.includes(r.versionId)} onChange={(v) => setSel(v ? [...sel, r.versionId] : sel.filter((x) => x !== r.versionId))} label={<span className="sr-only">Select {r.title}</span>} />}</td>
                    <td className="td"><Link to={`/app/documents/${r.documentId}`} className="font-medium hover:underline underline-offset-4">{r.title}</Link><div className="text-sm text-faint">{r.category}{r.issuer ? ` · ${r.issuer}` : ''}</div></td>
                    <td className="td"><Link to={`/app/subcontractors/${r.subcontractorId}`} className="hover:underline underline-offset-4">{r.subcontractor}</Link>{!r.contacts.length && <div className="text-sm font-medium flex items-center gap-1.5 mt-0.5"><Glyph tone="blocked" className="w-3 h-3" />No contact on file</div>}</td>
                    <td className="td text-sm text-muted">{r.projects.map((p: any) => p.name).join(', ') || '—'}</td>
                    <td className="td whitespace-nowrap tnum"><div className={cx(r.days <= 14 && 'font-medium')}>{formatDate(r.expiryDate)}</div><div className="text-sm text-muted">{r.days < 0 ? `${-r.days} days ago` : r.days === 0 ? 'Today' : `In ${r.days} days`}</div></td>
                    <td className="td"><span className={cx('inline-flex items-center gap-2 text-sm', toneText(tone))}><Glyph tone={tone} className="w-3.5 h-3.5" />{label}</span>{r.request && <div className="text-xs text-faint mt-1">{r.request.contactEmail} · {formatDateTime(r.request.createdAt)}</div>}</td>
                    <td className="td text-right whitespace-nowrap">
                      <span className="inline-flex items-center justify-end gap-2">
                        {r.replacementVersionId && r.stage === 'replacement_received' ? <Link className="btn-secondary btn-sm" to={`/app/reviews/${r.replacementVersionId}`}>Review replacement</Link>
                          : canSelect && (r.followUp?.kind === 'manual' || r.stage === 'replacement_rejected') ? <button className="btn-secondary btn-sm" disabled={request.busy} onClick={() => ask([r.versionId])}>Request renewal</button> : null}
                        {canSelect && r.followUp?.kind !== 'manual' && r.stage !== 'replacement_rejected' && <Menu trigger={(t) => <MoreButton label={`Actions for ${r.title}`} {...t} />} items={[{ label: 'Request now', onClick: () => ask([r.versionId]) }]} />}
                      </span>
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <Pagination {...paged} />
        </>
      )}
      {data?.reminders?.length > 0 && (
        <details className="mt-10">
          <summary className="cursor-pointer font-medium">Automatic reminder log <span className="text-faint font-normal">({data.reminders.length} most recent)</span></summary>
          <ul className="mt-3 border-t border-line">{data.reminders.map((r: any) => (
            <li key={r.id} className="py-2.5 border-b border-line text-sm flex flex-wrap gap-x-5"><span className="w-20">{humanize(r.status)}</span><span>{r.type === 'escalation' ? 'Escalation to project manager' : r.offset > 0 ? `${r.offset}-day reminder` : r.offset === 0 ? 'Expiry-day reminder' : `${-r.offset} days after expiry`}</span><span className="text-faint">{formatDateTime(r.at)}</span>{r.error && <span className="font-medium">{r.error}</span>}</li>
          ))}</ul>
        </details>
      )}
    </div>
  );
}

/** The stage, said as what happens next: "Reminder on 30 Nov", "Renewal requested today". */
function stageOf(r: any, today: string): [string, 'none' | 'progress' | 'attention' | 'blocked' | 'ok'] {
  if (r.stage === 'not_requested') {
    const t = followUpText(r.followUp, today);
    if (t) return [t, 'progress'];
    return [r.followUp?.kind === 'manual' ? `Not requested — ${MANUAL_WHY[r.followUp.why]?.toLowerCase() ?? 'needs requesting'}` : 'Not requested', r.days < 0 ? 'blocked' : 'attention'];
  }
  if (r.stage === 'requested' && r.request) return [followUpText({ kind: 'renewal_requested', at: r.request.createdAt, acknowledged: false }, today)!, 'progress'];
  return STAGES[r.stage] ?? [humanize(r.stage), 'none'];
}
