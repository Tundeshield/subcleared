import { applyOrgFormatting } from '../src/domain/locale';
// Background jobs: daily renewal reminders/escalations, and AI extraction.
// Every job is idempotent: reminder keys are created with create() (fails if
// it exists), so overlapping or retried runs cannot send duplicates.
import { chasingOf, dueChase, inWorkingHours } from '../src/domain/automation';
import { dueReminder } from '../src/domain/compliance';
import { daysBetween, formatDate, todayIn } from '../src/domain/dates';
import { processVersion } from './ai';
import type { Assignment, DocumentRecord, DocumentRequest, DocumentVersion, Evaluation, Member, Organisation, PortalLink, Project, RequirementDefinition, Subcontractor } from '../src/domain/types';
import { AlreadyExistsError } from './db';
import { audit, C, membersWith, notifyMembers } from './core';
import { recompute } from './data';
import { sendEmail } from './email';
import { issuePortalLink } from './handlers/requests';
import type { Services } from './services';
import { subscriptionUsable } from './handlers/billing';

export interface JobOptions { orgId?: string; /** Dev/test only: send now regardless of working hours, and rerun daily steps. */ force?: boolean }

export async function runDailyJobs(svc: Services, opts: JobOptions = {}) {
  const orgs = opts.orgId ? [await svc.db.get<Organisation>(C.org(opts.orgId))].filter(Boolean) as Organisation[] : await svc.db.list<Organisation>('orgs');
  const summary: any[] = [];
  for (const org of orgs) {
    applyOrgFormatting(org.settings);
    try { summary.push({ orgId: org.id, ...(await runForOrg(svc, org, opts)) }); } catch (e: any) {
      console.error('daily job failed', org.id, e);
      summary.push({ orgId: org.id, error: e.message });
    }
  }
  return summary;
}

async function claimReminder(svc: Services, org: Organisation, key: string, data: Record<string, any>) {
  const path = C.doc(org.id, 'reminders', key);
  try { await svc.db.create(path, { ...data, id: key, status: 'processing', attempts: 1, at: svc.now().toISOString() }); return true; } catch (e) {
    if (!(e instanceof AlreadyExistsError)) throw e;
  }
  // Retry previously failed sends, up to 3 attempts.
  return svc.db.transaction(async (tx) => {
    const cur = await tx.get<any>(path);
    if (!cur || cur.status !== 'failed' || cur.attempts >= 3) return false;
    tx.update(path, { status: 'processing', attempts: cur.attempts + 1, at: svc.now().toISOString() });
    return true;
  });
}

async function runForOrg(svc: Services, org: Organisation, opts: JobOptions) {
  const base = { svc, db: svc.db, org };
  if (org.subscription.status === 'canceled' && !subscriptionUsable(org.subscription, svc.now())) return { skipped: 'subscription canceled' };
  const today = todayIn(org.settings.timezone, svc.now());
  const [docs, versions, subs, defs, assignments, projects, requests, links] = await Promise.all([
    svc.db.list<DocumentRecord>(C.col(org.id, 'documents')), svc.db.list<DocumentVersion>(C.col(org.id, 'versions')),
    svc.db.list<Subcontractor>(C.col(org.id, 'subcontractors')), svc.db.list<RequirementDefinition>(C.col(org.id, 'requirements')),
    svc.db.list<Assignment>(C.col(org.id, 'assignments')), svc.db.list<Project>(C.col(org.id, 'projects')),
    svc.db.list<DocumentRequest>(C.col(org.id, 'requests')), svc.db.list<PortalLink>(C.col(org.id, 'links')),
  ]);
  const sentKeys = new Set((await svc.db.list<any>(C.col(org.id, 'reminders'))).filter((r) => ['sent', 'skipped', 'processing'].includes(r.status)).map((r) => r.id));
  const liveProjects = new Set(projects.filter((p) => !['archived', 'completed'].includes(p.status)).map((p) => p.id));
  const subsById = new Map(subs.map((s) => [s.id, s]));
  const defsById = new Map(defs.map((d) => [d.id, d]));
  let reminders = 0; let escalations = 0; let failures = 0; let chasers = 0;
  // Subcontractors are only emailed inside the organisation's working hours (in its own timezone).
  const inHours = opts.force || inWorkingHours(org.settings, svc.now());
  // Heavier daily steps (recompute, escalations, alerts) run once per local day even though the scheduler runs hourly.
  let dailyDue = true;
  if (!opts.force) { try { await svc.db.create(C.doc(org.id, 'reminders', `daily:${today}`), { id: `daily:${today}`, status: 'sent', at: svc.now().toISOString() }); } catch { dailyDue = false; } }

  // 1. Expiry reminders for the evidence currently in force.
  for (const d of inHours ? docs : []) {
    if (d.archived || !d.approvedVersionId) continue;
    const v = versions.find((x) => x.id === d.approvedVersionId);
    const exp = v?.metadata.expiryDate;
    if (!v || !exp) continue;
    const sub = subsById.get(d.subcontractorId);
    if (!sub) continue;
    const inactive = ['archived', 'suspended'].includes(sub.status) || !assignments.some((a) => a.active && a.subcontractorId === sub.id && liveProjects.has(a.projectId));
    if (inactive && !org.settings.remindArchived) continue;
    // A replacement already received stops the reminder sequence.
    if (versions.some((x) => x.documentId === d.id && x.uploadedAt > v.uploadedAt && ['submitted', 'awaiting_review', 'under_review', 'approved'].includes(x.reviewStatus))) continue;
    const days = daysBetween(today, exp);
    const sent = org.settings.reminderSchedule.filter((o) => sentKeys.has(`${v.id}:${o}`));
    const due = dueReminder(days, org.settings.reminderSchedule, sent);
    if (!due) continue;
    for (const o of due.supersedes) {
      try { await svc.db.create(C.doc(org.id, 'reminders', `${v.id}:${o}`), { id: `${v.id}:${o}`, versionId: v.id, offset: o, status: 'skipped', reason: 'superseded by a later reminder', at: svc.now().toISOString() }); } catch { /* exists */ }
    }
    const key = `${v.id}:${due.offset}`;
    if (!(await claimReminder(svc, org, key, { versionId: v.id, documentId: d.id, subcontractorId: sub.id, offset: due.offset, expiryDate: exp }))) continue;
    try {
      const contact = sub.contacts.find((c) => c.primary) ?? sub.contacts[0];
      const def = d.requirementId ? defsById.get(d.requirementId) : undefined;
      let emailStatus = 'no_contact';
      if (contact && d.requirementId) {
        // One open renewal request per document version; reuse it if present.
        let req = requests.find((r) => r.renewalOfVersionId === v.id && ['sent', 'acknowledged', 'partially_fulfilled'].includes(r.status));
        let url: string;
        const link = await issuePortalLink(base, { subcontractorId: sub.id, contactEmail: contact.email, requirementIds: [d.requirementId], projectIds: [], fullPortal: false, days: Math.max(org.settings.defaultLinkExpiryDays, 7), requestId: req?.id });
        url = link.url;
        if (!req) {
          req = {
            id: svc.db.newId(), type: 'renewal', subcontractorId: sub.id, contactId: contact.id, contactEmail: contact.email, contactName: contact.name, projectIds: [],
            requirementIds: [d.requirementId], status: 'sent', linkId: link.linkId, createdBy: { uid: 'system', name: 'Automatic reminder' }, createdAt: svc.now().toISOString(),
            renewalOfVersionId: v.id, dueDate: exp,
          };
          await svc.db.set(C.doc(org.id, 'requests', req.id), req as any);
          await svc.db.update(C.doc(org.id, 'links', link.linkId), { requestId: req.id });
        }
        const when = days > 0 ? `expires on ${formatDate(exp)} (in ${days} day${days === 1 ? '' : 's'})` : days === 0 ? `expires today (${formatDate(exp)})` : `expired on ${formatDate(exp)}`;
        const log = await sendEmail(base, {
          to: contact.email, template: 'sub.renewal_reminder', dedupeKey: `reminder:${key}`,
          subject: days >= 0 ? `${def?.name ?? d.title} ${days === 0 ? 'expires today' : `expires in ${days} days`} — ${org.name}` : `${def?.name ?? d.title} has expired — ${org.name}`,
          heading: days >= 0 ? 'Please send an updated document' : 'Your document has expired',
          body: `Hello ${contact.name},\n\nThe ${def?.name ?? d.title} we hold for ${sub.legalName} ${when}.\n\nPlease upload the renewed document using the secure link below so ${org.name} can keep your records current.`,
          cta: { label: 'Upload the renewal', url },
        });
        emailStatus = log.status;
        if (log.status === 'failed') throw new Error(log.error ?? 'Email failed');
      }
      const owners = [sub.ownerUid, ...(await membersWith(base, 'requirements.manage')).map((m) => m.uid)].filter(Boolean) as string[];
      await notifyMembers(base, owners, {
        type: days < 0 ? 'expired' : 'expiring', title: `${sub.legalName}: ${def?.name ?? d.title} ${days < 0 ? 'has expired' : days === 0 ? 'expires today' : `expires in ${days} days`}`,
        body: contact ? `Renewal requested from ${contact.email}.` : 'No contact on file — add one to request the renewal.', link: `/app/renewals`, dedupeKey: `exp:${key}`,
      });
      await svc.db.update(C.doc(org.id, 'reminders', key), { status: 'sent', emailStatus, at: svc.now().toISOString() });
      await audit({ ...base, source: 'scheduler' }, { action: 'notification.renewal_reminder', entity: { type: 'document', id: d.id, label: d.title }, after: { offset: due.offset, expiryDate: exp, emailStatus, to: contact?.email }, actor: { type: 'system', id: 'scheduler', name: 'Reminder scheduler' }, refs: [sub.id] });
      reminders++;
    } catch (e: any) {
      failures++;
      await svc.db.update(C.doc(org.id, 'reminders', key), { status: 'failed', error: e.message?.slice(0, 300), at: svc.now().toISOString() });
    }
  }

  // 2. Follow up unanswered requests, then escalate to the person who asked.
  const chase = chasingOf(org.settings);
  if (inHours && chase.enabled) {
    const members = await svc.db.list<Member>(C.col(org.id, 'members'));
    for (const r of requests.filter((x) => x.type === 'request' && ['sent', 'acknowledged', 'partially_fulfilled'].includes(x.status))) {
      const sub = subsById.get(r.subcontractorId);
      if (!sub || ['archived', 'suspended'].includes(sub.status)) continue;
      const mine = versions.filter((v) => v.subcontractorId === sub.id && v.uploadedAt >= r.createdAt && !['uploading', 'quarantined'].includes(v.reviewStatus));
      const received = new Set(mine.filter((v) => !['rejected', 'info_requested'].includes(v.reviewStatus)).map((v) => v.requirementId));
      const outstanding = r.requirementIds.filter((rid) => !received.has(rid));
      if (!outstanding.length) continue; // everything arrived: stop chasing
      const reqLinks = links.filter((l) => l.requestId === r.id);
      const lastActivity = [...reqLinks.map((l) => l.lastUsedAt).filter(Boolean) as string[], ...mine.map((v) => v.uploadedAt)].sort().at(-1);
      const sent = chase.afterDays.map((_, i) => i).filter((i) => sentKeys.has(`chase:${r.id}:${i}`));
      const due = dueChase({
        daysSinceSent: daysBetween(todayIn(org.settings.timezone, new Date(r.createdAt)), today),
        daysSinceActivity: lastActivity ? daysBetween(todayIn(org.settings.timezone, new Date(lastActivity)), today) : undefined,
        sent, afterDays: chase.afterDays, escalateAfterDays: chase.escalateAfterDays, escalated: sentKeys.has(`chase-esc:${r.id}`),
      });
      const names = outstanding.map((rid) => defsById.get(rid)?.name ?? 'Document');
      if (due.type === 'escalate') {
        const key = `chase-esc:${r.id}`;
        if (!(await claimReminder(svc, org, key, { type: 'escalation', requestId: r.id }))) continue;
        const ps = projects.filter((p) => r.projectIds.includes(p.id));
        const to = [r.createdBy.uid !== 'system' ? r.createdBy.uid : undefined, sub.ownerUid, ...ps.map((p) => p.managerUid)].filter(Boolean) as string[];
        if (!to.length) to.push(...(await membersWith(base, 'requests.send')).map((m) => m.uid));
        await notifyMembers(base, to, {
          type: 'escalation', title: `${sub.legalName} hasn’t sent ${names.join(', ')}`,
          body: `Requested ${formatDate(r.createdAt)} from ${r.contactEmail}; ${sent.length} automatic reminder${sent.length === 1 ? '' : 's'} sent with no reply. It may need a phone call.`, link: `/app/subcontractors/${sub.id}`, dedupeKey: key,
        });
        await svc.db.update(C.doc(org.id, 'reminders', key), { status: 'sent', at: svc.now().toISOString() });
        await audit({ ...base, source: 'scheduler' }, { action: 'request.escalated', entity: { type: 'request', id: r.id, label: `${sub.legalName} — ${r.contactEmail}` }, after: { outstanding: names, remindersSent: sent.length }, actor: { type: 'system', id: 'scheduler', name: 'Automatic follow-up' }, refs: [sub.id, ...r.projectIds] });
        escalations++;
        continue;
      }
      if (due.type !== 'chase') continue;
      for (const i of due.skipped) { try { await svc.db.create(C.doc(org.id, 'reminders', `chase:${r.id}:${i}`), { id: `chase:${r.id}:${i}`, status: 'skipped', reason: 'a later follow-up was due', at: svc.now().toISOString() }); } catch { /* exists */ } }
      const key = `chase:${r.id}:${due.index}`;
      if (!(await claimReminder(svc, org, key, { type: 'chase', requestId: r.id, index: due.index }))) continue;
      try {
        // Fresh link each time so a reminder never carries an expired link; earlier links stay valid until they lapse.
        const link = await issuePortalLink(base, { subcontractorId: sub.id, contactEmail: r.contactEmail, requirementIds: r.requirementIds, projectIds: r.projectIds, fullPortal: false, days: org.settings.defaultLinkExpiryDays, requestId: r.id });
        await svc.db.update(C.doc(org.id, 'requests', r.id), { linkId: link.linkId });
        const requester = members.find((m) => m.uid === r.createdBy.uid && m.status === 'active');
        const last = due.index === chase.afterDays.length - 1;
        const log = await sendEmail(base, {
          to: r.contactEmail, template: 'sub.chase', dedupeKey: `chase:${key}`, replyTo: requester?.email,
          subject: `Reminder: ${org.name} is still waiting for ${names.length === 1 ? names[0] : `${names.length} documents`}`,
          heading: last ? 'Final reminder: documents still needed' : 'Documents still needed',
          body: [
            `Hello ${r.contactName ?? ''}`.trim() + ',',
            `${org.name} asked ${sub.legalName} for the following on ${formatDate(r.createdAt)}, and hasn't received ${names.length === 1 ? 'it' : 'them'} yet:\n${names.map((n) => `• ${n}`).join('\n')}`,
            received.size ? 'Thank you for what you have already sent.' : '',
            'Open the secure link below to upload them. A PDF or a clear phone photo is fine, and no account is needed.',
            requester ? `Questions? Reply to this email to reach ${requester.name || requester.email}.` : '',
          ].filter(Boolean).join('\n\n'),
          cta: { label: 'Upload documents', url: link.url },
          footer: `This is an automatic reminder sent by SubCleared for ${org.name}. Reminders stop as soon as the documents are uploaded.`,
        });
        if (log.status === 'failed') throw new Error(log.error ?? 'Email failed');
        await svc.db.update(C.doc(org.id, 'reminders', key), { status: 'sent', emailStatus: log.status, at: svc.now().toISOString() });
        await audit({ ...base, source: 'scheduler' }, { action: 'request.reminder_sent', entity: { type: 'request', id: r.id, label: `${sub.legalName} — ${r.contactEmail}` }, after: { reminder: due.index + 1, of: chase.afterDays.length, outstanding: names, automated: true }, actor: { type: 'system', id: 'scheduler', name: 'Automatic follow-up' }, refs: [sub.id, ...r.projectIds] });
        chasers++;
      } catch (e: any) {
        failures++;
        await svc.db.update(C.doc(org.id, 'reminders', key), { status: 'failed', error: e.message?.slice(0, 300), at: svc.now().toISOString() });
      }
    }
  }
  if (!dailyDue) return { reminders, chasers, escalations, failures, today, inHours, daily: false };

  // 3. Close requests whose links have lapsed (chasers renew the link, so only abandoned requests close).
  const nowIso = svc.now().toISOString();
  const freshLinks = await svc.db.list<PortalLink>(C.col(org.id, 'links'));
  const freshRequests = await svc.db.list<DocumentRequest>(C.col(org.id, 'requests'));
  for (const r of freshRequests.filter((x) => ['sent', 'acknowledged', 'partially_fulfilled'].includes(x.status))) {
    const l = freshLinks.find((x) => x.id === r.linkId);
    const stillChasing = r.type === 'request' && chase.enabled && !sentKeys.has(`chase-esc:${r.id}`) && daysBetween(todayIn(org.settings.timezone, new Date(r.createdAt)), today) <= chase.escalateAfterDays;
    if (l && (l.revokedAt || l.expiresAt < nowIso) && r.createdBy.uid !== 'system' && !(stillChasing && !l.revokedAt)) await svc.db.update(C.doc(org.id, 'requests', r.id), { status: 'expired' });
  }

  // 4. Date-driven readiness changes (expiring soon / expired).
  await recompute(base, {}, 'scheduled.daily', 'scheduler');

  // 5. Escalations: mandatory items still missing beyond the configured period.
  const readiness = await svc.db.list<Evaluation & { id: string }>(C.col(org.id, 'readiness'));
  for (const r of readiness) {
    const a = assignments.find((x) => x.active && x.projectId === r.projectId && x.subcontractorId === r.subcontractorId);
    const p = projects.find((x) => x.id === r.projectId);
    if (!a || !p || !liveProjects.has(p.id)) continue;
    if (daysBetween(a.assignedAt.slice(0, 10), today) < org.settings.escalationDays) continue;
    for (const x of r.results.filter((y) => y.blocking && ['missing', 'requested', 'overdue'].includes(y.status))) {
      const key = `esc:${p.id}:${r.subcontractorId}:${x.requirementId}`;
      try { await svc.db.create(C.doc(org.id, 'reminders', key), { id: key, type: 'escalation', status: 'sent', at: nowIso }); } catch { continue; }
      const recipients = [p.managerUid, ...p.adminUids].filter(Boolean) as string[];
      if (!recipients.length) recipients.push(...(await membersWith(base, 'requirements.manage')).map((m) => m.uid));
      await notifyMembers(base, recipients, {
        type: 'escalation', title: `Escalation: ${subsById.get(r.subcontractorId)?.legalName} still missing ${x.requirementName}`,
        body: `Mandatory for ${p.name}; outstanding for more than ${org.settings.escalationDays} days. ${x.reason}`, link: `/app/projects/${p.id}`, dedupeKey: key,
      });
      escalations++;
    }
  }

  // 6. Project threshold: alert when fewer than 80% of assigned subcontractors are ready.
  for (const p of projects.filter((x) => liveProjects.has(x.id) && x.status === 'active')) {
    const rs = readiness.filter((r) => r.projectId === p.id && assignments.some((a) => a.active && a.projectId === p.id && a.subcontractorId === r.subcontractorId));
    if (rs.length < 2) continue;
    const pct = Math.round((rs.filter((r) => r.readiness === 'ready').length / rs.length) * 100);
    if (pct >= 80) continue;
    await notifyMembers(base, [p.managerUid].filter(Boolean) as string[], {
      type: 'project_threshold', title: `${p.name}: only ${pct}% of subcontractors are ready`,
      body: `${rs.filter((r) => r.readiness === 'not_ready').length} not ready, ${rs.filter((r) => r.readiness === 'action_required').length} need attention.`, link: `/app/projects/${p.id}`, dedupeKey: `threshold:${p.id}:${today}`,
    });
  }
  return { reminders, chasers, escalations, failures, today, inHours, daily: true };
}

// --- Document reading ----------------------------------------------------------

/** Kept for the background function and dev server; the pipeline lives in ./ai. */
export async function runExtraction(svc: Services, orgId: string, versionId: string) {
  return processVersion(svc, orgId, versionId);
}
