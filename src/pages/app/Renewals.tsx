import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { useApi, useMutation } from '../../lib/api';
import { exportCsv } from '../../lib/export';
import { useSession } from '../../lib/session';
import { Checkbox, cx, Empty, ErrorState, FormError, humanize, PageHeader, Segmented, Skeleton, Spinner, useToast } from '../../ui';

const STAGES: Record<string, [string, string]> = {
  not_requested: ['Not requested', 'text-muted'], requested: ['Requested', 'text-info'], acknowledged: ['Opened by subcontractor', 'text-info'],
  replacement_received: ['Replacement received', 'text-warn'], replacement_rejected: ['Replacement rejected', 'text-bad'], renewed: ['Renewed', 'text-ok'],
};

export default function Renewals() {
  const { can, me } = useSession();
  const [days, setDays] = useState(90);
  const { data, error, loading, reload } = useApi<any>('renewals.list', { days });
  const [view, setView] = useState<'open' | 'all'>('open');
  const [sel, setSel] = useState<string[]>([]);
  const request = useMutation('renewals.request');
  const toast = useToast();
  const rows = useMemo(() => (data?.items ?? []).filter((r: any) => view === 'all' || r.stage !== 'renewed'), [data, view]);
  const selectable = rows.filter((r: any) => ['not_requested', 'replacement_rejected'].includes(r.stage) && r.contacts.length);
  return (
    <div>
      <PageHeader title="Renewals" description={`Approved documents expiring within ${days} days, and where each renewal stands. Reminders go out automatically at ${me?.org?.settings.reminderSchedule.map((d: number) => (d > 0 ? `${d}` : d === 0 ? 'expiry' : `${-d} after`)).join(', ')} days.`}
        actions={<>
          <button className="btn-secondary" disabled={!rows.length} onClick={() => exportCsv('Renewals', [{ key: 'subcontractor', label: 'Subcontractor' }, { key: 'title', label: 'Document' }, { key: 'expiryDate', label: 'Expiry' }, { key: 'days', label: 'Days' }, { key: 'stage', label: 'Stage' }], rows)}>Export CSV</button>
          {can('requests.send') && <button className="btn-primary" disabled={!sel.length || request.busy} onClick={async () => { const r = await request.run({ versionIds: sel }); const failed = r.results.filter((x: any) => x.error); toast(`${r.results.length - failed.length} renewal request${r.results.length - failed.length === 1 ? '' : 's'} sent${failed.length ? `; ${failed.length} skipped (no contact)` : ''}`); setSel([]); }}>{request.busy && <Spinner />}Request renewal{sel.length ? ` (${sel.length})` : ''}</button>}
        </>} />
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <Segmented value={view} onChange={setView} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'Include renewed' }]} />
        <select className="input h-9 w-auto text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window">{[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>Next {d} days (and expired)</option>)}</select>
      </div>
      <FormError error={request.error} />
      <div className="panel overflow-x-auto">
        {loading && !data ? <Skeleton /> : error ? <div className="p-4"><ErrorState error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          <Empty title="Nothing to renew">No approved documents expire in this window.</Empty>
        ) : (
          <table className="w-full min-w-[900px]">
            <thead><tr>
              <th className="th w-10">{can('requests.send') && selectable.length > 0 && <Checkbox checked={sel.length === selectable.length} onChange={(v) => setSel(v ? selectable.map((r: any) => r.versionId) : [])} label={<span className="sr-only">Select all</span>} />}</th>
              <th className="th">Document</th><th className="th">Subcontractor</th><th className="th">Expiry</th><th className="th">Stage</th><th className="th">Request</th><th className="th" />
            </tr></thead>
            <tbody>{rows.map((r: any) => {
              const [label, tone] = STAGES[r.stage] ?? [humanize(r.stage), 'text-muted'];
              const canSelect = selectable.includes(r);
              return (
                <tr key={r.versionId}>
                  <td className="td">{canSelect && can('requests.send') && <Checkbox checked={sel.includes(r.versionId)} onChange={(v) => setSel(v ? [...sel, r.versionId] : sel.filter((x) => x !== r.versionId))} label={<span className="sr-only">Select {r.title}</span>} />}</td>
                  <td className="td"><Link to={`/app/documents/${r.documentId}`} className="font-medium hover:underline">{r.title}</Link><div className="text-xs text-faint">{r.requirement}</div></td>
                  <td className="td"><Link to={`/app/subcontractors/${r.subcontractorId}`} className="hover:underline">{r.subcontractor}</Link>{!r.contacts.length && <div className="text-xs text-bad">No contact on file</div>}</td>
                  <td className={cx('td whitespace-nowrap tabular-nums', r.days < 0 ? 'text-bad' : r.days <= 14 ? 'text-bad' : r.days <= 30 ? 'text-warn' : 'text-muted')}>{formatDate(r.expiryDate)}<div className="text-xs">{r.days < 0 ? `${-r.days} days ago` : r.days === 0 ? 'Today' : `in ${r.days} days`}</div></td>
                  <td className={cx('td', tone)}>{label}</td>
                  <td className="td text-xs text-muted">{r.request ? <>{r.request.contactEmail}<div>{formatDateTime(r.request.createdAt)}{r.request.acknowledgedAt ? ` · opened ${formatDateTime(r.request.acknowledgedAt)}` : ''}</div></> : '—'}</td>
                  <td className="td text-right">{r.replacementVersionId && r.stage === 'replacement_received' && <Link className="btn-secondary btn-sm" to={`/app/reviews/${r.replacementVersionId}`}>Review replacement</Link>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      {data?.reminders?.length > 0 && (
        <details className="mt-6 panel">
          <summary className="px-4 py-3 cursor-pointer text-sm font-medium">Recent automatic reminders ({data.reminders.length})</summary>
          <ul className="divide-y divide-line border-t border-line">{data.reminders.map((r: any) => (
            <li key={r.id} className="px-4 py-2 text-sm flex flex-wrap gap-x-4"><span className={cx(r.status === 'failed' ? 'text-bad' : r.status === 'skipped' ? 'text-faint' : 'text-muted')}>{humanize(r.status)}</span><span>{r.type === 'escalation' ? 'Escalation' : r.offset > 0 ? `${r.offset}-day reminder` : r.offset === 0 ? 'Expiry-day reminder' : `${-r.offset} days after expiry`}</span><span className="text-faint">{formatDateTime(r.at)}</span>{r.error && <span className="text-bad text-xs">{r.error}</span>}</li>
          ))}</ul>
        </details>
      )}
    </div>
  );
}
