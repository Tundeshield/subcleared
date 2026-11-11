import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { term } from '../../domain/locale';
import { ROLE_LABELS } from '../../domain/permissions';
import { api, useApi } from '../../lib/api';
import { auth } from '../../lib/auth';
import { applyPrefs, readPrefs, useSession } from '../../lib/session';
import { cx, Dialog, Drawer, Glyph, Icon, Logo, Segmented, Spinner } from '../../ui';

type NavItem = { to: string; label: string; perm?: string; count?: 'reviews' };
const WORKSPACE: NavItem[] = [
  { to: 'overview', label: 'Overview' }, { to: 'projects', label: 'Projects' }, { to: 'subcontractors', label: 'Subcontractors' },
  { to: 'documents', label: 'Documents' }, { to: 'reviews', label: 'Reviews', perm: 'documents.review', count: 'reviews' },
  { to: 'renewals', label: 'Renewals' }, { to: 'reports', label: 'Reports', perm: 'reports.view' },
];
const CONFIG: NavItem[] = [{ to: 'requirements', label: 'Requirements & templates' }];
const ADMIN: NavItem[] = [{ to: 'team', label: 'Team and permissions' }, { to: 'settings', label: 'Settings' }, { to: 'billing', label: 'Billing' }];

export default function AppLayout() {
  const { me, can, switchOrg } = useSession();
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const notif = useApi<{ unread: number }>('notifications.list', { limit: 1, unreadOnly: true }, [loc.pathname]);
  const queue = useApi<{ items: any[] }>(can('documents.review') ? 'reviews.queue' : null, {}, [loc.pathname]);
  useEffect(() => setNavOpen(false), [loc.pathname]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      if (e.key === '/' && !(e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const org = me!.org!;
  const sub = org.subscription;
  const trialDays = sub.status === 'trialing' && sub.trialEndsAt ? Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86_400_000) : null;
  const inactive = ['canceled', 'incomplete'].includes(sub.status) || (trialDays !== null && trialDays <= 0);
  const reviewCount = queue.data?.items.length ?? 0;

  const item = (n: NavItem) => (
    <li key={n.to}>
      <NavLink to={`/app/${n.to}`} className={({ isActive }) => cx('relative flex items-center justify-between rounded px-3 h-9 text-[0.9375rem] transition-colors',
        isActive ? 'text-accent font-medium bg-accent-tint before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[2px] before:bg-accent before:rounded-full' : 'text-muted hover:text-ink')}>
        {n.label}
        {n.count === 'reviews' && reviewCount > 0 && <span className="text-xs tnum text-muted" aria-label={`${reviewCount} awaiting review`}>{reviewCount}</span>}
      </NavLink>
    </li>
  );

  const sidebar = (
    <nav className="flex flex-col h-full" aria-label="Main">
      <div className="h-16 flex items-center px-5"><Link to="/app/overview" aria-label="SubCleared overview"><Logo /></Link></div>
      <div className="px-5 pb-4">
        {me!.memberships.filter((m) => m.status === 'active').length > 1 ? (
          <select className="input h-9 text-sm" value={org.id} onChange={(e) => switchOrg(e.target.value).then(() => nav('/app/overview'))} aria-label="Switch organisation">
            {me!.memberships.filter((m) => m.status === 'active').map((m) => <option key={m.orgId} value={m.orgId}>{m.orgName}</option>)}
          </select>
        ) : <div><div className="text-sm font-medium truncate">{org.name}</div><div className="text-xs text-faint">{ROLE_LABELS[me!.member!.role]}</div></div>}
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 pb-6">
        <div className="eyebrow px-3 pt-3 pb-2">Workspace</div>
        <ul className="space-y-0.5">{WORKSPACE.filter((n) => !n.perm || can(n.perm as any)).map(item)}</ul>
        <div className="eyebrow px-3 pt-7 pb-2">Configuration</div>
        <ul className="space-y-0.5">{CONFIG.map(item)}</ul>
        <div className="eyebrow px-3 pt-7 pb-2">Administration</div>
        <ul className="space-y-0.5">{ADMIN.map(item)}</ul>
      </div>
      {me!.mode === 'memory' && <div className="mx-5 mb-5 text-xs text-faint leading-relaxed">Local development backend · <a className="link" href="/dev/mailbox" target="_blank" rel="noreferrer">dev mailbox</a></div>}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] btn-primary">Skip to content</a>
      <aside className="hidden lg:block border-r border-line h-screen sticky top-0">{sidebar}</aside>
      {navOpen && <div className="lg:hidden fixed inset-0 z-40"><div className="absolute inset-0 bg-ink/30" onClick={() => setNavOpen(false)} /><aside className="absolute left-0 top-0 bottom-0 w-72 bg-canvas border-r border-line slide-in">{sidebar}</aside></div>}
      <div className="min-w-0 flex flex-col">
        <header className="h-16 bg-canvas/95 backdrop-blur sticky top-0 z-30 flex items-center gap-1.5 sm:gap-3 px-4 sm:px-6 lg:px-10 border-b border-line">
          <button className="lg:hidden btn-ghost -ml-2 px-2" onClick={() => setNavOpen(true)} aria-label="Open navigation">{Icon.menu()}</button>
          <Link to="/app/overview" className="lg:hidden" aria-label="Overview"><Logo /></Link>
          <button onClick={() => setSearchOpen(true)} className="hidden sm:flex flex-1 max-w-md h-10 rounded border border-line bg-paper px-3 items-center gap-2.5 text-sm text-faint hover:border-line-strong transition-colors" aria-label="Search">
            {Icon.search()}<span className="flex-1 text-left truncate">Search projects, subcontractors, documents, contacts</span><span className="kbd">⌘K</span>
          </button>
          <div className="flex-1" />
          <button className="sm:hidden btn-ghost px-2" onClick={() => setSearchOpen(true)} aria-label="Search">{Icon.search('w-5 h-5')}</button>
          <button className="btn-ghost px-2" onClick={() => setHelpOpen(true)} aria-label="Help">{Icon.help()}</button>
          <Link to="/app/notifications" className="btn-ghost px-2 relative" aria-label={`Notifications${notif.data?.unread ? `, ${notif.data.unread} unread` : ''}`}>
            {Icon.bell()}{notif.data?.unread ? <span className="absolute top-2 right-1.5 min-w-[1rem] h-4 px-1 rounded-full bg-accent text-canvas text-[0.625rem] leading-4 text-center tnum">{notif.data.unread > 9 ? '9+' : notif.data.unread}</span> : null}
          </Link>
          <UserMenu />
        </header>
        {(trialDays !== null || inactive || sub.status === 'past_due' || org.hasSample) && (
          <div className="px-4 sm:px-6 lg:px-10 py-2.5 text-sm border-b border-line flex flex-wrap items-center gap-x-6 gap-y-1 text-muted">
            {org.hasSample && <span className="flex items-center gap-2"><Glyph tone="none" className="w-3.5 h-3.5" />This workspace includes sample data, labelled “Sample”. <Link className="link" to="/app/settings/data">Remove it</Link></span>}
            {(inactive || sub.status === 'past_due') ? <span className="flex items-center gap-2 text-ink font-medium"><Glyph tone="blocked" className="w-3.5 h-3.5" />{inactive ? 'Subscription inactive — existing records stay available; adding new records is paused.' : 'Your last payment failed.'} {can('billing.manage') && <Link className="link font-normal" to="/app/billing">Manage billing</Link>}</span>
              : trialDays !== null && <span>Free trial · {trialDays} day{trialDays === 1 ? '' : 's'} left {can('billing.manage') && <Link className="link ml-1" to="/app/billing">Choose a plan</Link>}</span>}
          </div>
        )}
        <main id="main" className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-8 lg:py-10 w-full max-w-content mx-auto" tabIndex={-1}><Outlet /></main>
      </div>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} market={org.settings.market} />
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
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  const setScale = (textScale: number) => { const n = applyPrefs({ textScale }); setPrefs({ textScale: n.textScale }); api('me.update', { textScale }).catch(() => undefined); };
  const initials = (me!.user.name || me!.user.email).split(/[\s@.]+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');
  return (
    <div className="relative" ref={ref}>
      <button className="h-9 w-9 rounded-full bg-ink text-canvas text-xs font-medium tracking-wide ml-1" onClick={() => setOpen((o) => !o)} aria-label="Account and display settings" aria-expanded={open}>{initials}</button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-md bg-paper border border-line shadow-pop p-4 fade-in z-40">
          <div className="pb-3 border-b border-line"><div className="font-medium truncate">{me!.user.name || me!.user.email}</div><div className="text-sm text-muted truncate">{me!.user.email}</div><div className="text-xs text-faint mt-0.5">{ROLE_LABELS[me!.member!.role]} · {me!.org!.name}</div></div>
          <div className="py-3 border-b border-line">
            <div className="text-xs text-muted mb-2">Text size</div>
            <Segmented size="sm" label="Text size" value={String(prefs.textScale)} onChange={(v) => setScale(Number(v))} options={[{ value: '1', label: 'Standard' }, { value: '1.125', label: 'Large' }, { value: '1.25', label: 'Larger' }, { value: '1.375', label: 'Largest' }]} />
          </div>
          <div className="pt-2 flex flex-col">
            <Link to="/app/settings/profile" className="btn-ghost justify-start px-2" onClick={() => setOpen(false)}>Profile and notifications</Link>
            <button className="btn-ghost justify-start px-2" onClick={async () => { await auth.signOut(); await refresh(); nav('/login'); }}>Sign out</button>
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
    ['Projects', res.projects, (p) => [p.name, p.code, `/app/projects/${p.id}`]],
    ['Subcontractors', res.subcontractors.filter((s: any) => !s.match), (s) => [s.name, s.trade, `/app/subcontractors/${s.id}`]],
    ['Contacts', res.subcontractors.filter((s: any) => s.match), (s) => [s.match, s.name, `/app/subcontractors/${s.id}`]],
    ['Documents', res.documents, (d) => [d.title, d.subcontractor, `/app/documents/${d.id}`]],
    ['Requirements', res.requirements, (r) => [r.name, r.category, `/app/requirements?highlight=${r.id}`]],
  ] : [];
  const total = groups.reduce((n, g) => n + g[1].length, 0);
  return (
    <Dialog open={open} onClose={onClose} title="Search" width="max-w-2xl">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">{busy ? <Spinner /> : Icon.search()}</span>
        <input autoFocus className="input pl-9 h-11" placeholder="Project, company, contact email, policy or reference number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search query" />
      </div>
      <div className="mt-4 max-h-[55vh] overflow-y-auto">
        {q.trim().length < 2 && <p className="text-sm text-faint py-3">Type at least two characters.</p>}
        {res && total === 0 && <p className="text-sm text-muted py-3">Nothing matches “{q}”.</p>}
        {groups.filter((g) => g[1].length).map(([label, items, fmt]) => (
          <div key={label} className="mb-4">
            <div className="eyebrow mb-1">{label}</div>
            {items.map((it: any, i: number) => { const [t, s, p] = fmt(it); return (
              <button key={`${p}-${i}`} onClick={() => go(p)} className="w-full text-left rounded px-2 py-2.5 hover:bg-raised flex items-baseline justify-between gap-4 border-b border-line last:border-0">
                <span className="truncate">{t}</span><span className="text-sm text-faint truncate">{s}</span>
              </button>
            ); })}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function HelpDrawer({ open, onClose, market }: { open: boolean; onClose: () => void; market?: any }) {
  const support = import.meta.env.VITE_SUPPORT_EMAIL as string | undefined;
  return (
    <Drawer open={open} onClose={onClose} title="Help" description="How SubCleared decides whether a subcontractor is ready to work." width="max-w-lg">
      <div className="space-y-8 text-base leading-relaxed">
        <section>
          <h3 className="font-semibold mb-3">Readiness, per project</h3>
          <p className="text-muted">Each project lists its own requirements. A subcontractor is assessed separately on every project they're assigned to, so they can be ready for one and not another.</p>
          <ul className="mt-4 space-y-3">
            {[['ok', 'Ready', 'Every mandatory requirement is approved and in date.'], ['attention', 'Action required', 'Nothing is blocking, but something needs attention — a document awaiting review or expiring soon.'], ['blocked', 'Not ready', 'At least one mandatory requirement is missing, rejected or expired.'], ['none', 'Not evaluated', 'The project has no requirements yet.']].map(([t, l, d]) => (
              <li key={l} className="flex gap-3"><Glyph tone={t as any} className="w-4 h-4 mt-1" /><span><span className="font-medium">{l}.</span> <span className="text-muted">{d}</span></span></li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="font-semibold mb-3">Received, reviewed, verified</h3>
          <p className="text-muted">An upload only counts once a reviewer approves it against the requirement. Marking a document independently verified records who confirmed it with the {market === 'UK' ? 'broker, insurer or register' : 'broker, carrier or licensing board'}. A {term(market, 'coi')} is evidence of cover, not proof of it.</p>
        </section>
        <section>
          <h3 className="font-semibold mb-3">Keyboard</h3>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm"><dt><span className="kbd">⌘K</span> or <span className="kbd">/</span></dt><dd className="text-muted">Search</dd><dt><span className="kbd">Esc</span></dt><dd className="text-muted">Close a panel or dialog</dd></dl>
        </section>
        <section>
          <h3 className="font-semibold mb-3">Need a hand?</h3>
          {support ? <a className="btn-secondary" href={`mailto:${support}`}>Email support</a> : <p className="text-muted">Ask your organisation's owner or administrator, who can change requirements, roles and settings.</p>}
        </section>
      </div>
    </Drawer>
  );
}
