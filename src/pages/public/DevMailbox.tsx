import { useEffect, useState } from 'react';
import { formatDateTime } from '../../domain/dates';
import { Logo } from '../../ui';

/** Local development only: shows emails captured by the dev backend. */
export default function DevMailbox() {
  const [items, setItems] = useState<any[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => fetch('/api/_dev/mail').then((r) => (r.ok ? r.json() : Promise.reject(new Error('The dev mailbox is only available with the local development backend.')))).then((j) => setItems(j.items)).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, []);
  return (
    <div className="max-w-4xl mx-auto px-5 py-8">
      <div className="flex items-center justify-between mb-6"><Logo /><span className="text-xs text-faint">Development mailbox — not available in production</span></div>
      {err && <p className="text-ink">{err}</p>}
      {items?.length === 0 && <p className="text-muted">No emails yet.</p>}
      <div className="panel divide-y divide-line">
        {items?.map((m) => (
          <div key={m.id}>
            <button className="w-full text-left px-4 py-3 hover:bg-raised flex gap-4" onClick={() => setOpen(open === m.id ? null : m.id)}>
              <span className="text-sm text-muted w-56 truncate">{m.to}</span><span className="flex-1 truncate">{m.subject}</span><span className="text-xs text-faint">{formatDateTime(m.at)}</span>
            </button>
            {open === m.id && <div className="px-4 pb-4"><iframe title={m.subject} className="w-full h-[480px] bg-white rounded" srcDoc={`<base target="_blank">${m.html}`} sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" /></div>}
          </div>
        ))}
      </div>
    </div>
  );
}
