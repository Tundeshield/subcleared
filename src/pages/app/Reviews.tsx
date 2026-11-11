import { useNavigate } from 'react-router-dom';
import { formatDateTime } from '../../domain/dates';
import { useApi } from '../../lib/api';
import { cx, Empty, ErrorState, PageHeader, Skeleton } from '../../ui';

export default function Reviews() {
  const { data, error, loading, reload } = useApi<any>('reviews.queue');
  const nav = useNavigate();
  return (
    <div>
      <PageHeader title="Reviews" description="Submitted documents waiting for a decision, oldest first. A document does not count toward readiness until it is approved." />
      <div className="panel overflow-x-auto">
        {loading && !data ? <Skeleton /> : error ? <div className="p-4"><ErrorState error={error} onRetry={reload} /></div> : data.items.length === 0 ? (
          <Empty title="Review queue is clear">New submissions appear here as soon as they pass security checks.</Empty>
        ) : (
          <table className="w-full min-w-[860px]">
            <thead><tr><th className="th">Document</th><th className="th">Subcontractor</th><th className="th">Submitted</th><th className="th">Waiting</th><th className="th">AI extraction</th><th className="th">Reviewer</th></tr></thead>
            <tbody>{data.items.map((r: any) => (
              <tr key={r.versionId} className="tr-link" onClick={() => nav(`/app/reviews/${r.versionId}`)}>
                <td className="td"><div className="font-medium">{r.requirement ?? r.title}</div><div className="text-xs text-faint">{r.fileName} · v{r.versionNumber}{r.replacing ? ' · replacement' : ''}</div></td>
                <td className="td">{r.subcontractor}</td>
                <td className="td text-muted"><div>{formatDateTime(r.uploadedAt)}</div><div className="text-xs text-faint">{r.uploadedBy.name}</div></td>
                <td className={cx('td tabular-nums', r.ageHours > 72 ? 'text-bad' : r.ageHours > 24 ? 'text-warn' : 'text-muted')}>{r.ageHours < 24 ? `${r.ageHours} h` : `${Math.floor(r.ageHours / 24)} d`}</td>
                <td className="td text-muted">{r.extraction === 'completed' ? 'Fields proposed' : r.extraction === 'not_configured' ? 'Manual entry' : r.extraction === 'failed' ? <span className="text-warn">Failed — manual entry</span> : r.extraction}</td>
                <td className="td">{r.lockedBy ? <span className="text-info">{r.lockedBy.name} is reviewing</span> : <span className="text-faint">Unclaimed</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
