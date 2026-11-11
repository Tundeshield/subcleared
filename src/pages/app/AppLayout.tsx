import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '../../domain/permissions';
import { api, useApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { applyPrefs, readPrefs, useSession } from '../../lib/session';
import { cx, Dialog, Icon, Logo, Menu, Segmented, Spinner } from '../../ui';

const NAV: { to: string; label: string; perm?: string }[] = [
  { to: 'overview', label: 'Overview' }, { to: 'projects', label: 'Projects' }, { to: 'subcontractors', label: 'Subcontractors' },
  { to: 'requirements', label: 'Requirements' }, { to: 'documents', label: 'Documents' }, { to: 'reviews', label: 'Reviews', perm: 'documents.review' },
  { to: 'renewals', label: 'Renewals' }, { to: 'compliance', label: 'Compliance' }, { to: 'reports', label: 'Reports', perm: 'reports.view' },
  { to: 'notifications', label: 'Notifications' }, { to: 'settings', label: 'Settings' },
];

export default function AppLayout() {
  const { me, can, switchOrg } = useSession();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const notif = useApi<{ unread: number }>('notifications.list', { limit: 1, unreadOnly: true }, [loc.pathname]);
  const queue = useApi<{ items: any[] }>(can('documents.review') ? 'reviews.queue' : null, {}, [loc.pathname]);
  useEffect(() => setNavOpen(false), [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); } if (e.key === '/' && !(e.target as HTMLElement).closest('input,textarea,select')) { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const org = me!.org!;
  const sub = org.subscription;
  const trialDays = sub.status === 'trialing' && sub.trialEndsAt ? Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86_400_000) : null;
  const inactive = ['canceled', 'incomplete'].includes(sub.status) || (trialDays !== null && trialDays <= 0);
  const counts: Record<string, number | undefined> = { notifications: notif.data?.unread || undefined, reviews: queue.data?.items.length || undefined };

  const sidebar = (
    <nav className="flex flex-col h-full" aria-label="Main">
      <div className="h-14 flex items-center px-4 border-b border-line"><Link to="/app/overview"><Logo /></Link></div>
      <div className="px-3 py-3 border-b border-line">
        {me!.memberships.length > 1 ? (
          <select className="input h-9 text-sm" value={org.id} onChange={(e) => switchOrg(e.target.value).then(() => nav('/app/overview'))} aria-label="Organisation">
            {me!.memberships.filter((m) => m.status === 'active').map((m) => <option key={m.orgId} value={m.orgId}>{m.orgName}</option>)}
          </select>
        ) : <div className="px-1"><div className="text-sm font-medium truncate">{org.name}</div><div className="text-xs text-faint">{ROLE_LABELS[me!.member!.role]}</div></div>}
      </div>
      <ul className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {NAV.filter((n) => !n.perm || can(n.perm as any)).map((n) => (
          <li key={n.to}>
            <NavLink to={`/app/${n.to}`} className={({ isActive }) => cx('flex items-center justify-between rounded px-3 h-9 text-[0.9375rem] transition-colors', isActive ? 'bg-raised text-ink font-medium' : 'text-muted hover:text-ink hover:bg-raised/60')}>
              {n.label}
              {counts[n.to] ? <span className={cx('text-xs tabular-nums rounded px-1.5 py-px', n.to === 'reviews' ? 'bg-info/15 text-info' : 'bg-accent/15 text-accent')}>{counts[n.to]}</span> : null}
            </NavLink>
          </li>
        ))}
      </ul>
      {me!.mode === 'memory' && <div className="m-3 rounded border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">Local development backend. <a className="underline" href="/dev/mailbox" target="_blank">Dev mailbox</a></div>}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_1fr]">
      <aside className="hidden lg:block border-r border-line bg-surface h-screen sticky top-0">{sidebar}</aside>
      {navOpen && <div className="lg:hidden fixed inset-0 z-40"><div className="absolute inset-0 bg-black/60" onClick={() => setNavOpen(false)} /><aside className="absolute left-0 top-0 bottom-0 w-72 bg-surface border-r border-line fade-in">{sidebar}</aside></div>}
      <div className="min-w-0 flex flex-col">
        <header className="h-14 border-b border-line bg-bg/90 backdrop-blur sticky top-0 z-30 flex items-center gap-3 px-4 lg:px-6">
          <button className="lg:hidden btn-ghost -ml-2 px-2" onClick={() => setNavOpen(true)} aria-label="Open navigation">{Icon.menu()}</button>
          <button onClick={() => setSearchOpen(true)} className="flex-1 max-w-md h-9 rounded border border-line bg-surface px-3 flex items-center gap-2 text-sm text-faint hover:border-line-strong">
            {Icon.search()}<span className="flex-1 text-left truncate">Search subcontractors, projects, documents…</span><span className="kbd hidden sm:inline">⌘K</span>
          </button>
          <div className="flex-1" />
          <Link to="/app/notifications" className="btn-ghost px-2 relative" aria-label={`Notifications${counts.notifications ? `, ${counts.notifications} unread` : ''}`}>
            {Icon.bell('w-5 h-5')}{counts.notifications ? <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent" /> : null}
          </Link>
          <UserMenu />
        </header>
        {(trialDays !== null || inactive || sub.status === 'past_due') && (
          <div className={cx('px-4 lg:px-6 py-2 text-sm border-b border-line flex flex-wrap items-center gap-x-3', inactive || sub.status === 'past_due' ? 'bg-bad/5 text-bad' : 'bg-raised/50 text-muted')}>
            {inactive ? 'Your subscription is inactive. Existing records stay available; adding new subcontractors, projects or users is paused.' : sub.status === 'past_due' ? 'Your last payment failed. Update your payment method to avoid interruption.' : `Free trial: ${trialDays} day${trialDays === 1 ? '' : 's'} left.`}
            {can('billing.manage') && <Link className="link" to="/app/settings/billing">{inactive || sub.status === 'past_due' ? 'Manage billing' : 'Choose a plan'}</Link>}
          </div>
        )}
        <main className="flex-1 px-4 lg:px-8 py-6 lg:py-8 max-w-[1500px] w-full mx-auto"><Outlet /></main>
      </div>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function UserMenu() {
  const { me, refresh } = useSession();
  const [prefs, setPrefs] = useState(readPrefs());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const update = (p: Partial<typeof prefs>) => { const next = applyPrefs(p); setPrefs({ theme: next.theme, textScale: next.textScale }); api('me.update', p).catch(() => undefined); };
  const initials = (me!.user.name || me!.user.email).split(/[\s@.]+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');
  return (
    <div className="relative" ref={ref}>
      <button className="h-9 w-9 rounded-full bg-raised border border-line text-sm font-medium" onClick={() => setOpen((o) => !o)} aria-label="Account and display settings" aria-expanded={open}>{initials}</button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-md bg-surface shadow-pop p-3 fade-in z-40">
          <div className="px-1 pb-3 border-b border-line"><div className="font-medium truncate">{me!.user.name || me!.user.email}</div><div className="text-xs text-muted truncate">{me!.user.email}</div></div>
          <div className="py-3 space-y-3 border-b border-line">
            <div><div className="text-xs text-muted mb-1.5">Text size</div>
              <Segmented size="sm" value={String(prefs.textScale)} onChange={(v) => update({ textScale: Number(v) })} options={[{ value: '1', label: 'A' }, { value: '1.125', label: <span className="text-[1.05em]">A</span> }, { value: '1.25', label: <span className="text-[1.15em]">A</span> }, { value: '1.375', label: <span className="text-[1.25em]">A</span> }]} />
            </div>
            <div><div className="text-xs text-muted mb-1.5">Theme</div>
              <Segmented size="sm" value={prefs.theme} onChange={(v) => update({ theme: v })} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} />
            </div>
          </div>
          <div className="pt-2 flex flex-col">
            <Link to="/app/settings/profile" className="btn-ghost justify-start" onClick={() => setOpen(false)}>Profile and notifications</Link>
            <button className="btn-ghost justify-start" onClick={async () => { await auth.signOut(); await refresh(); nav('/login'); }}>Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  useEffect(() => { if (!open) { setQ(''); setRes(null); } }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    setBusy(true);
    const t = setTimeout(() => api('search', { q }).then(setRes).catch(() => setRes(null)).finally(() => setBusy(false)), 180);
    return () => clearTimeout(t);
  }, [q]);
  const go = (p: string) => { onClose(); nav(p); };
  const groups: [string, any[], (x: any) => [string, string, string]][] = res ? [
    ['Subcontractors', res.subcontractors, (s) => [s.name, `${s.trade}${s.match ? ` · ${s.match}` : ''}`, `/app/subcontractors/${s.id}`]],
    ['Projects', res.projects, (p) => [p.name, p.code, `/app/projects/${p.id}`]],
    ['Documents', res.documents, (d) => [d.title, d.subcontractor, `/app/documents/${d.id}`]],
    ['Requirements', res.requirements, (r) => [r.name, r.category, `/app/requirements?highlight=${r.id}`]],
  ] : [];
  const total = groups.reduce((n, g) => n + g[1].length, 0);
  return (
    <Dialog open={open} onClose={onClose} title="Search" width="max-w-xl">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">{busy ? <Spinner /> : Icon.search()}</span>
        <input autoFocus className="input pl-9" placeholder="Name, reference number, contact email…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search query" />
      </div>
      <div className="mt-3 max-h-[55vh] overflow-y-auto">
        {q.trim().length < 2 && <p className="text-sm text-faint px-1 py-4">Type at least two characters. Searches company names, contacts, projects, document titles, reference numbers and requirements.</p>}
        {res && total === 0 && <p className="text-sm text-muted px-1 py-4">No matches for “{q}”.</p>}
        {groups.filter((g) => g[1].length).map(([label, items, fmt]) => (
          <div key={label} className="mb-3">
            <div className="eyebrow px-1 mb-1">{label}</div>
            {items.map((it: any) => { const [t, s, p] = fmt(it); return (
              <button key={p} onClick={() => go(p)} className="w-full text-left rounded px-2 py-2 hover:bg-raised flex items-baseline justify-between gap-3">
                <span className="truncate">{t}</span><span className="text-xs text-faint truncate">{s}</span>
              </button>
            ); })}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

export { Menu };
