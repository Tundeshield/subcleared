import { addDays, daysBetween, formatDate, isISODate, todayIn } from '../../src/domain/dates';
import type { DocumentRecord, DocumentRequest, DocumentVersion, Organisation, PortalLink, RequirementDefinition, Subcontractor } from '../../src/domain/types';
import { audit, bad, C, type Ctx, id, ids, need, notFound, oneOf, randomToken, sha256, str } from '../core';
import { loadOrgData, recompute } from '../data';
import type { Db } from '../db';
import { sendEmail } from '../email';
import type { Services } from '../services';
import { loadSub, visibleSubIds } from './subs';

interface Base { db: Db; svc: Services; org: Organisation; member?: { uid: string; name: string } }

/**
 * Issues a secure external link. The raw token (256 bits) is only ever placed
 * in the URL sent to the contact; we store its SHA-256 hash, so a database
 * leak does not expose working links. Links are scoped, expire and can be revoked.
 */
export async function issuePortalLink(base: Base, o: {
  subcontractorId: string; contactEmail: string; requirementIds: string[]; projectIds: string[]; fullPortal: boolean; days: number; requestId?: string; requireEmailCode?: boolean;
}) {
  const token = randomToken(32);
  const hash = sha256(token);
  const now = base.svc.now();
  const link: PortalLink = {
    id: base.db.newId(), tokenHash: hash, requestId: o.requestId, subcontractorId: o.subcontractorId, contactEmail: o.contactEmail,
    scope: { requirementIds: o.requirementIds, projectIds: o.projectIds, fullPortal: o.fullPortal }, requireEmailCode: !!o.requireEmailCode,
    expiresAt: new Date(now.getTime() + o.days * 86_400_000).toISOString(), createdAt: now.toISOString(), createdBy: base.member?.uid ?? 'system', useCount: 0,
  };
  await base.db.set(C.doc(base.org.id, 'links', link.id), link as any);
  await base.db.set(`portalTokens/${hash}`, { orgId: base.org.id, linkId: link.id, subcontractorId: o.subcontractorId, expiresAt: link.expiresAt });
  return { linkId: link.id, url: `${base.svc.env.appUrl}/portal/${token}`, expiresAt: link.expiresAt };
}

export async function revokeLinkById(base: Base, linkId: string, by: string) {
  const l = await base.db.get<PortalLink>(C.doc(base.org.id, 'links', linkId));
  if (!l) throw notFound('Link not found');
  if (l.revokedAt) return l;
  const at = base.svc.now().toISOString();
  await base.db.update(C.doc(base.org.id, 'links', linkId), { revokedAt: at, revokedBy: by });
  await base.db.update(`portalTokens/${l.tokenHash}`, { revokedAt: at }).catch(() => undefined);
  return l;
}

export async function createRequest(ctx: Ctx, input: any) {
  need(ctx, 'requests.send');
  const s = await loadSub(ctx, input.subcontractorId);
  if (['suspended', 'archived'].includes(s.status)) throw bad(`${s.legalName} is ${s.status}; restore them before requesting documents`);
  const type = oneOf(input.type ?? 'request', ['request', 'renewal', 'portal_access'] as const, 'Request type');
  const contactIds = ids(input.contactIds, 'Contacts');
  const contacts = s.contacts.filter((c) => contactIds.includes(c.id));
  if (!contacts.length) throw bad('Choose at least one contact. Add a contact to the subcontractor first if needed.');
  const requirementIds = ids(input.requirementIds, 'Requirements');
  if (type !== 'portal_access' && !requirementIds.length) throw bad('Choose at least one requirement to request');
  const defs = await ctx.db.getMany<RequirementDefinition>(requirementIds.map((r) => C.doc(ctx.org.id, 'requirements', r)));
  if (defs.some((d) => !d)) throw bad('Unknown requirement');
  const projectIds = ids(input.projectIds, 'Projects');
  const message = str(input.message, 'Message', { max: 2000 });
  let dueDate: string | undefined;
  if (input.dueDate) { if (!isISODate(input.dueDate)) throw bad('Due date is invalid'); dueDate = input.dueDate; }
  const maxDays = type === 'portal_access' ? 90 : 30;
  const days = Math.min(Math.max(Number(input.expiresInDays) || (type === 'portal_access' ? 90 : ctx.org.settings.defaultLinkExpiryDays), 1), maxDays);
  const projects = projectIds.length ? (await ctx.db.getMany<any>(projectIds.map((p) => C.doc(ctx.org.id, 'projects', p)))).filter(Boolean) : [];
  const results = [];
  for (const contact of contacts) {
    const rid = ctx.db.newId();
    const link = await issuePortalLink(ctx, {
      subcontractorId: s.id, contactEmail: contact.email, requirementIds, projectIds, fullPortal: type === 'portal_access', days, requestId: rid,
      requireEmailCode: type === 'portal_access',
    });
    const req: DocumentRequest = {
      id: rid, type, subcontractorId: s.id, contactId: contact.id, contactEmail: contact.email, contactName: contact.name, projectIds, requirementIds,
      message, dueDate, status: 'sent', linkId: link.linkId, createdBy: { uid: ctx.member.uid, name: ctx.member.name }, createdAt: ctx.svc.now().toISOString(),
      renewalOfVersionId: input.renewalOfVersionId,
    };
    await ctx.db.set(C.doc(ctx.org.id, 'requests', rid), req as any);
    const list = defs.map((d) => `• ${d!.name}`).join('\n');
    const log = await sendEmail(ctx, {
      to: contact.email, template: `sub.${type}`, dedupeKey: `request:${rid}`, replyTo: ctx.member.email,
      subject: type === 'portal_access' ? `${ctx.org.name} invited you to its compliance portal` : type === 'renewal' ? `${ctx.org.name}: please send an updated document` : `${ctx.org.name} requests compliance documents`,
      heading: type === 'portal_access' ? `Manage your paperwork for ${ctx.org.name}` : `${ctx.org.name} needs documents from ${s.legalName}`,
      body: [
        `Hello ${contact.name},`,
        type === 'portal_access'
          ? `${ctx.org.name} uses SubCleared to manage subcontractor compliance. Use the secure link below to see what's required, upload documents and keep them up to date. You'll confirm your email with a one-time code.`
          : `Please upload the following${projects.length ? ` for ${projects.map((p: any) => p.name).join(', ')}` : ''}:\n${list}`,
        message ? `Message from ${ctx.member.name}: ${message}` : '',
        dueDate ? `Please submit by ${formatDate(dueDate)}.` : '',
        type === 'portal_access' ? '' : 'How to send them: open the link, choose each document and upload a PDF or a clear photo — from a phone is fine. You can see what has been accepted and replace anything that needs changing.',
        `No account is needed. This secure link is for ${contact.email} only and expires in ${days} days.`,
        `Questions about what's needed? Reply to this email to reach ${ctx.member.name} at ${ctx.org.name}.`,
      ].filter(Boolean).join('\n\n'),
      cta: { label: type === 'portal_access' ? 'Open the portal' : 'Upload documents', url: link.url },
    });
    await audit(ctx, { action: `request.${type === 'portal_access' ? 'portal_invited' : 'sent'}`, entity: { type: 'request', id: rid, label: `${s.legalName} — ${contact.email}` }, after: { requirements: defs.map((d) => d!.name), projectIds, dueDate, expiresInDays: days, email: log.status }, refs: [s.id, ...projectIds] });
    results.push({ requestId: rid, contact: contact.email, url: link.url, expiresAt: link.expiresAt, emailStatus: log.status, emailError: log.error });
  }
  if (type === 'portal_access') {
    const next = s.contacts.map((c) => (contactIds.includes(c.id) ? { ...c, portalAccess: true } : c));
    await ctx.db.update(C.doc(ctx.org.id, 'subcontractors', s.id), { contacts: next, ...(s.status === 'onboarding' ? {} : {}) });
  }
  await recompute(ctx, { subcontractorId: s.id }, 'request.sent');
  return { results };
}

export async function listRequests(ctx: Ctx, input: any) {
  const data = await loadOrgData(ctx.db, ctx.org.id, ['requests', 'subs', 'requirements', 'projects', 'assignments']);
  const visible = visibleSubIds(ctx, data);
  const links = await ctx.db.list<PortalLink>(C.col(ctx.org.id, 'links'));
  const subs = new Map(data.subs.map((s) => [s.id, s.legalName]));
  const defs = new Map(data.requirements.map((r) => [r.id, r.name]));
  const now = ctx.svc.now().toISOString();
  let items = data.requests.filter((r) => !visible || visible.has(r.subcontractorId)).map((r) => {
    const l = links.find((x) => x.id === r.linkId);
    return {
      ...r, subcontractor: subs.get(r.subcontractorId), requirements: r.requirementIds.map((x) => defs.get(x) ?? 'Removed requirement'),
      link: l && { id: l.id, expiresAt: l.expiresAt, revokedAt: l.revokedAt, lastUsedAt: l.lastUsedAt, useCount: l.useCount, expired: l.expiresAt < now },
    };
  });
  if (input?.status) items = items.filter((i) => i.status === input.status);
  if (input?.subcontractorId) items = items.filter((i) => i.subcontractorId === input.subcontractorId);
  return { items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}

export async function revokeLink(ctx: Ctx, input: any) {
  need(ctx, 'requests.send');
  const lid = id(input.linkId, 'Link');
  const l = await ctx.db.get<PortalLink>(C.doc(ctx.org.id, 'links', lid));
  if (!l) throw notFound('Link not found');
  await loadSub(ctx, l.subcontractorId);
  await revokeLinkById(ctx, lid, ctx.member.uid);
  if (l.requestId) {
    const r = await ctx.db.get<DocumentRequest>(C.doc(ctx.org.id, 'requests', l.requestId));
    if (r && ['sent', 'acknowledged', 'partially_fulfilled'].includes(r.status) && input.cancelRequest) await ctx.db.update(C.doc(ctx.org.id, 'requests', r.id), { status: 'cancelled' });
  }
  await audit(ctx, { action: 'request.link_revoked', entity: { type: 'link', id: lid, label: l.contactEmail }, refs: [l.subcontractorId, ...(l.requestId ? [l.requestId] : [])] });
  if (input.cancelRequest) await recompute(ctx, { subcontractorId: l.subcontractorId }, 'request.cancelled');
  return { ok: true };
}

/** Re-sends a request: revokes the old link and issues a fresh one (tokens are never stored, so they can't be re-sent). */
export async function resendRequest(ctx: Ctx, input: any) {
  need(ctx, 'requests.send');
  const r = await ctx.db.get<DocumentRequest>(C.doc(ctx.org.id, 'requests', id(input.requestId, 'Request')));
  if (!r) throw notFound('Request not found');
  const s = await loadSub(ctx, r.subcontractorId);
  if (!['sent', 'acknowledged', 'partially_fulfilled', 'expired'].includes(r.status)) throw bad('Only open requests can be re-sent');
  await revokeLinkById(ctx, r.linkId, ctx.member.uid).catch(() => undefined);
  await ctx.db.update(C.doc(ctx.org.id, 'requests', r.id), { status: 'cancelled' });
  const contact = s.contacts.find((c) => c.id === r.contactId) ?? s.contacts.find((c) => c.email === r.contactEmail);
  if (!contact) throw bad('That contact no longer exists');
  return createRequest(ctx, { subcontractorId: s.id, type: r.type, contactIds: [contact.id], requirementIds: r.requirementIds, projectIds: r.projectIds, message: r.message, dueDate: r.dueDate, renewalOfVersionId: r.renewalOfVersionId });
}

// --- Renewals -------------------------------------------------------------------

export async function listRenewals(ctx: Ctx, input: any) {
  const data = await loadOrgData(ctx.db, ctx.org.id, ['documents', 'versions', 'subs', 'requirements', 'requests', 'projects', 'assignments']);
  const visible = visibleSubIds(ctx, data);
  const today = todayIn(ctx.org.settings.timezone, ctx.svc.now());
  const horizon = Math.min(Number(input?.days) || 90, 365);
  const subs = new Map(data.subs.map((s) => [s.id, s]));
  const defs = new Map(data.requirements.map((r) => [r.id, r]));
  const versions = new Map(data.versions.map((v) => [v.id, v]));
  const items = data.documents.filter((d) => !d.archived && d.approvedVersionId && (!visible || visible.has(d.subcontractorId))).map((d) => {
    const v = versions.get(d.approvedVersionId!)!;
    if (!v?.metadata.expiryDate) return null;
    const days = daysBetween(today, v.metadata.expiryDate);
    if (days > horizon) return null;
    const sub = subs.get(d.subcontractorId);
    if (!sub || sub.status === 'archived') return null;
    const renewal = data.requests.filter((r) => r.renewalOfVersionId === v.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const replacement = data.versions.filter((x) => x.documentId === d.id && x.uploadedAt > v.uploadedAt && !['uploading', 'quarantined'].includes(x.reviewStatus)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
    const stage = replacement ? (replacement.reviewStatus === 'approved' ? 'renewed' : replacement.reviewStatus === 'rejected' ? 'replacement_rejected' : 'replacement_received')
      : renewal ? (renewal.acknowledgedAt || renewal.status === 'acknowledged' ? 'acknowledged' : ['cancelled', 'expired'].includes(renewal.status) ? 'not_requested' : 'requested') : 'not_requested';
    const pids = d.projectIds.length ? d.projectIds : data.assignments.filter((a) => a.active && a.subcontractorId === d.subcontractorId).map((a) => a.projectId);
    const projects = pids.map((pid) => data.projects.find((p) => p.id === pid)).filter((p) => p && p.status !== 'archived').map((p) => ({ id: p!.id, name: p!.name }));
    return {
      projects, category: d.requirementId ? defs.get(d.requirementId)?.category : 'Other', issuer: v.metadata.issuer,
      documentId: d.id, versionId: v.id, title: d.title, requirement: d.requirementId ? defs.get(d.requirementId)?.name : undefined, requirementId: d.requirementId,
      subcontractorId: d.subcontractorId, subcontractor: sub.legalName, expiryDate: v.metadata.expiryDate, days, stage,
      request: renewal && { id: renewal.id, status: renewal.status, createdAt: renewal.createdAt, contactEmail: renewal.contactEmail, acknowledgedAt: renewal.acknowledgedAt },
      replacementVersionId: replacement?.id, contacts: sub.contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, primary: c.primary })),
    };
  }).filter(Boolean).sort((a: any, b: any) => a.days - b.days);
  const reminders = (await ctx.db.list<any>(C.col(ctx.org.id, 'reminders'))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
  return { items, today, reminders };
}

export async function requestRenewals(ctx: Ctx, input: any) {
  need(ctx, 'requests.send');
  const versionIds = ids(input.versionIds, 'Documents', 100);
  if (!versionIds.length) throw bad('Select at least one document');
  const out = [];
  for (const vid of versionIds) {
    const v = await ctx.db.get<DocumentVersion>(C.doc(ctx.org.id, 'versions', vid));
    if (!v || !v.requirementId) continue;
    const s = await loadSub(ctx, v.subcontractorId);
    const contact = s.contacts.find((c) => c.primary) ?? s.contacts[0];
    if (!contact) { out.push({ versionId: vid, error: `${s.legalName} has no contact` }); continue; }
    const r = await createRequest(ctx, { subcontractorId: s.id, type: 'renewal', contactIds: [contact.id], requirementIds: [v.requirementId], renewalOfVersionId: v.id, dueDate: v.metadata.expiryDate && v.metadata.expiryDate > todayIn(ctx.org.settings.timezone, ctx.svc.now()) ? v.metadata.expiryDate : addDays(todayIn(ctx.org.settings.timezone, ctx.svc.now()), 7) });
    out.push({ versionId: vid, ...r.results[0] });
  }
  return { results: out };
}

export type { DocumentRecord, Subcontractor };

const REQUESTABLE = new Set(['missing', 'not_requested', 'requested', 'overdue', 'rejected', 'expired', 'expiring_soon']);

/**
 * One step from a project: request every outstanding document from each chosen
 * subcontractor's primary contact. Built on createRequest, so links, emails,
 * reminders and audit behave exactly as for a single request.
 */
export async function requestForProject(ctx: Ctx, input: any) {
  need(ctx, 'requests.send');
  const projectId = id(input.projectId, 'Project');
  const project = await ctx.db.get<any>(C.doc(ctx.org.id, 'projects', projectId));
  if (!project) throw notFound('Project not found');
  const subIds = ids(input.subcontractorIds, 'Subcontractors');
  if (!subIds.length) throw bad('Choose at least one subcontractor');
  const results: { subcontractorId: string; name: string; status: 'sent' | 'skipped' | 'failed'; documents: number; detail?: string }[] = [];
  for (const sid of subIds) {
    const sub = await ctx.db.get<Subcontractor>(C.doc(ctx.org.id, 'subcontractors', sid));
    if (!sub) { results.push({ subcontractorId: sid, name: 'Unknown', status: 'failed', documents: 0, detail: 'Not found' }); continue; }
    const ev = await ctx.db.get<any>(C.doc(ctx.org.id, 'readiness', `${projectId}__${sid}`));
    const wanted = (ev?.results ?? []).filter((r: any) => REQUESTABLE.has(r.status)).map((r: any) => r.requirementId as string);
    const defs = (await ctx.db.getMany<RequirementDefinition>(wanted.map((r: string) => C.doc(ctx.org.id, 'requirements', r)))).filter((d): d is RequirementDefinition => !!d && d.kind === 'document');
    const contact = sub.contacts.find((c) => c.primary) ?? sub.contacts[0];
    if (!defs.length) { results.push({ subcontractorId: sid, name: sub.legalName, status: 'skipped', documents: 0, detail: 'Nothing outstanding to request' }); continue; }
    if (!contact) { results.push({ subcontractorId: sid, name: sub.legalName, status: 'skipped', documents: defs.length, detail: 'No contact with an email address' }); continue; }
    try {
      const r = await createRequest(ctx, { subcontractorId: sid, type: 'request', contactIds: [contact.id], requirementIds: defs.map((d) => d.id), projectIds: [projectId], dueDate: input.dueDate, message: input.message });
      const failed = r.results.find((x: any) => x.emailStatus === 'failed');
      results.push({ subcontractorId: sid, name: sub.legalName, status: failed ? 'failed' : 'sent', documents: defs.length, detail: failed ? `Link created but email not sent: ${failed.emailError}` : `Sent to ${contact.name}` });
    } catch (e: any) {
      results.push({ subcontractorId: sid, name: sub.legalName, status: 'failed', documents: defs.length, detail: e.message });
    }
  }
  return { results };
}
