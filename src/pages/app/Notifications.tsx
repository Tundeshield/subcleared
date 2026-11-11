import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../../domain/dates';
import { useApi, useMutation } from '../../lib/api';
import { cx, Empty, ErrorState, PageHeader, Pagination, Segmented, Skeleton, usePaged } from '../../ui';

export default function Notifications() {
  const [view, setView] = useState<'unread' | 'all'>('unread');
  const { data, error, loading, reload } = useApi<any>('notifications.list', { unreadOnly: view === 'unread', limit: 300 });
  const mark = useMutation('notifications.mark');
  const paged = usePaged(data?.items ?? [], 30);
  return (
    <div>
      <PageHeader title="Notifications" description="Submissions, decisions, expiries and escalations that involve you. Choose what you hear about, and how, in your profile."
        actions={<><Link to="/app/settings/profile" className="btn-ghost">Preferences</Link><button className="btn-secondary" disabled={!data?.unread} onClick={() => mark.run({ all: true })}>Mark all as read</button></>} />
      <Segmented label="Show" value={view} onChange={setView} options={[{ value: 'unread', label: `Unread${data?.unread ? ` (${data.unread})` : ''}` }, { value: 'all', label: 'All' }]} />
      <div className="mt-6">
        {loading && !data ? <Skeleton /> : error ? <ErrorState error={error} onRetry={reload} /> : data.items.length === 0 ? <Empty title={view === 'unread' ? "You're all caught up" : 'No notifications yet'} /> : (
          <>
            <ul className="border-t border-charcoal/80">{paged.slice.map((n: any) => (
              <li key={n.id} className="flex gap-4 py-4 border-b border-line">
                <span className={cx('mt-2 w-2 h-2 rounded-full shrink-0', n.readAt ? 'bg-transparent' : 'bg-field')} aria-label={n.readAt ? undefined : 'Unread'} />
                <div className="flex-1 min-w-0">
                  {n.link ? <Link to={n.link} onClick={() => !n.readAt && mark.run({ ids: [n.id] })} className={cx('hover:underline underline-offset-4', !n.readAt && 'font-medium')}>{n.title}</Link> : <div className={cx(!n.readAt && 'font-medium')}>{n.title}</div>}
                  <p className="text-sm text-muted whitespace-pre-line mt-0.5">{n.body}</p>
                  <div className="text-xs text-faint mt-1">{formatDateTime(n.createdAt)}</div>
                </div>
                {!n.readAt && <button className="btn-ghost btn-sm self-start" onClick={() => mark.run({ ids: [n.id] })}>Mark read</button>}
              </li>
            ))}</ul>
            <Pagination {...paged} />
          </>
        )}
      </div>
    </div>
  );
}
