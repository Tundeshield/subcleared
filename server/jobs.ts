import { applyOrgFormatting } from '../src/domain/locale';
// Background jobs: daily renewal reminders/escalations, and AI extraction.
// Every job is idempotent: reminder keys are created with create() (fails if
// it exists), so overlapping or retried runs cannot send duplicates.
import { chasingOf, dueChase, inWorkingHours, localClock, workingHoursOf } from '../src/domain/automation';
import { dueReminder } from '../src/domain/compliance';
import { daysBetween, formatDate, todayIn } from '../src/domain/dates';
import { processVersion } from './ai';
import { provisionIntake, recoverIntake } from './intake';
import type { Assignment, DocumentRecord, DocumentRequest, DocumentVersion, Evaluation, Member, Organisation, PortalLink, Project, RequirementDefinition, Subcontractor } from '../src/domain/types';
import { AlreadyExistsError } from './db';
import { audit, C, membersWith, notifyMembers } from './core';
import { recompute } from './data';
import { replyToFor, sendEmail } from './email';
import { issuePortalLink } from './handlers/requests';
import type { Services } from './services';
import { subscriptionUsable } from './handlers/billing';
import { reportError } from './ops';

export interface JobOptions { orgId?: string; /** Dev/test only: send now regardless of working hours, and rerun daily steps. */ force?: boolean }

export async function runDailyJobs(svc: Services, opts: JobOptions = {}) {
  const orgs = opts.orgId ? [await svc.db.get<Organisation>(C.org(opts.orgId))].filter(Boolean) as Organisation[] : await svc.db.list<Organisation>('orgs');
  const summary: any[] = [];
  for (const org of orgs) {
    applyOrgFormatting(org.settings);
    try { summary.push({ orgId: org.id, ...(await runForOrg(svc, org, opts)) }); } catch (e: any) {
      await reportError(svc, { fn: 'jobs', op: 'runForOrg', orgId: org.id, error: e, retry: 'will_retry' });
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
  // Organisations created before automatic intake get their address here, once.
  if (!org.settings.intakeKey) await provisionIntake(svc, org).catch((e) => reportError(svc, { fn: 'jobs', op: 'provisionIntake', orgId: org.id, error: e, retry: 'will_retry' }));
  // Recover background work that failed or stalled, whatever the hour.
  const recovered = await recoverWork(svc, org).catch(async (e) => { await reportError(svc, { fn: 'jobs', op: 'recoverWork', orgId: org.id, error: e, retry: 'will_retry' }); return 0; });
  let dailyDue = true;
  if (!opts.force) { try { await svc.db.create(C.doc(org.id, 'reminders', `daily:${today}`), { id: `daily:${today}`, status: 'sent', at: svc.now().toISOString() }); } catch { dailyDue = false; } }

  // 0. One short daily email per manager with only what needs them (after 07:00 local, working days).
  const digests = await sendDigests(svc, org, opts).catch(async (e) => { await reportError(svc, { fn: 'jobs', op: 'digest', orgId: org.id, error: e, retry: 'will_retry' }); return 0; });

  // 1. Expiry reminders for the evidence currently in force.
  const due_: { key: string; d: DocumentRecord; v: DocumentVersion; sub: Subcontractor; exp: string; days: number; offset: number }[] = [];
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
    due_.push({ key, d, v, sub, exp, days, offset: due.offset });
  }
  // Group what's due by subcontractor contact: one email listing every document, each with its own upload link.
  if (due_.length) {
    const problems = new Set((await svc.db.list<any>(C.col(org.id, 'emailProblems'))).map((p) => p.email));
    const bySub = new Map<string, typeof due_>();
    for (const x of due_) bySub.set(x.sub.id, [...(bySub.get(x.sub.id) ?? []), x]);
    for (const [, items] of bySub) {
      const sub = items[0].sub;
      try {
        const contact = sub.contacts.find((c) => c.primary && !problems.has(c.email.toLowerCase())) ?? sub.contacts.find((c) => !problems.has(c.email.toLowerCase()));
        let emailStatus = contact ? 'no_contact' : sub.contacts.length ? 'address_problem' : 'no_contact';
        const lines: { text: string; url: string; item: (typeof items)[number] }[] = [];
        if (contact) {
          for (const x of items) {
            if (!x.d.requirementId) continue;
            // One open renewal request per document version; reuse it if present.
            let req = requests.find((r) => r.renewalOfVersionId === x.v.id && ['sent', 'acknowledged', 'partially_fulfilled'].includes(r.status));
            const link = await issuePortalLink(base, { subcontractorId: sub.id, contactEmail: contact.email, requirementIds: [x.d.requirementId], projectIds: [], fullPortal: false, days: Math.max(org.settings.defaultLinkExpiryDays, 7), requestId: req?.id });
            if (!req) {
              req = {
                id: svc.db.newId(), type: 'renewal', subcontractorId: sub.id, contactId: contact.id, contactEmail: contact.email, contactName: contact.name, projectIds: [],
                requirementIds: [x.d.requirementId], status: 'sent', linkId: link.linkId, createdBy: { uid: 'system', name: 'Automatic reminder' }, createdAt: svc.now().toISOString(),
                renewalOfVersionId: x.v.id, dueDate: x.exp,
              };
              await svc.db.set(C.doc(org.id, 'requests', req.id), req as any);
              requests.push(req);
              await svc.db.update(C.doc(org.id, 'links', link.linkId), { requestId: req.id });
            }
            const name = (x.d.requirementId ? defsById.get(x.d.requirementId)?.name : undefined) ?? x.d.title;
            const when = x.days > 0 ? `expires ${formatDate(x.exp)} (in ${x.days} day${x.days === 1 ? '' : 's'})` : x.days === 0 ? 'expires today' : `expired ${formatDate(x.exp)}`;
            lines.push({ text: `${name}: ${when} — upload the renewal`, url: link.url, item: x });
          }
        }
        if (contact && lines.length) {
          const one = lines.length === 1 ? lines[0].item : undefined;
          const oneName = one ? ((one.d.requirementId ? defsById.get(one.d.requirementId)?.name : undefined) ?? one.d.title) : '';
          const anyExpired = lines.some((l) => l.item.days < 0);
          const log = await sendEmail(base, {
            to: contact.email, template: 'sub.renewal_reminder', dedupeKey: `reminder:${lines.map((l) => l.item.key).sort().join('|')}`, replyTo: replyToFor(base),
            subject: one ? (one.days >= 0 ? `${oneName} ${one.days === 0 ? 'expires today' : `expires in ${one.days} days`} — ${org.name}` : `${oneName} has expired — ${org.name}`) : `${lines.length} documents need renewing — ${org.name}`,
            heading: anyExpired && one ? 'Your document has expired' : one ? 'Please send an updated document' : 'Please send updated documents',
            body: `Hello ${contact.name},\n\n${one ? `The ${oneName} we hold for ${sub.legalName} ${lines[0].text.split(': ')[1].replace(' — upload the renewal', '')}.` : `Some documents we hold for ${sub.legalName} are expiring or have expired.`}\n\nPlease upload the renewed ${one ? 'document' : 'documents'} using the secure ${one ? 'link' : 'links'} below so ${org.name} can keep your records current.`,
            ...(one ? { cta: { label: 'Upload the renewal', url: lines[0].url } } : { groups: [{ title: sub.legalName, lines: lines.map(({ text, url }) => ({ text, url })) }] }),
          });
          emailStatus = log.status;
          if (log.status === 'failed') throw new Error(log.error ?? 'Email failed');
        }
        // One in-app note per subcontractor, not one per document.
        const owners = [sub.ownerUid, ...(await membersWith(base, 'requirements.manage')).map((m) => m.uid)].filter(Boolean) as string[];
        const names = items.map((x) => (x.d.requirementId ? defsById.get(x.d.requirementId)?.name : undefined) ?? x.d.title);
        const worst = Math.min(...items.map((x) => x.days));
        await notifyMembers(base, owners, {
          type: worst < 0 ? 'expired' : 'expiring', title: `${sub.legalName}: ${names.length === 1 ? names[0] : `${names.length} documents`} ${worst < 0 ? (names.length === 1 ? 'has expired' : 'expiring or expired') : worst === 0 ? 'expire today' : `expiring within ${worst} days`}`,
          body: contact ? `Renewal requested from ${contact.email}${names.length > 1 ? `: ${names.join(', ')}` : ''}.` : 'No contact on file — add one to request the renewal.', link: `/app/renewals`, dedupeKey: `exp:${items.map((x) => x.key).sort().join('|')}`,
        });
        for (const x of items) {
          await svc.db.update(C.doc(org.id, 'reminders', x.key), { status: 'sent', emailStatus, at: svc.now().toISOString() });
          await audit({ ...base, source: 'scheduler' }, { action: 'notification.renewal_reminder', entity: { type: 'document', id: x.d.id, label: x.d.title }, after: { offset: x.offset, expiryDate: x.exp, emailStatus, to: contact?.email, groupedWith: items.length - 1 }, actor: { type: 'system', id: 'scheduler', name: 'Reminder scheduler' }, refs: [sub.id] });
          reminders++;
        }
      } catch (e: any) {
        failures++;
        for (const x of items) await svc.db.update(C.doc(org.id, 'reminders', x.key), { status: 'failed', error: e.message?.slice(0, 300), at: svc.now().toISOString() });
      }
    }
  }

  // 2. Follow up unanswered requests, then escalate to the person who asked.
  const chase = chasingOf(org.settings);
  if (inHours && chase.enabled) {
    const members = await svc.db.list<Member>(C.col(org.id, 'members'));
    const badAddresses = new Set((await svc.db.list<any>(C.col(org.id, 'emailProblems'))).map((p) => p.email));
    for (const r of requests.filter((x) => x.type === 'request' && ['sent', 'acknowledged', 'partially_fulfilled'].includes(x.status))) {
      const sub = subsById.get(r.subcontractorId);
      if (!sub || ['archived', 'suspended'].includes(sub.status)) continue;
      if (badAddresses.has(r.contactEmail.toLowerCase())) continue; // bounced or complained: a person has been told
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
          to: r.contactEmail, template: 'sub.chase', dedupeKey: `chase:${key}`, replyTo: replyToFor(base, requester?.email),
          subject: `Reminder: ${org.name} is still waiting for ${names.length === 1 ? names[0] : `${names.length} documents`}`,
          heading: last ? 'Final reminder: documents still needed' : 'Documents still needed',
          body: [
            `Hello ${r.contactName ?? ''}`.trim() + ',',
            `${org.name} asked ${sub.legalName} for the following on ${formatDate(r.createdAt)}, and hasn't received ${names.length === 1 ? 'it' : 'them'} yet:\n${names.map((n) => `• ${n}`).join('\n')}`,
            received.size ? 'Thank you for what you have already sent.' : '',
            `Open the secure link below to upload them. A PDF or a clear phone photo is fine, and no account is needed.${replyToFor(base)?.length ? ' You can also reply to this email with the documents attached.' : ''}`,
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
  if (!dailyDue) return { reminders, chasers, escalations, failures, recovered, digests, today, inHours, daily: false };

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

  // 5. Escalation for paperwork nobody is chasing. Anything on an open request is already followed up
  // and escalated once by step 2, so it is skipped here. What's left (no contact, request closed) gets
  // one notification per subcontractor and project, listing everything still missing, once.
  // (Replaces the old per-item escalations; the project "below 80% ready" alert is folded into the daily digest.)
  const readiness = await svc.db.list<Evaluation & { id: string }>(C.col(org.id, 'readiness'));
  const openReqs = requests.filter((q) => ['sent', 'acknowledged', 'partially_fulfilled'].includes(q.status));
  for (const r of readiness) {
    const a = assignments.find((x) => x.active && x.projectId === r.projectId && x.subcontractorId === r.subcontractorId);
    const p = projects.find((x) => x.id === r.projectId);
    if (!a || !p || !liveProjects.has(p.id)) continue;
    if (daysBetween(a.assignedAt.slice(0, 10), today) < org.settings.escalationDays) continue;
    const unchased = r.results.filter((y) => y.blocking && ['missing', 'requested', 'overdue'].includes(y.status)
      && defsById.get(y.requirementId)?.kind === 'document'
      && !openReqs.some((q) => q.subcontractorId === r.subcontractorId && q.requirementIds.includes(y.requirementId)));
    if (!unchased.length) continue;
    const key = `esc-sub:${p.id}:${r.subcontractorId}`;
    try { await svc.db.create(C.doc(org.id, 'reminders', key), { id: key, type: 'escalation', status: 'sent', at: nowIso, items: unchased.map((x) => x.requirementId) }); } catch { continue; }
    const recipients = [p.managerUid, ...p.adminUids].filter(Boolean) as string[];
    if (!recipients.length) recipients.push(...(await membersWith(base, 'requirements.manage')).map((m) => m.uid));
    const sub = subsById.get(r.subcontractorId);
    await notifyMembers(base, recipients, {
      type: 'escalation', title: `${sub?.legalName} still missing ${unchased.length === 1 ? unchased[0].requirementName : `${unchased.length} documents`} for ${p.name}`,
      body: `${unchased.map((x) => x.requirementName).join(', ')}. Nothing is being chased${sub && !sub.contacts.length ? ' because there is no contact on file' : ''}: request it or add a contact.`, link: `/app/subcontractors/${r.subcontractorId}?tab=requirements&project=${p.id}`, dedupeKey: key,
    });
    escalations++;
  }

  return { reminders, chasers, escalations, failures, recovered, digests, today, inHours, daily: true };
}

// --- Recovery --------------------------------------------------------------------

/** Re-queues document reading that failed or stalled (up to three attempts in total), and email intake work. */
async function recoverWork(svc: Services, org: Organisation) {
  let n = await recoverIntake(svc, org);
  if (!svc.ai) return n;
  const now = svc.now().getTime();
  for (const v of await svc.db.list<DocumentVersion & { extractionAttempts?: number }>(C.col(org.id, 'versions'))) {
    const x = v.extraction;
    if (!v.storagePath || v.scan?.status !== 'clean' || (v.extractionAttempts ?? 1) >= 3) continue;
    const since = new Date(x.startedAt ?? v.uploadedAt).getTime();
    const stuck = (x.status === 'queued' || x.status === 'processing') && now - since > 20 * 60_000;
    const failed = x.status === 'failed';
    const neverStarted = x.status === 'not_configured' && now - new Date(v.uploadedAt).getTime() < 7 * 86_400_000; // reading was switched on after upload
    if (!(stuck || failed || neverStarted)) continue;
    await svc.db.update(C.doc(org.id, 'versions', v.id), { extraction: { status: 'queued' }, extractionAttempts: (v.extractionAttempts ?? 1) + 1 });
    await svc.queueExtraction(org.id, v.id).catch(() => undefined);
    n++;
  }
  return n;
}

// --- Document reading ----------------------------------------------------------

/** Kept for the background function and dev server; the pipeline lives in ./ai. */
export async function runExtraction(svc: Services, orgId: string, versionId: string) {
  return processVersion(svc, orgId, versionId);
}

// --- Daily digest ------------------------------------------------------------------
/**
 * One email per manager per working day, from the same list as the overview's "Needs your attention",
 * so it only ever holds things a person can act on. Nothing is sent when that list is empty.
 */
export async function sendDigests(svc: Services, org: Organisation, opts: JobOptions = {}) {
  const today = todayIn(org.settings.timezone, svc.now());
  const clock = localClock(org.settings.timezone, svc.now());
  if (!opts.force && (clock.hour < 7 || !workingHoursOf(org.settings).days.includes(clock.weekday))) return 0;
  const { permissionsFor } = await import('../src/domain/permissions');
  const { dashboard } = await import('./handlers/org');
  const members = (await svc.db.list<Member>(C.col(org.id, 'members'))).filter((m) => m.status === 'active' && m.digest !== false
    && (permissionsFor(m).has('documents.review') || permissionsFor(m).has('requests.send')));
  let sent = 0;
  for (const m of members) {
    const key = `digest:${m.uid}:${today}`;
    if (!(await claimReminder(svc, org, key, { type: 'digest', uid: m.uid }))) continue;
    try {
      const ctx: any = { svc, db: svc.db, org, member: m, identity: { uid: m.uid, email: m.email, emailVerified: true, name: m.name }, source: 'scheduler' };
      const d = await dashboard(ctx, { full: true });
      const lines: { group: string; text: string; url: string }[] = d.needs.map((n: any) => ({ group: n.context ? `${n.item} · ${n.context}` : n.item, text: `${n.issue} — ${n.action}`, url: `${svc.env.appUrl}${n.link}` }));
      if (d.mailHealth && d.mailHealth.status && d.mailHealth.status !== 'ok') lines.unshift({ group: 'Email delivery', text: 'Emails to subcontractors are failing — Fix in Settings', url: `${svc.env.appUrl}/app/settings/delivery` });
      if (!lines.length) { await svc.db.update(C.doc(org.id, 'reminders', key), { status: 'sent', empty: true, at: svc.now().toISOString() }); continue; }
      const groups = new Map<string, { text: string; url: string }[]>();
      for (const l of lines) groups.set(l.group, [...(groups.get(l.group) ?? []), { text: l.text, url: l.url }]);
      const n = lines.length;
      const log = await sendEmail({ db: svc.db, svc, org }, {
        to: m.email, template: 'member.digest', dedupeKey: key,
        subject: `${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} you today — ${org.name}`,
        heading: `${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} you today`,
        body: [d.waiting?.subcontractors ? `${d.waiting.subcontractors} subcontractor${d.waiting.subcontractors === 1 ? ' is' : 's are'} still sending paperwork; reminders are going out automatically.` : ''].filter(Boolean).join('') || 'Everything else is running on its own.',
        groups: [...groups].slice(0, 15).map(([title, ls]) => ({ title, lines: ls })),
        cta: { label: 'Open SubCleared', url: `${svc.env.appUrl}/app/overview` },
        footer: 'A daily summary of what needs a decision. Turn it off in Settings → Profile and notifications.',
      });
      await svc.db.update(C.doc(org.id, 'reminders', key), { status: log.status === 'failed' ? 'failed' : 'sent', items: n, at: svc.now().toISOString() });
      if (log.status !== 'failed') sent++;
    } catch (e: any) {
      await svc.db.update(C.doc(org.id, 'reminders', key), { status: 'failed', error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return sent;
}
