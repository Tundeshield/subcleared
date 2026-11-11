import { useNavigate } from 'react-router-dom';
import { formatDateTime } from '../../domain/dates';
import { useApi } from '../../lib/api';
import { Empty, ErrorState, Glyph, PageHeader, Pagination, Skeleton, usePaged } from '../../ui';

export default function Reviews() {
  const { data, error, loading, reload } = useApi<any>('reviews.queue');
  const paged = usePaged(data?.items ?? [], 25);
  const nav = useNavigate();
  return (
    <div>
      <PageHeader title="Reviews" description="Submissions waiting for a decision, oldest first. A document doesn't count toward readiness until it's approved." />
      {loading && !data ? <Skeleton /> : error ? <ErrorState error={error} onRetry={reload} /> : data.items.length === 0 ? (
        <Empty title="Nothing to review">New submissions appear here as soon as they pass security checks.</Empty>
      ) : (
        <>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="table min-w-[880px]">
              <thead><tr><th className="th">Document</th><th className="th">Subcontractor</th><th className="th">Submitted</th><th className="th">Waiting</th><th className="th">Extracted details</th><th className="th">Reviewer</th></tr></thead>
              <tbody>{paged.slice.map((r: any) => (
                <tr key={r.versionId} className="tr-link" onClick={() => nav(`/app/reviews/${r.versionId}`)}>
                  <td className="td"><div className="font-medium">{r.requirement ?? r.title}</div><div className="text-sm text-faint">{r.fileName} · version {r.versionNumber}{r.replacing ? ' · replaces approved version' : ''}</div></td>
                  <td className="td">{r.subcontractor}</td>
                  <td className="td text-muted"><div>{formatDateTime(r.uploadedAt)}</div><div className="text-sm text-faint">{r.uploadedBy.name.replace(/ \(.+\)$/, '')}</div></td>
                  <td className="td tnum">{r.ageHours < 24 ? `${r.ageHours} h` : <span className={r.ageHours > 72 ? 'font-medium' : ''}>{Math.floor(r.ageHours / 24)} days</span>}</td>
                  <td className="td text-sm text-muted">{r.extraction === 'completed' ? 'Proposed — needs confirming' : r.extraction === 'failed' ? 'Couldn’t read — enter manually' : r.extraction === 'not_configured' ? 'Enter manually' : 'Reading…'}</td>
                  <td className="td text-sm">{r.lockedBy ? <span className="flex items-center gap-1.5"><Glyph tone="progress" className="w-3 h-3" />{r.lockedBy.name}</span> : <span className="text-faint">Unclaimed</span>}</td>
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
