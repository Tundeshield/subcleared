import { formatShortDate, todayIn, whenPast } from '../domain/dates';

/** Mirrors server/followup.ts FollowUp. */
export type FollowUp =
  | { kind: 'reminder'; date: string; dueNow: boolean }
  | { kind: 'renewal_requested'; at: string; acknowledged: boolean }
  | { kind: 'requested'; at: string; chasing: boolean }
  | { kind: 'manual'; why: 'no_contact' | 'not_on_live_project' | 'no_schedule' | 'schedule_finished' };

export const localToday = () => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);

/** The next thing that happens on its own, in plain words. Null when nothing automatic is lined up. */
export function followUpText(f: FollowUp | null | undefined, today = localToday()): string | null {
  if (!f) return null;
  if (f.kind === 'reminder') return f.dueNow ? 'Reminder due — sent automatically' : `Reminder on ${formatShortDate(f.date, today)}`;
  if (f.kind === 'renewal_requested') return `Renewal requested ${whenPast(f.at, today)}`;
  if (f.kind === 'requested') return `Requested ${whenPast(f.at, today)}`;
  return null;
}

export const MANUAL_WHY: Record<string, string> = {
  no_contact: 'No contact to remind',
  not_on_live_project: 'Not on a live project, so no automatic reminder',
  no_schedule: 'Automatic reminders are off',
  schedule_finished: 'All automatic reminders sent',
};

const MISSING = ['missing', 'not_requested'];

export type RowNext =
  | { kind: 'review'; versionId: string }
  | { kind: 'request'; requirementIds: string[]; label: string }
  | { kind: 'check'; requirementId: string; names: string[] }
  | { kind: 'waiting'; text: string; detail?: string }
  | { kind: 'ready' };

/**
 * One next action per subcontractor row. A person is only asked to do
 * something nothing automatic will do: requests already sent and renewals with
 * a reminder scheduled show what happens next instead of a button.
 */
export function rowNext(s: { readiness: string; results: any[]; followUps?: Record<string, FollowUp> }, docReqIds: Set<string>, perms: { review: boolean; send: boolean }, today = localToday()): RowNext {
  const res = s.results.filter((r) => r.status !== 'not_applicable');
  const f = (r: any) => s.followUps?.[r.requirementId];
  const review = res.find((r) => ['awaiting_review', 'submitted', 'review_required', 'under_review'].includes(r.status) && r.versionId);
  if (review && perms.review) return { kind: 'review', versionId: review.versionId };
  const docs = res.filter((r) => docReqIds.has(r.requirementId));
  const checks = res.filter((r) => r.mandatory && !docReqIds.has(r.requirementId) && [...MISSING, 'requested', 'overdue', 'expired', 'expiring_soon'].includes(r.status));
  // Paperwork nobody has asked for, sent back, or lapsed without a renewal request on its way.
  const toRequest = docs.filter((r) => r.mandatory && (MISSING.includes(r.status) || r.status === 'rejected' || (r.status === 'expired' && f(r)?.kind !== 'renewal_requested')));
  if (toRequest.length && perms.send) return { kind: 'request', requirementIds: toRequest.map((r) => r.requirementId), label: toRequest.every((r) => r.status === 'expired') ? 'Request renewal' : 'Request documents' };
  if (checks.length && perms.review) return { kind: 'check', requirementId: checks[0].requirementId, names: checks.map((r) => r.requirementName) };
  const waiting = docs.filter((r) => ['requested', 'overdue'].includes(r.status) || (r.status === 'expired' && f(r)?.kind === 'renewal_requested'));
  if (waiting.length) {
    const latest = waiting.map(f).filter(Boolean).sort((a: any, b: any) => (b.at ?? '').localeCompare(a.at ?? ''))[0];
    const overdue = waiting.some((r) => r.status === 'overdue');
    return { kind: 'waiting', text: followUpText(latest, today) ?? 'Requested', detail: overdue ? 'Overdue — reminders continue automatically' : undefined };
  }
  const expiring = docs.filter((r) => r.status === 'expiring_soon').sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''));
  if (expiring.length) {
    const fu = f(expiring[0]);
    const text = followUpText(fu, today);
    if (text) return { kind: 'waiting', text, detail: `${expiring[0].requirementName} expires ${formatShortDate(expiring[0].expiryDate, today)}` };
    if (perms.send) return { kind: 'request', requirementIds: expiring.map((r) => r.requirementId), label: 'Request renewal' };
  }
  if (s.readiness === 'ready') return { kind: 'ready' };
  return { kind: 'waiting', text: 'Nothing to do now' };
}
