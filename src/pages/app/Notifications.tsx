import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../../domain/dates';
import { useApi, useMutation } from '../../lib/api';
import { cx, Empty, ErrorState, PageHeader, Segmented, Skeleton } from '../../ui';

export default function Notifications() {
  const [view, setView] = useState<'all' | 'unread'>('unread');
  const { data, error, loading, reload } = useApi<any>('notifications.list', { unreadOnly: view === 'unread' });
  const mark = useMutation('notifications.mark');
  return (
    <div>
      <PageHeader title="Notifications" description="Submissions, decisions, expiries, escalations and status changes relevant to you."
        actions={<><Link to="/app/settings/profile" className="btn-ghost">Preferences</Link><button className="btn-secondary" disabled={!data?.unread} onClick={() => mark.run({ all: true })}>Mark all read</button></>} />
      <Segmented value={view} onChange={setView} options={[{ value: 'unread', label: `Unread${data?.unread ? ` (${data.unread})` : ''}` }, { value: 'all', label: 'All' }]} />
      <div className="panel mt-4">
        {loading && !data ? <Skeleton /> : error ? <div className="p-4"><ErrorState error={error} onRetry={reload} /></div> : data.items.length === 0 ? <Empty title={view === 'unread' ? "You're all caught up" : 'No notifications yet'} /> : (
          <ul className="divide-y divide-line">{data.items.map((n: any) => (
            <li key={n.id} className={cx('flex gap-3 px-4 py-3', !n.readAt && 'bg-accent/[0.04]')}>
              <span className={cx('mt-2 w-1.5 h-1.5 rounded-full shrink-0', n.readAt ? 'bg-transparent' : 'bg-accent')} />
              <div className="flex-1 min-w-0">
                {n.link ? <Link to={n.link} onClick={() => !n.readAt && mark.run({ ids: [n.id] })} className="font-medium hover:underline">{n.title}</Link> : <div className="font-medium">{n.title}</div>}
                <p className="text-sm text-muted whitespace-pre-line">{n.body}</p>
                <div className="text-xs text-faint mt-0.5">{formatDateTime(n.createdAt)}</div>
              </div>
              {!n.readAt && <button className="btn-ghost btn-sm self-start" onClick={() => mark.run({ ids: [n.id] })}>Mark read</button>}
            </li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}
