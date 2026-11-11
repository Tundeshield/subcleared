import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { READINESS_LABELS, STATUS_LABELS } from '../domain/compliance';
import type { Readiness, RequirementStatus } from '../domain/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// --- Icons (used sparingly) --------------------------------------------------
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
export const Icon = {
  check: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P}><path d="M3.5 8.5l3 3 6-7" /></svg>,
  x: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P}><path d="M4 4l8 8M12 4l-8 8" /></svg>,
  search: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>,
  chevron: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P}><path d="M6 4l4 4-4 4" /></svg>,
  down: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P}><path d="M4 6l4 4 4-4" /></svg>,
  bell: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P}><path d="M4 11V7a4 4 0 118 0v4l1 1.5H3L4 11zM6.5 14a1.5 1.5 0 003 0" /></svg>,
  upload: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P}><path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10" /></svg>,
  file: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P}><path d="M4 2h5l3 3v9H4V2z" /><path d="M9 2v3h3" /></svg>,
  menu: (c = 'w-5 h-5') => <svg viewBox="0 0 16 16" className={c} {...P}><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>,
  alert: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P}><path d="M8 2l6.5 11.5h-13L8 2z" /><path d="M8 6.5v3M8 11.5v.2" /></svg>,
  dot: (c = 'w-2 h-2') => <svg viewBox="0 0 8 8" className={c}><circle cx="4" cy="4" r="4" fill="currentColor" /></svg>,
  plus: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P}><path d="M8 3v10M3 8h10" /></svg>,
  external: (c = 'w-3.5 h-3.5') => <svg viewBox="0 0 16 16" className={c} {...P}><path d="M9 3h4v4M13 3L7 9M11 9.5V13H3V5h3.5" /></svg>,
};

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2 font-semibold tracking-tight text-ink', className)}>
      <svg viewBox="0 0 32 32" className="w-6 h-6" aria-hidden><rect width="32" height="32" rx="7" className="fill-raised" stroke="rgb(var(--line-strong))" /><path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke="rgb(var(--accent))" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <span className="text-[1.05rem]">SubCleared</span>
    </span>
  );
}

// --- Status --------------------------------------------------------------------
const READINESS_TONE: Record<Readiness, string> = {
  ready: 'text-ok bg-ok/10 border-ok/25', action_required: 'text-warn bg-warn/10 border-warn/25', not_ready: 'text-bad bg-bad/10 border-bad/25', not_evaluated: 'text-muted bg-raised border-line',
};
export function ReadinessBadge({ value, size = 'md' }: { value: Readiness | string; size?: 'sm' | 'md' }) {
  const v = (value in READINESS_TONE ? value : 'not_evaluated') as Readiness;
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded border font-medium whitespace-nowrap', size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-xs px-2 py-1', READINESS_TONE[v])}>
      {Icon.dot('w-1.5 h-1.5')}{READINESS_LABELS[v]}
    </span>
  );
}
const STATUS_TONE: Partial<Record<string, string>> = {
  approved: 'text-ok', expiring_soon: 'text-warn', awaiting_review: 'text-info', submitted: 'text-info', review_required: 'text-warn',
  expired: 'text-bad', rejected: 'text-bad', missing: 'text-bad', overdue: 'text-bad', requested: 'text-warn', not_applicable: 'text-faint', not_requested: 'text-muted',
};
export function StatusText({ value, label }: { value: RequirementStatus | string; label?: string }) {
  return <span className={cx('inline-flex items-center gap-1.5 text-sm whitespace-nowrap', STATUS_TONE[value] ?? 'text-muted')}>{Icon.dot('w-1.5 h-1.5')}{label ?? STATUS_LABELS[value as RequirementStatus] ?? humanize(value)}</span>;
}
const DOC_STATUS: Record<string, [string, string]> = {
  approved: ['Approved', 'text-ok'], approved_replacement_pending: ['Approved · replacement pending', 'text-ok'], expiring_soon: ['Expiring soon', 'text-warn'],
  expiring_replacement_pending: ['Expiring · replacement pending', 'text-warn'], expired: ['Expired', 'text-bad'], expired_replacement_pending: ['Expired · replacement pending', 'text-bad'],
  awaiting_review: ['Awaiting review', 'text-info'], under_review: ['Under review', 'text-info'], submitted: ['Submitted', 'text-info'], rejected: ['Rejected', 'text-bad'],
  info_requested: ['Info requested', 'text-warn'], superseded: ['Superseded', 'text-faint'], archived: ['Archived', 'text-faint'], quarantined: ['Blocked', 'text-bad'], uploading: ['Uploading', 'text-faint'],
};
export function DocStatus({ value }: { value: string }) {
  const [label, tone] = DOC_STATUS[value] ?? [humanize(value), 'text-muted'];
  return <span className={cx('inline-flex items-center gap-1.5 text-sm whitespace-nowrap', tone)}>{Icon.dot('w-1.5 h-1.5')}{label}</span>;
}
export function VerificationLabel({ value }: { value?: string }) {
  if (value === 'independently_verified') return <span className="text-xs text-ok">Independently verified</span>;
  if (value === 'reviewed') return <span className="text-xs text-muted">Reviewed against requirements</span>;
  return <span className="text-xs text-faint">Received, not reviewed</span>;
}
export const humanize = (s: string) => (s ? s.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

// --- Layout ------------------------------------------------------------------------
export function PageHeader({ title, description, actions, eyebrow, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6">
      {eyebrow && <div className="mb-2 text-sm text-muted">{eyebrow}</div>}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {description && <p className="mt-1.5 text-muted max-w-3xl">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Stat({ label, value, tone, hint, onClick, active }: { label: string; value: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'info'; hint?: ReactNode; onClick?: () => void; active?: boolean }) {
  const toneCls = tone && value !== 0 ? { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-info' }[tone] : 'text-ink';
  const El: any = onClick ? 'button' : 'div';
  return (
    <El onClick={onClick} className={cx('text-left px-4 py-3.5 border-line', onClick && 'hover:bg-raised/60 transition-colors', active && 'bg-raised')}>
      <div className="text-xs text-muted">{label}</div>
      <div className={cx('mt-1 text-2xl font-semibold tabular-nums', toneCls)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </El>
  );
}

export function Section({ title, actions, children, className, description }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; description?: ReactNode }) {
  return (
    <section className={cx('panel', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
          <div><h2 className="text-md font-semibold">{title}</h2>{description && <p className="text-xs text-muted mt-0.5">{description}</p>}</div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

// --- States ------------------------------------------------------------------------
export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={cx('animate-spin', className)} aria-label="Loading"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" /><path d="M14 8a6 6 0 00-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return <div className="p-4 space-y-3" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-5" style={{ width: `${92 - (i % 3) * 14}%` }} />)}</div>;
}
export function PageLoading() {
  return <div className="space-y-4"><div className="skeleton h-8 w-64" /><div className="panel"><Skeleton rows={7} /></div></div>;
}
export function ErrorState({ error, onRetry }: { error: { message: string; status?: number } | string; onRetry?: () => void }) {
  const msg = typeof error === 'string' ? error : error.message;
  return (
    <div className="panel p-6 flex items-start gap-3 border-bad/30" role="alert">
      <span className="text-bad mt-0.5">{Icon.alert('w-5 h-5')}</span>
      <div><div className="font-medium">Something went wrong</div><p className="text-muted mt-1">{msg}</p>{onRetry && <button className="btn-secondary btn-sm mt-3" onClick={onRetry}>Try again</button>}</div>
    </div>
  );
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="font-medium">{title}</div>
      {children && <p className="text-muted mt-1.5 max-w-md mx-auto text-sm">{children}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}
export function Callout({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode; title?: ReactNode }) {
  const c = { info: 'border-info/30 bg-info/5', warn: 'border-warn/30 bg-warn/5', bad: 'border-bad/30 bg-bad/5', ok: 'border-ok/30 bg-ok/5' }[tone];
  return <div className={cx('rounded-md border px-4 py-3 text-sm', c)} role={tone === 'bad' ? 'alert' : undefined}>{title && <div className="font-medium mb-0.5">{title}</div>}<div className="text-muted">{children}</div></div>;
}
export function FormError({ error }: { error?: string | null }) {
  if (!error) return null;
  return <div className="rounded border border-bad/30 bg-bad/5 text-bad text-sm px-3 py-2" role="alert">{error}</div>;
}

// --- Form ----------------------------------------------------------------------------
export function Field({ label, hint, children, error, required, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; error?: string; required?: boolean; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}{required && <span className="text-bad ml-0.5" aria-hidden>*</span>}</span>
      {children}
      {error ? <span className="hint text-bad block">{error}</span> : hint ? <span className="hint block">{hint}</span> : null}
    </label>
  );
}
export function Checkbox({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex items-start gap-2.5 cursor-pointer select-none', disabled && 'opacity-60 cursor-not-allowed')}>
      <input type="checkbox" className="mt-1 h-4 w-4 accent-[rgb(var(--accent))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="text-sm">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  );
}
export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded border border-line bg-surface p-0.5" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cx('rounded-[3px] px-3 font-medium transition-colors', size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm', value === o.value ? 'bg-raised text-ink' : 'text-muted hover:text-ink')}>{o.label}</button>
      ))}
    </div>
  );
}
export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: ReactNode; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-line overflow-x-auto" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx('px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors', value === t.value ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-xs text-faint tabular-nums">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// --- Dialog --------------------------------------------------------------------------
export function Dialog({ open, onClose, title, children, footer, width = 'max-w-lg', description }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string; description?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])')?.focus(), 30);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(t); document.removeEventListener('keydown', key); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={cx('relative w-full bg-surface border border-line rounded-t-lg sm:rounded-lg shadow-pop fade-in max-h-[92vh] flex flex-col', width)}>
        <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-line">
          <div><h2 id={id} className="text-lg font-semibold">{title}</h2>{description && <p className="text-sm text-muted mt-0.5">{description}</p>}</div>
          <button data-close className="btn-ghost btn-sm -mr-2" onClick={onClose} aria-label="Close">{Icon.x()}</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({ open, onClose, onConfirm, title, children, confirmLabel = 'Confirm', danger, busy, requireReason, reasonLabel = 'Reason' }: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => void | Promise<void>; title: string; children?: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; requireReason?: boolean; reasonLabel?: string;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Dialog open={open} onClose={onClose} title={title} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className={danger ? 'btn-danger' : 'btn-primary'} disabled={busy || (requireReason && !reason.trim())} onClick={() => onConfirm(reason)}>{busy && <Spinner />}{confirmLabel}</button>
    </>}>
      {children && <div className="text-muted text-sm mb-3">{children}</div>}
      {requireReason && <Field label={reasonLabel} required><textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>}
    </Dialog>
  );
}

// --- Menu ----------------------------------------------------------------------------
export function Menu({ trigger, items, align = 'right' }: { trigger: (p: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode; items: ({ label: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean } | null)[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <div className="relative inline-block" ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open })}
      {open && (
        <div className={cx('absolute z-40 mt-1 min-w-[12rem] rounded-md bg-surface shadow-pop py-1 fade-in', align === 'right' ? 'right-0' : 'left-0')} role="menu">
          {items.filter(Boolean).map((it, i) => (
            <button key={i} role="menuitem" disabled={it!.disabled} onClick={() => { setOpen(false); it!.onClick(); }}
              className={cx('block w-full text-left px-3 py-2 text-sm hover:bg-raised disabled:opacity-50', it!.danger ? 'text-bad' : 'text-ink')}>{it!.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Toasts ---------------------------------------------------------------------------
interface Toast { id: number; message: ReactNode; tone: 'ok' | 'bad' | 'info' }
const ToastCtx = createContext<(m: ReactNode, tone?: Toast['tone']) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: ReactNode, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col gap-2 sm:w-96" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('fade-in rounded-md bg-surface shadow-pop px-4 py-3 text-sm flex gap-2.5 items-start', t.tone === 'bad' && 'border-l-2 border-bad')}>
            <span className={cx('mt-0.5', t.tone === 'ok' ? 'text-ok' : t.tone === 'bad' ? 'text-bad' : 'text-info')}>{t.tone === 'ok' ? Icon.check() : t.tone === 'bad' ? Icon.alert() : Icon.bell()}</span>
            <div className="flex-1">{t.message}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// --- Table helpers -----------------------------------------------------------------------
export function SortHeader({ label, k, sort, setSort, className }: { label: string; k: string; sort: [string, 1 | -1]; setSort: (s: [string, 1 | -1]) => void; className?: string }) {
  const active = sort[0] === k;
  return (
    <th className={cx('th', className)} aria-sort={active ? (sort[1] === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className={cx('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink')} onClick={() => setSort([k, active ? (sort[1] === 1 ? -1 : 1) : 1])}>
        {label}<span className="text-faint">{active ? (sort[1] === 1 ? '↑' : '↓') : ''}</span>
      </button>
    </th>
  );
}
export function sortRows<T extends Record<string, any>>(rows: T[], [k, dir]: [string, 1 | -1]) {
  return [...rows].sort((a, b) => {
    const x = a[k]; const y = b[k];
    if (x === y) return 0;
    if (x === undefined || x === null) return 1;
    if (y === undefined || y === null) return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
  });
}

export function SearchInput({ value, onChange, placeholder = 'Search', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cx('relative', className)}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">{Icon.search()}</span>
      <input className="input pl-9 h-9" type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
    </div>
  );
}

export function Progress({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'ok' | 'bad' }) {
  return <div className="h-1.5 rounded-full bg-raised overflow-hidden" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}><div className={cx('h-full transition-all', tone === 'accent' ? 'bg-accent' : tone === 'ok' ? 'bg-ok' : 'bg-bad')} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} /></div>;
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-2.5 text-sm">
      {items.map(([k, v], i) => (<div key={i} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v || <span className="text-faint">—</span>}</dd></div>))}
    </dl>
  );
}
