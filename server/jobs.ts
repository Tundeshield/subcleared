import { applyOrgFormatting } from '../src/domain/locale';
// Background jobs: daily renewal reminders/escalations, and AI extraction.
// Every job is idempotent: reminder keys are created with create() (fails if
// it exists), so overlapping or retried runs cannot send duplicates.
import { dueReminder } from '../src/domain/compliance';
import { daysBetween, formatDate, todayIn } from '../src/domain/dates';
import { METADATA_FIELDS, VALUE_FIELDS } from '../src/domain/library';
import type { Assignment, DocumentRecord, DocumentRequest, DocumentVersion, Evaluation, Organisation, PortalLink, Project, RequirementDefinition, Subcontractor } from '../src/domain/types';
import { AlreadyExistsError } from './db';
import { audit, C, membersWith, notifyMembers } from './core';
import { recompute } from './data';
import { sendEmail } from './email';
import { issuePortalLink } from './handlers/requests';
import type { Services } from './services';
import { subscriptionUsable } from './handlers/billing';

export async function runDailyJobs(svc: Services, opts: { orgId?: string } = {}) {
  const orgs = opts.orgId ? [await svc.db.get<Organisation>(C.org(opts.orgId))].filter(Boolean) as Organisation[] : await svc.db.list<Organisation>('orgs');
  const summary: any[] = [];
  for (const org of orgs) {
    applyOrgFormatting(org.settings);
    try { summary.push({ orgId: org.id, ...(await runForOrg(svc, org)) }); } catch (e: any) {
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

async function runForOrg(svc: Services, org: Organisation) {
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
  let reminders = 0; let escalations = 0; let failures = 0;

  // 1. Expiry reminders for the evidence currently in force.
  for (const d of docs) {
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

  // 2. Close requests whose links have lapsed.
  const nowIso = svc.now().toISOString();
  for (const r of requests.filter((x) => ['sent', 'acknowledged', 'partially_fulfilled'].includes(x.status))) {
    const l = links.find((x) => x.id === r.linkId);
    if (l && (l.revokedAt || l.expiresAt < nowIso) && r.createdBy.uid !== 'system') await svc.db.update(C.doc(org.id, 'requests', r.id), { status: 'expired' });
  }

  // 3. Date-driven readiness changes (expiring soon / expired).
  await recompute(base, {}, 'scheduled.daily', 'scheduler');

  // 4. Escalations: mandatory items still missing beyond the configured period.
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

  // 5. Project threshold: alert when fewer than 80% of assigned subcontractors are ready.
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
  return { reminders, escalations, failures, today };
}

// --- AI extraction -------------------------------------------------------------

const EXTRACTION_PROMPT = `You are extracting metadata from a construction compliance document (for example a certificate of insurance, licence, or safety certificate) for a human reviewer to confirm.

Return ONLY a JSON object. For each field give {"value": <value or null>, "confidence": <0..1>, "note": <optional short note>}.
Rules:
- Only report what is printed in the document. If a field is not present or not legible, use null with confidence 0. Never guess or infer values.
- Dates must be YYYY-MM-DD exactly as printed (do not adjust for timezones).
- Monetary limits are plain numbers without currency symbols or commas; put the currency in the note.
- Booleans (additionalInsured, waiverOfSubrogation, wcCoverage) are true only if the document explicitly shows it.
- You are not determining legal validity or whether coverage exists; only transcribe.

Fields: ${[...METADATA_FIELDS.map((f) => f.key), ...VALUE_FIELDS.map((f) => f.key)].join(', ')}`;

export async function runExtraction(svc: Services, orgId: string, versionId: string) {
  const path = C.doc(orgId, 'versions', versionId);
  const v = await svc.db.get<DocumentVersion>(path);
  if (!v || !v.storagePath || v.scan.status !== 'clean') return { skipped: true };
  if (!svc.env.anthropicKey) { await svc.db.update(path, { extraction: { status: 'not_configured' } }); return { skipped: true }; }
  const startedAt = svc.now().toISOString();
  await svc.db.update(path, { extraction: { status: 'processing', startedAt, model: svc.env.anthropicModel } });
  try {
    const bytes = await svc.files.read(v.storagePath);
    if (!bytes) throw new Error('Stored file not found');
    const b64 = Buffer.from(bytes).toString('base64');
    const block = v.mimeType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: v.mimeType, data: b64 } };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': svc.env.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: svc.env.anthropicModel, max_tokens: 1500, messages: [{ role: 'user', content: [block, { type: 'text', text: EXTRACTION_PROMPT }] }] }),
    });
    const body: any = await res.json();
    if (!res.ok) throw new Error(body?.error?.message || `Extraction API ${res.status}`);
    const text = (body.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const allowed = new Set([...METADATA_FIELDS.map((f) => f.key), ...VALUE_FIELDS.map((f) => f.key)]);
    const fields: Record<string, any> = {};
    for (const [k, raw] of Object.entries(json)) {
      if (!allowed.has(k) || !raw || typeof raw !== 'object') continue;
      const r = raw as any;
      let value = r.value ?? null;
      const conf = Math.max(0, Math.min(1, Number(r.confidence) || 0));
      const fdef = METADATA_FIELDS.find((f) => f.key === k);
      if (fdef?.type === 'date' && value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) value = null; // reject malformed dates rather than guess
      fields[k] = { value, confidence: value === null ? 0 : conf, note: typeof r.note === 'string' ? r.note.slice(0, 200) : undefined };
    }
    await svc.db.update(path, { extraction: { status: 'completed', fields, model: svc.env.anthropicModel, startedAt, completedAt: svc.now().toISOString() } });
    return { ok: true };
  } catch (e: any) {
    await svc.db.update(path, { extraction: { status: 'failed', error: String(e.message ?? e).slice(0, 300), model: svc.env.anthropicModel, startedAt, completedAt: svc.now().toISOString() } });
    return { ok: false, error: e.message };
  }
}
