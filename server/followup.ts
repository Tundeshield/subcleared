import { daysBetween } from '../src/domain/dates';
import { renewalPlan } from '../src/domain/compliance';
import type { Organisation } from '../src/domain/types';
import { C } from './core';
import type { Db } from './db';
import type { OrgData } from './data';

/**
 * What happens next without anyone doing anything, per document in force or per
 * open request. Mirrors the reminder job's own rules; never changes them.
 */
export type FollowUp =
  | { kind: 'reminder'; date: string; dueNow: boolean }           // automatic renewal reminder scheduled
  | { kind: 'renewal_requested'; at: string; acknowledged: boolean } // renewal request already sent
  | { kind: 'requested'; at: string; chasing: boolean }           // waiting for the subcontractor to send it
  | { kind: 'manual'; why: 'no_contact' | 'not_on_live_project' | 'no_schedule' | 'schedule_finished' };

export async function sentReminderKeys(db: Db, orgId: string) {
  return new Set((await db.list<any>(C.col(orgId, 'reminders'))).filter((r) => ['sent', 'skipped', 'processing'].includes(r.status)).map((r) => r.id as string));
}

export function renewalFollowUp(org: Organisation, data: Pick<OrgData, 'requests' | 'subs' | 'assignments' | 'projects'>, sent: Set<string>, x: { subcontractorId: string; versionId: string; expiryDate: string }, today: string): FollowUp {
  const req = data.requests.filter((r) => r.renewalOfVersionId === x.versionId && ['sent', 'acknowledged', 'partially_fulfilled'].includes(r.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (req) return { kind: 'renewal_requested', at: req.createdAt, acknowledged: !!req.acknowledgedAt || req.status === 'acknowledged' };
  const sub = data.subs.find((s) => s.id === x.subcontractorId);
  if (!sub?.contacts.length) return { kind: 'manual', why: 'no_contact' };
  const live = new Set(data.projects.filter((p) => !['archived', 'completed'].includes(p.status)).map((p) => p.id));
  const inactive = ['archived', 'suspended'].includes(sub.status) || !data.assignments.some((a) => a.active && a.subcontractorId === sub.id && live.has(a.projectId));
  if (inactive && !org.settings.remindArchived) return { kind: 'manual', why: 'not_on_live_project' };
  const schedule = org.settings.reminderSchedule ?? [];
  if (!schedule.length) return { kind: 'manual', why: 'no_schedule' };
  const plan = renewalPlan(daysBetween(today, x.expiryDate), x.expiryDate, schedule, schedule.filter((o) => sent.has(`${x.versionId}:${o}`)));
  if (plan.dueNow) return { kind: 'reminder', date: today, dueNow: true };
  if (plan.nextDate) return { kind: 'reminder', date: plan.nextDate, dueNow: false };
  return { kind: 'manual', why: 'schedule_finished' };
}

/** The latest open request covering a requirement for a subcontractor. */
export function openRequestFor(data: Pick<OrgData, 'requests'>, subcontractorId: string, requirementId: string, chasingEnabled: boolean): FollowUp | null {
  const r = data.requests.filter((q) => q.subcontractorId === subcontractorId && q.requirementIds.includes(requirementId) && ['sent', 'acknowledged', 'partially_fulfilled'].includes(q.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return r ? { kind: 'requested', at: r.createdAt, chasing: chasingEnabled } : null;
}
