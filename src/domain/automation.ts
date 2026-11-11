// Deterministic rules for automatic follow-ups. No AI decides whether a
// message is sent: these functions do, from the organisation's settings,
// the request's history and the local clock.
import type { OrgSettings } from './types';

export const DEFAULT_CHASING = { enabled: true, afterDays: [3, 7, 14], escalateAfterDays: 16 };
export const DEFAULT_WORKING_HOURS = { start: 8, end: 18, days: [1, 2, 3, 4, 5] };

export function chasingOf(s: Partial<OrgSettings>) {
  const c = s.chasing ?? DEFAULT_CHASING;
  const afterDays = [...new Set((c.afterDays ?? DEFAULT_CHASING.afterDays).filter((d) => Number.isFinite(d) && d > 0))].sort((a, b) => a - b);
  return { enabled: c.enabled !== false, afterDays, escalateAfterDays: Math.max(c.escalateAfterDays ?? DEFAULT_CHASING.escalateAfterDays, (afterDays.at(-1) ?? 0) + 1) };
}

export function workingHoursOf(s: Partial<OrgSettings>) {
  const w = s.workingHours ?? DEFAULT_WORKING_HOURS;
  return { start: w.start ?? 8, end: w.end ?? 18, days: w.days?.length ? w.days : DEFAULT_WORKING_HOURS.days };
}

/** Local weekday (0 = Sunday) and hour in an IANA timezone. */
export function localClock(timezone: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
  return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd), hour };
}

export function inWorkingHours(s: Partial<OrgSettings> & { timezone: string }, now: Date) {
  const w = workingHoursOf(s);
  const { weekday, hour } = localClock(s.timezone, now);
  return w.days.includes(weekday) && hour >= w.start && hour < w.end;
}

/**
 * Which follow-up (if any) is due for an unanswered request.
 * - `daysSinceSent`: whole days since the request went out.
 * - `daysSinceActivity`: days since the subcontractor last opened the link or uploaded (undefined = never).
 * - `sent`: indexes of follow-ups already sent.
 * Someone who engaged in the last two days is left alone. Only the latest due
 * follow-up is sent; earlier ones that were missed are skipped, never batched.
 */
export function dueChase(o: { daysSinceSent: number; daysSinceActivity?: number; sent: number[]; afterDays: number[]; escalateAfterDays: number; escalated: boolean }) {
  if (o.daysSinceActivity !== undefined && o.daysSinceActivity < 2) return { type: 'none' as const, reason: 'recent activity' };
  if (!o.escalated && o.daysSinceSent >= o.escalateAfterDays) return { type: 'escalate' as const };
  let idx = -1;
  o.afterDays.forEach((d, i) => { if (o.daysSinceSent >= d) idx = i; });
  if (idx < 0 || o.sent.includes(idx) || o.sent.some((s) => s > idx)) return { type: 'none' as const, reason: 'nothing due' };
  return { type: 'chase' as const, index: idx, skipped: o.afterDays.map((_, i) => i).filter((i) => i < idx && !o.sent.includes(i)) };
}
