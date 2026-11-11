import { getLocale } from './locale';
import type { ISODate } from './types';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(v: unknown): v is ISODate {
  if (typeof v !== 'string') return false;
  const m = ISO_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Calendar date "today" in an IANA timezone. */
export function todayIn(timezone: string, now: Date = new Date()): ISODate {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

function toUTCDays(d: ISODate): number {
  const m = ISO_RE.exec(d);
  if (!m) throw new Error(`Invalid date: ${d}`);
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000);
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return toUTCDays(to) - toUTCDays(from);
}

export function addDays(d: ISODate, n: number): ISODate {
  const ms = (toUTCDays(d) + n) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** A document is valid through the end of its expiry date. */
export function isExpired(expiry: ISODate, today: ISODate): boolean {
  return daysBetween(today, expiry) < 0;
}

export function formatDate(d?: string | null): string {
  if (!d) return '—';
  const iso = d.length > 10 ? d.slice(0, 10) : d;
  if (!isISODate(iso)) return d;
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(getLocale(), {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export function formatDateTime(ts?: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString(getLocale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
