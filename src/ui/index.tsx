// SubCleared design system ("Graphite & Deep Cyan"): neutral surfaces, one
// accent for actions and location, four status colours for meaning only.
// Status never relies on colour: every state has a distinct mark *and* words.
// Documented in docs/design-system.md and rendered live at /design.
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { displayReadiness, READINESS_LABELS, STATUS_LABELS } from '../domain/compliance';
import type { Readiness, RequirementStatus } from '../domain/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export const humanize = (s: string) => (s ? s.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

// --- Icons: a small, consistent line set used only where they aid scanning ----------
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
export const Icon = {
  check: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><path d="M3.5 8.5l3 3 6-7" /></svg>,
  x: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><path d="M4 4l8 8M12 4l-8 8" /></svg>,
  search: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>,
  chevron: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><path d="M6 4l4 4-4 4" /></svg>,
  down: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><path d="M4 6l4 4 4-4" /></svg>,
  left: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><path d="M10 4L6 8l4 4" /></svg>,
  bell: (c = 'w-[18px] h-[18px]') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><path d="M4 11V7a4 4 0 118 0v4l1 1.5H3L4 11zM6.5 14a1.5 1.5 0 003 0" /></svg>,
  help: (c = 'w-[18px] h-[18px]') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><circle cx="8" cy="8" r="6.2" /><path d="M6.3 6.2a1.8 1.8 0 113 1.4c-.7.5-1.3.8-1.3 1.7M8 11.3v.1" /></svg>,
  upload: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10" /></svg>,
  file: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><path d="M4 2h5l3 3v9H4V2z" /><path d="M9 2v3h3" /></svg>,
  menu: (c = 'w-5 h-5') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>,
  arrow: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><path d="M3 8h10M9 4l4 4-4 4" /></svg>,
  clock: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><circle cx="8" cy="8" r="6" /><path d="M8 4.8V8l2.2 1.4" /></svg>,
  alert: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><path d="M8 2.2l6 11H2l6-11z" /><path d="M8 6.5v3M8 11.6v.1" /></svg>,
  plus: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} {...P} aria-hidden><path d="M8 3v10M3 8h10" /></svg>,
  more: (c = 'w-4 h-4') => <svg viewBox="0 0 16 16" className={c} aria-hidden><circle cx="3.5" cy="8" r="1.2" fill="currentColor" /><circle cx="8" cy="8" r="1.2" fill="currentColor" /><circle cx="12.5" cy="8" r="1.2" fill="currentColor" /></svg>,
};

// --- Identity ---------------------------------------------------------------------
/** The mark: a site barrier, raised — cleared to proceed. */
export function Mark({ className = 'w-6 h-6', inverse = false }: { className?: string; inverse?: boolean }) {
  const base = inverse ? '#FFFFFF' : 'rgb(var(--ink))';
  const accent = inverse ? 'rgb(var(--accent-bright))' : 'rgb(var(--accent))';
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="6" y="9" width="4" height="16" rx="1" fill={base} />
      <rect x="4" y="24" width="13" height="3" rx="1" fill={base} />
      <rect x="8" y="9.2" width="20" height="4" rx="1" fill={accent} transform="rotate(-34 8 11.2)" />
    </svg>
  );
}
export function Logo({ className = '', descriptor = false, inverse = false }: { className?: string; descriptor?: boolean; inverse?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', inverse ? 'text-white' : 'text-ink', className)}>
      <Mark className="w-7 h-7 -mt-0.5" inverse={inverse} />
      <span className="leading-none">
        <span className="block text-[1.125rem] font-semibold tracking-[-0.02em]">SubCleared</span>
        {descriptor && <span className="block mt-1 text-[0.6rem] font-medium tracking-[0.14em] text-faint">SUBCONTRACTOR COMPLIANCE &amp; READINESS</span>}
      </span>
    </span>
  );
}

// --- Status marks: shape + words, never colour alone ----------------------------------
type Tone = 'ok' | 'progress' | 'attention' | 'blocked' | 'none' | 'na';
const TONE_VAR: Record<Tone, string> = { ok: '--success', progress: '--info', attention: '--warning', blocked: '--danger', na: '--faint', none: '--faint' };
function Glyph({ tone, className = 'w-[15px] h-[15px]' }: { tone: Tone; className?: string }) {
  const c = `rgb(var(${TONE_VAR[tone]}))`;
  const cls = cx(className, 'shrink-0');
  if (tone === 'ok') return <svg viewBox="0 0 16 16" className={cls} aria-hidden><circle cx="8" cy="8" r="7.5" fill={c} /><path d="M4.8 8.3l2.2 2.2 4.2-4.8" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (tone === 'progress') return <svg viewBox="0 0 16 16" className={cls} aria-hidden><circle cx="8" cy="8" r="6.75" fill="none" stroke={c} strokeWidth="1.5" /><path d="M8 1.25a6.75 6.75 0 010 13.5z" fill={c} /></svg>;
  if (tone === 'attention') return <svg viewBox="0 0 16 16" className={cls} aria-hidden><circle cx="8" cy="8" r="6.75" fill="none" stroke={c} strokeWidth="1.5" /><path d="M8 4.5V8.4l2.3 1.4" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" /></svg>;
  if (tone === 'blocked') return <svg viewBox="0 0 16 16" className={cls} aria-hidden><circle cx="8" cy="8" r="7.5" fill={c} /><path d="M8 4.2v4.6" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" /><circle cx="8" cy="11.3" r="1" fill="#fff" /></svg>;
  if (tone === 'na') return <svg viewBox="0 0 16 16" className={cls} aria-hidden><circle cx="8" cy="8" r="6.75" fill="none" stroke={c} strokeWidth="1.2" /><path d="M5 8h6" stroke={c} strokeWidth="1.3" /></svg>;
  return <svg viewBox="0 0 16 16" className={cls} aria-hidden><circle cx="8" cy="8" r="6.75" fill="none" stroke={c} strokeWidth="1.3" strokeDasharray="2.2 2.2" /></svg>;
}
/** Text colour for a status label: coloured only at the two ends (done / blocking). */
export const toneText = (t: Tone) => (t === 'ok' ? 'text-success' : t === 'blocked' ? 'text-danger font-medium' : t === 'na' || t === 'none' ? 'text-faint' : 'text-ink');
export type { Tone };
export { Glyph };

const READINESS_TONE: Record<string, Tone> = { ready: 'ok', action_required: 'attention', not_ready: 'blocked', not_evaluated: 'none', needs_review: 'progress' };
export function ReadinessBadge({ value, size = 'md', detail, results }: { value: Readiness | string; size?: 'sm' | 'md'; detail?: ReactNode; results?: { status: string; blocking?: boolean }[] }) {
  const shown = displayReadiness(value, results);
  const v = (shown in READINESS_TONE ? shown : 'not_evaluated') as Readiness;
  return (
    <span className={cx('inline-flex items-center gap-2 whitespace-nowrap', size === 'sm' ? 'text-sm' : 'text-base', v === 'ready' ? 'text-success font-medium' : toneText(READINESS_TONE[v]))}>
      <Glyph tone={READINESS_TONE[v]} />{(v as string) === 'needs_review' ? 'Needs review' : READINESS_LABELS[v]}{detail && <span className="text-faint font-normal">{detail}</span>}
    </span>
  );
}
const REQ_TONE: Record<string, Tone> = {
  approved: 'ok', expiring_soon: 'attention', awaiting_review: 'progress', submitted: 'progress', review_required: 'progress',
  expired: 'blocked', rejected: 'blocked', missing: 'blocked', overdue: 'blocked', requested: 'attention', not_applicable: 'na', not_requested: 'none',
};
export function StatusText({ value, label, wrap }: { value: RequirementStatus | string; label?: string; wrap?: boolean }) {
  const tone = REQ_TONE[value] ?? 'none';
  return <span className={cx('inline-flex gap-2 text-sm', wrap ? 'items-start [&>svg]:mt-[4px]' : 'items-center whitespace-nowrap', toneText(tone))}><Glyph tone={tone} className="w-[13px] h-[13px]" />{label ?? STATUS_LABELS[value as RequirementStatus] ?? humanize(value)}</span>;
}
const DOC_STATUS: Record<string, [string, Tone]> = {
  approved: ['Approved', 'ok'], approved_replacement_pending: ['Approved · new version needs review', 'ok'], expiring_soon: ['Expiring soon', 'attention'],
  expiring_replacement_pending: ['Expiring · new version needs review', 'attention'], expired: ['Expired', 'blocked'], expired_replacement_pending: ['Expired · new version needs review', 'blocked'],
  awaiting_review: ['Needs review', 'progress'], under_review: ['Being reviewed', 'progress'], submitted: ['Submitted', 'progress'], rejected: ['Changes needed', 'blocked'],
  info_requested: ['Changes needed', 'attention'], superseded: ['Superseded', 'na'], archived: ['Archived', 'na'], quarantined: ['Blocked by security checks', 'blocked'], uploading: ['Uploading', 'none'],
};
export function DocStatus({ value }: { value: string }) {
  const [label, tone] = DOC_STATUS[value] ?? [humanize(value), 'none'];
  return <span className={cx('inline-flex items-center gap-2 text-sm whitespace-nowrap', toneText(tone))}><Glyph tone={tone} className="w-[13px] h-[13px]" />{label}</span>;
}
export function VerificationLabel({ value }: { value?: string }) {
  const t = value === 'independently_verified' ? ['Independently verified', 'text-success'] : value === 'reviewed' ? ['Reviewed against requirements', 'text-muted'] : ['Received — not yet reviewed', 'text-faint'];
  return <span className={cx('text-xs', t[1])}>{t[0]}</span>;
}
export function SampleTag() { return <span className="inline-flex items-center rounded-sm border border-line-strong px-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-faint align-middle">Sample</span>; }

/** Readiness as a proportion bar: green ready, amber needs attention, red not ready. Always paired with words. */
export function ReadinessBar({ ready, action, notReady, total, className }: { ready: number; action: number; notReady: number; total: number; className?: string }) {
  if (!total) return <div className={cx('h-1.5 rounded-full bg-raised', className)} />;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className={cx('flex gap-px h-1.5 rounded-full overflow-hidden bg-raised', className)} role="img" aria-label={`${ready} of ${total} ready, ${action} need attention, ${notReady} not ready`}>
      <div className="bg-success" style={{ width: pct(ready) }} />
      <div className="bg-warning/70" style={{ width: pct(action) }} />
      <div className="bg-danger/40" style={{ width: pct(notReady) }} />
    </div>
  );
}
export function Progress({ value }: { value: number }) {
  return <div className="h-1.5 rounded-full bg-raised overflow-hidden" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-accent transition-all" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} /></div>;
}

// --- Layout ----------------------------------------------------------------------------
export function Breadcrumbs({ items }: { items: { label: ReactNode; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-sm text-faint">
      <ol className="flex flex-wrap items-center gap-1.5">{items.map((it, i) => (
        <li key={i} className="flex items-center gap-1.5">{i > 0 && <span aria-hidden className="text-line-strong">/</span>}{it.to ? <Link to={it.to} className="hover:text-ink">{it.label}</Link> : <span className="text-muted" aria-current="page">{it.label}</span>}</li>
      ))}</ol>
    </nav>
  );
}

export function PageHeader({ title, description, actions, crumbs, meta, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; crumbs?: { label: ReactNode; to?: string }[]; meta?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8">
      {crumbs && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-2xl font-medium leading-tight">{title}</h1>
          {description && <p className="mt-2 text-muted leading-relaxed">{description}</p>}
          {meta && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** Understated, clickable metric. */
export function Metric({ label, value, hint, to, emphasis }: { label: string; value: ReactNode; hint?: ReactNode; to?: string; emphasis?: 'success' | 'danger' }) {
  const body = (
    <>
      <div className="text-sm text-muted">{label}</div>
      <div className={cx('mt-1.5 text-[2rem] leading-none font-normal tnum tracking-[-0.02em]', emphasis === 'success' ? 'text-success' : emphasis === 'danger' ? 'text-danger' : 'text-ink')}>{value}</div>
      {hint && <div className="mt-2 text-xs text-faint">{hint}</div>}
    </>
  );
  return to ? <Link to={to} className="group block py-1 pr-6 hover:[&>div:nth-child(2)]:underline decoration-1 underline-offset-[6px]">{body}</Link> : <div className="py-1 pr-6">{body}</div>;
}
/** Backwards-compatible alias. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode; tone?: string; onClick?: () => void; active?: boolean }) { return <Metric label={label} value={value} hint={hint} />; }

export function Section({ title, actions, children, className, description }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; description?: ReactNode; flush?: boolean }) {
  return (
    <section className={className}>
      {(title || actions) && (
        <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-line-strong">
          <div><h2 className="text-md font-semibold">{title}</h2>{description && <p className="text-sm text-muted mt-0.5">{description}</p>}</div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div>{children}</div>
    </section>
  );
}

// --- States ---------------------------------------------------------------------------------
export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={cx('animate-spin', className)} role="status" aria-label="Loading"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" /><path d="M14 8a6 6 0 00-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
export function Skeleton({ rows = 5 }: { rows?: number }) {
  return <div className="py-4 space-y-4" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-4" style={{ width: `${88 - (i % 3) * 16}%` }} />)}</div>;
}
/** The one loading indicator for a whole area: centred in the space it fills, with an optional short label. */
export function LoadingBlock({ label, className = 'min-h-[50vh]' }: { label?: string; className?: string }) {
  return (
    <div className={cx('w-full flex flex-col items-center justify-center gap-3 text-muted text-center', className)} aria-busy="true">
      <Spinner className="w-6 h-6" />
      {label && <p>{label}</p>}
    </div>
  );
}
export function PageLoading() {
  return <div className="space-y-6"><div className="skeleton h-8 w-72" /><div className="skeleton h-4 w-96" /><Skeleton rows={8} /></div>;
}
export function ErrorState({ error, onRetry }: { error: { message: string; status?: number } | string; onRetry?: () => void }) {
  const msg = typeof error === 'string' ? error : error.message;
  return (
    <div className="border-l-2 border-ink pl-5 py-2 max-w-xl" role="alert">
      <div className="flex items-center gap-2 font-medium"><Glyph tone="blocked" />We couldn't load this</div>
      <p className="text-muted mt-1.5">{msg}</p>
      {onRetry && <button className="btn-secondary btn-sm mt-4" onClick={onRetry}>Try again</button>}
    </div>
  );
}
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="py-14 max-w-md">
      <div className="text-md font-medium">{title}</div>
      {children && <p className="text-muted mt-2 leading-relaxed">{children}</p>}
      {action && <div className="mt-5 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}
export function Callout({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode; title?: ReactNode }) {
  const g: Tone = tone === 'ok' ? 'ok' : tone === 'bad' ? 'blocked' : tone === 'warn' ? 'attention' : 'progress';
  return (
    <div className={cx('flex gap-3 rounded-md px-4 py-3.5 text-sm border', tone === 'ok' ? 'bg-success-tint border-success/20' : tone === 'bad' ? 'bg-danger-tint border-danger/20' : tone === 'warn' ? 'bg-warning-tint border-warning/20' : 'bg-info-tint border-info/15')} role={tone === 'bad' ? 'alert' : undefined}>
      {tone === 'info' ? <svg viewBox="0 0 16 16" className="w-4 h-4 mt-0.5 shrink-0" aria-hidden><circle cx="8" cy="8" r="7.5" fill="rgb(var(--info))" /><path d="M8 7.2v4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /><circle cx="8" cy="4.9" r="1" fill="#fff" /></svg> : <Glyph tone={g} className="w-4 h-4 mt-0.5" />}
      <div>{title && <div className="font-medium mb-0.5">{title}</div>}<div className="text-muted leading-relaxed">{children}</div></div>
    </div>
  );
}
export function FormError({ error }: { error?: string | null }) {
  if (!error) return null;
  return <div className="flex gap-2.5 items-start rounded border-l-2 border-danger bg-danger-tint text-sm px-3 py-2.5" role="alert"><Glyph tone="blocked" className="w-4 h-4 mt-0.5" /><span>{error}</span></div>;
}

// --- Form ----------------------------------------------------------------------------------
export function Field({ label, hint, children, error, required, className, optional }: { label: ReactNode; hint?: ReactNode; children: ReactNode; error?: string; required?: boolean; className?: string; optional?: boolean }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}{required && <span className="text-faint font-normal" aria-hidden> *</span>}{optional && <span className="text-faint font-normal"> (optional)</span>}</span>
      {children}
      {error ? <span className="hint text-danger font-medium flex items-center gap-1.5 mt-1.5" role="alert"><Glyph tone="blocked" className="w-3 h-3" />{error}</span> : hint ? <span className="hint block">{hint}</span> : null}
    </label>
  );
}
export function Checkbox({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex items-start gap-3 cursor-pointer select-none', disabled && 'opacity-55 cursor-not-allowed')}>
      <input type="checkbox" className="mt-[3px] h-4 w-4 accent-[rgb(var(--accent))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0"><span className="text-base">{label}</span>{hint && <span className="block text-xs text-faint mt-0.5">{hint}</span>}</span>
    </label>
  );
}
export function Radio({ name, checked, onChange, label, hint, disabled }: { name: string; checked: boolean; onChange: () => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex items-start gap-3 cursor-pointer select-none', disabled && 'opacity-55 cursor-not-allowed')}>
      <input type="radio" name={name} className="mt-[3px] h-4 w-4 accent-[rgb(var(--accent))]" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="min-w-0"><span className="text-base">{label}</span>{hint && <span className="block text-xs text-faint mt-0.5">{hint}</span>}</span>
    </label>
  );
}
/** Short explanation shown on hover or keyboard focus. Content is also exposed to screen readers. */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <span className="relative inline-flex group/tt" aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[17rem] rounded bg-ink px-2.5 py-1.5 text-xs font-normal leading-relaxed text-white opacity-0 translate-y-0.5 transition group-hover/tt:opacity-100 group-hover/tt:translate-y-0 group-focus-within/tt:opacity-100 group-focus-within/tt:translate-y-0 z-50 text-left normal-case tracking-normal">{content}</span>
    </span>
  );
}
/** A small "?" that explains a term in place. */
export function HelpTip({ children, label = 'What does this mean?' }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip content={children}>
      <button type="button" aria-label={label} className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line-strong text-[0.625rem] font-semibold text-faint hover:text-ink hover:border-ink/40 align-middle">?</button>
    </Tooltip>
  );
}
export function Segmented<T extends string>({ value, options, onChange, size = 'md', label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; label?: string }) {
  return (
    <div className="inline-flex rounded border border-line-strong p-0.5 bg-paper" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx('rounded-[3px] px-3 font-medium transition-colors', size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm', value === o.value ? 'bg-ink text-canvas' : 'text-muted hover:text-ink')}>{o.label}</button>
      ))}
    </div>
  );
}
export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: ReactNode; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-6 border-b border-line overflow-x-auto" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          className={cx('pb-3 pt-1 text-[0.9375rem] border-b-2 -mb-px whitespace-nowrap transition-colors', value === t.value ? 'border-accent text-ink font-medium' : 'border-transparent text-muted hover:text-ink')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-faint tnum font-normal">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// --- Overlays ------------------------------------------------------------------------------
/**
 * Focus management for dialogs and drawers. Runs once each time the overlay
 * opens and once when it closes, never while it is open.
 *
 * `onClose` is read through a ref on purpose: callers usually pass an inline
 * function, which is a new value on every render. Listing it as an effect
 * dependency made the effect tear down and re-run on every keystroke in a form
 * whose state lives in the same component, and each re-run moved focus back to
 * the first field 30 ms later (the "cursor jumps to Company name" bug).
 */
function useOverlay(open: boolean, onClose: () => void, ref: React.RefObject<HTMLDivElement>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      // Only place initial focus if nothing inside the overlay has it yet (e.g. a field with autoFocus).
      if (ref.current && !ref.current.contains(document.activeElement)) ref.current.querySelector<HTMLElement>('[autofocus],input:not([type=hidden]),select,textarea,button:not([data-close])')?.focus();
    }, 30);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(t); document.removeEventListener('keydown', key); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, ref]);
}

/** Modal: short, focused decisions. */
export function Dialog({ open, onClose, title, children, footer, width = 'max-w-lg', description }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: string; description?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={cx('relative w-full bg-paper rounded-t-lg sm:rounded-lg shadow-pop fade-in max-h-[92vh] flex flex-col', width)}>
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div><h2 id={id} className="text-lg font-semibold">{title}</h2>{description && <p className="text-sm text-muted mt-1 leading-relaxed">{description}</p>}</div>
          <button data-close className="btn-ghost btn-sm -mr-2 -mt-1" onClick={onClose} aria-label="Close">{Icon.x()}</button>
        </div>
        <div className="px-6 pb-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-line flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Drawer: contextual editing alongside the page. */
export function Drawer({ open, onClose, title, children, footer, description, width = 'max-w-xl' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; description?: ReactNode; width?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useOverlay(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={cx('absolute right-0 top-0 bottom-0 w-full bg-paper shadow-drawer slide-in flex flex-col', width)}>
        <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-5 border-b border-line">
          <div><h2 id={id} className="text-xl font-medium">{title}</h2>{description && <p className="text-sm text-muted mt-1.5 leading-relaxed">{description}</p>}</div>
          <button data-close className="btn-ghost btn-sm -mr-3" onClick={onClose} aria-label="Close">{Icon.x()}</button>
        </div>
        <div className="flex-1 overflow-y-auto px-7 py-6">{children}</div>
        {footer && <div className="px-7 py-4 border-t border-line flex flex-wrap justify-end gap-2 bg-paper">{footer}</div>}
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
      {children && <div className="text-muted leading-relaxed mb-4">{children}</div>}
      {requireReason && <Field label={reasonLabel} required hint="Recorded in the audit trail."><textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>}
    </Dialog>
  );
}

export function Menu({ trigger, items, align = 'right' }: { trigger: (p: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; items: ({ label: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean } | null | false)[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  const list = items.filter(Boolean) as { label: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }[];
  if (!list.length) return null;
  return (
    <div className="relative inline-block" ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div className={cx('absolute z-40 mt-1.5 min-w-[13rem] rounded-md bg-paper shadow-pop border border-line py-1.5 fade-in', align === 'right' ? 'right-0' : 'left-0')} role="menu">
          {list.map((it, i) => (
            <button key={i} role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}
              className={cx('block w-full text-left px-3.5 py-2 text-sm hover:bg-raised disabled:opacity-45 text-ink', it.danger && 'font-medium')}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
export function MoreButton({ label = 'More actions', ...props }: { label?: string } & Record<string, any>) {
  return <button className="btn-ghost btn-sm px-2" aria-label={label} {...props}>{Icon.more()}</button>;
}

// --- Toasts -----------------------------------------------------------------------------------
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
      <div className="fixed bottom-5 right-5 left-5 sm:left-auto z-[60] flex flex-col gap-2 sm:w-96" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="fade-in rounded-md bg-ink text-canvas px-4 py-3 text-sm flex gap-3 items-start shadow-pop">
            <span className="mt-0.5 shrink-0">{t.tone === 'ok' ? Icon.check() : t.tone === 'bad' ? Icon.alert() : Icon.bell('w-4 h-4')}</span>
            <div className="flex-1 leading-relaxed">{t.message}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// --- Tables, filters, pagination -----------------------------------------------------------------
export function SortHeader({ label, k, sort, setSort, className }: { label: string; k: string; sort: [string, 1 | -1]; setSort: (s: [string, 1 | -1]) => void; className?: string }) {
  const active = sort[0] === k;
  return (
    <th className={cx('th', className)} aria-sort={active ? (sort[1] === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className={cx('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink')} onClick={() => setSort([k, active ? (sort[1] === 1 ? -1 : 1) : 1])}>
        {label}<span aria-hidden className="w-3 text-faint">{active ? (sort[1] === 1 ? '↑' : '↓') : ''}</span>
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
      <input className="input pl-9" type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
    </div>
  );
}
export function FilterSelect({ label, value, onChange, options, all = 'All' }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; all?: string }) {
  return (
    <select className={cx('input w-auto min-w-[10rem]', value && 'border-ink/40')} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">{label}: {all}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
export function Toolbar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5 mb-5">{children}<div className="flex-1" />{right}</div>;
}

export function usePaged<T>(rows: T[], size = 25) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  useEffect(() => { if (page > pages) setPage(1); }, [pages, page]);
  const slice = useMemo(() => rows.slice((page - 1) * size, page * size), [rows, page, size]);
  return { slice, page, pages, setPage, total: rows.length, size };
}
export function Pagination({ page, pages, setPage, total, size }: { page: number; pages: number; setPage: (p: number) => void; total: number; size: number }) {
  if (total <= size) return total ? <div className="pt-4 text-sm text-faint">{total} {total === 1 ? 'record' : 'records'}</div> : null;
  return (
    <nav className="flex items-center justify-between pt-4 text-sm" aria-label="Pagination">
      <span className="text-faint tnum">{(page - 1) * size + 1}–{Math.min(page * size, total)} of {total}</span>
      <div className="flex gap-1">
        <button className="btn-ghost btn-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>{Icon.left()} Previous</button>
        <span className="px-2 self-center text-muted tnum">Page {page} of {pages}</span>
        <button className="btn-ghost btn-sm" disabled={page === pages} onClick={() => setPage(page + 1)}>Next {Icon.chevron()}</button>
      </div>
    </nav>
  );
}

export function KeyValue({ items, columns = 1 }: { items: [ReactNode, ReactNode][]; columns?: 1 | 2 }) {
  return (
    <dl className={cx('grid gap-x-10', columns === 2 ? 'sm:grid-cols-2' : '')}>
      {items.map(([k, v], i) => (
        <div key={i} className="grid grid-cols-[minmax(0,12.5rem)_minmax(0,1fr)] gap-x-5 py-3 border-b border-line text-base"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v || v === 0 ? v : <span className="text-faint">—</span>}</dd></div>
      ))}
    </dl>
  );
}

/**
 * Stable keys for editable rows (contacts, conditions, new subcontractors).
 * Using the array index as the key lets React hand one row's inputs to the
 * next row when a row is removed, which moves focus and half-typed text.
 */
let rowSeq = 0;
export const newRowKey = () => `row-${++rowSeq}`;
/** Removes client-only row keys before data is sent to the server. */
export function withoutRowKey<T extends { _k?: string }>(x: T): Omit<T, '_k'> { const { _k, ...rest } = x; return rest; }
