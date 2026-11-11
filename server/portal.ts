import { applyOrgFormatting } from '../src/domain/locale';
// External subcontractor portal. Access is by a secure link (hashed bearer
// token) and, for long-lived portal invitations, a one-time email code. Every
// call re-checks that the link is still valid, unrevoked and in scope, and
// only returns the subcontractor's own data for the requesting organisation.
import crypto from 'node:crypto';
import { READINESS_LABELS, STATUS_LABELS } from '../src/domain/compliance';
import { formatDate } from '../src/domain/dates';
import type {
  Assignment, DocumentRecord, DocumentRequest, DocumentVersion, Evaluation, Organisation, PortalLink, Project, RequirementDefinition, RequirementStatus, Subcontractor,
} from '../src/domain/types';
import { audit, bad, C, HttpError, id, rateLimit, reqStr, sha256, str } from './core';
import type { Db } from './db';
import { sendEmail } from './email';
import { createUploadSlot, finalizeUploadSlot } from './handlers/documents';
import type { Services } from './services';

const SESSION_MINUTES = 120;

interface Session { o: string; l: string; s: string; e: string; c: string; exp: number }

function sign(secret: string, payload: Session) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(`portal:${body}`).digest('base64url');
  return `${body}.${mac}`;
}
function verifySession(secret: string, token: unknown): Session {
  if (typeof token !== 'string' || !token.includes('.')) throw new HttpError(401, 'Your session has ended. Open your link again.', 'portal_session');
  const [body, mac] = token.split('.');
  const want = crypto.createHmac('sha256', secret).update(`portal:${body}`).digest('base64url');
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) throw new HttpError(401, 'Invalid session', 'portal_session');
  const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session;
  if (Date.now() > s.exp) throw new HttpError(401, 'Your session has ended. Open your link again.', 'portal_session');
  return s;
}

interface PortalCtx { svc: Services; db: Db; org: Organisation; link: PortalLink; sub: Subcontractor; contactId: string; contactName: string; ip?: string }

async function resolveLink(svc: Services, db: Db, tokenHash: string) {
  const ref = await db.get<{ orgId: string; linkId: string }>(`portalTokens/${tokenHash}`);
  if (!ref) throw new HttpError(404, 'This link is not valid. Ask the contractor to send you a new one.', 'link_invalid');
  const [org, link] = await db.getMany<any>([C.org(ref.orgId), C.doc(ref.orgId, 'links', ref.linkId)]) as [Organisation, PortalLink];
  if (org) applyOrgFormatting(org.settings);
  if (!org || !link) throw new HttpError(404, 'This link is not valid.', 'link_invalid');
  if (link.revokedAt) throw new HttpError(410, `This link was withdrawn by ${org.name}. Ask them for a new one if you still need to submit documents.`, 'link_revoked');
  if (new Date(link.expiresAt) < svc.now()) throw new HttpError(410, `This link expired on ${formatDate(link.expiresAt)}. Ask ${org.name} to send a new one.`, 'link_expired');
  const sub = await db.get<Subcontractor>(C.doc(org.id, 'subcontractors', link.subcontractorId));
  if (!sub) throw new HttpError(404, 'This link is not valid.', 'link_invalid');
  if (sub.status === 'suspended' || sub.status === 'archived') throw new HttpError(403, `${org.name} has paused document collection for ${sub.legalName}. Please contact them directly.`, 'sub_inactive');
  const contact = sub.contacts.find((c) => c.email === link.contactEmail);
  if (!contact) throw new HttpError(403, 'This contact no longer has access. Please contact the contractor.', 'contact_removed');
  return { org, link, sub, contact };
}

async function ctxFromSession(svc: Services, db: Db, session: unknown, ip?: string): Promise<PortalCtx> {
  const s = verifySession(svc.env.portalSecret, session);
  const link = await db.get<PortalLink>(C.doc(s.o, 'links', s.l));
  if (!link) throw new HttpError(401, 'Invalid session', 'portal_session');
  const r = await resolveLink(svc, db, link.tokenHash);
  if (r.contact.id !== s.c) throw new HttpError(401, 'Invalid session', 'portal_session');
  return { svc, db, org: r.org, link: r.link, sub: r.sub, contactId: r.contact.id, contactName: r.contact.name, ip };
}

function maskEmail(e: string) { const [u, d] = e.split('@'); return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`; }

export async function portalOpen(svc: Services, db: Db, input: any, ip?: string) {
  const token = reqStr(input.token, 'Link', 200);
  const hash = sha256(token);
  await rateLimit(db, `open:${hash}`, 30, 600, svc.now());
  if (ip) await rateLimit(db, `open-ip:${ip}`, 120, 600, svc.now());
  const { org, link, sub, contact } = await resolveLink(svc, db, hash);
  const base = { svc, db, org };
  if (link.requireEmailCode && !input.code) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await rateLimit(db, `code-send:${hash}`, 5, 900, svc.now());
    await db.set(`portalCodes/${hash}`, { codeHash: sha256(`${hash}:${code}`), attempts: 0, expiresAt: new Date(svc.now().getTime() + 10 * 60_000).toISOString() });
    const log = await sendEmail(base, {
      to: contact.email, template: 'sub.portal_code', subject: `Your SubCleared code: ${code}`, heading: 'Your one-time code',
      body: `Use this code to open ${org.name}'s compliance portal:\n\n${code}\n\nIt expires in 10 minutes. If you didn't request it, you can ignore this email.`,
    });
    return { needsCode: true, emailHint: maskEmail(contact.email), orgName: org.name, emailStatus: log.status, devCode: svc.mode === 'memory' ? code : undefined };
  }
  if (link.requireEmailCode) {
    const rec = await db.get<{ codeHash: string; attempts: number; expiresAt: string }>(`portalCodes/${hash}`);
    if (!rec || new Date(rec.expiresAt) < svc.now()) throw new HttpError(401, 'That code has expired. Request a new one.', 'code_expired');
    if (rec.attempts >= 5) throw new HttpError(429, 'Too many attempts. Request a new code.', 'code_locked');
    const ok = rec.codeHash === sha256(`${hash}:${String(input.code).trim()}`);
    if (!ok) { await db.update(`portalCodes/${hash}`, { attempts: rec.attempts + 1 }); throw new HttpError(401, 'That code is not correct.', 'code_wrong'); }
    await db.delete(`portalCodes/${hash}`);
  }
  const now = svc.now().toISOString();
  await db.update(C.doc(org.id, 'links', link.id), { lastUsedAt: now, useCount: (link.useCount ?? 0) + 1 });
  if (link.requestId) {
    const r = await db.get<DocumentRequest>(C.doc(org.id, 'requests', link.requestId));
    if (r && r.status === 'sent') await db.update(C.doc(org.id, 'requests', r.id), { status: 'acknowledged', acknowledgedAt: now });
  }
  if (!link.lastUsedAt) {
    await audit({ db, svc, org, ip, source: 'portal' }, { action: 'portal.link_opened', entity: { type: 'link', id: link.id, label: contact.email }, actor: { type: 'subcontractor', id: contact.id, name: `${contact.name} (${sub.legalName})` }, refs: [sub.id] });
  }
  const session = sign(svc.env.portalSecret, { o: org.id, l: link.id, s: sub.id, e: contact.email, c: contact.id, exp: Date.now() + SESSION_MINUTES * 60_000 });
  return { session, expiresInMinutes: SESSION_MINUTES };
}

const STATUS_FOR_SUB: Partial<Record<RequirementStatus, string>> = {
  approved: 'Accepted', expiring_soon: 'Expiring soon', expired: 'Expired — please replace', rejected: 'Not accepted — please replace',
  missing: 'Needed', requested: 'Needed', overdue: 'Overdue', awaiting_review: 'Received — under review', review_required: 'Under review',
  not_applicable: 'Not required', submitted: 'Received',
};

export async function portalState(svc: Services, db: Db, input: any, ip?: string) {
  const p = await ctxFromSession(svc, db, input.session, ip);
  const [assignments, projects, defs, docs, versions, evals, requests] = await Promise.all([
    db.list<Assignment>(C.col(p.org.id, 'assignments'), [['subcontractorId', '==', p.sub.id]]),
    db.list<Project>(C.col(p.org.id, 'projects')),
    db.list<RequirementDefinition>(C.col(p.org.id, 'requirements')),
    db.list<DocumentRecord>(C.col(p.org.id, 'documents'), [['subcontractorId', '==', p.sub.id]]),
    db.list<DocumentVersion>(C.col(p.org.id, 'versions'), [['subcontractorId', '==', p.sub.id]]),
    db.list<Evaluation & { id: string }>(C.col(p.org.id, 'readiness'), [['subcontractorId', '==', p.sub.id]]),
    db.list<DocumentRequest>(C.col(p.org.id, 'requests'), [['subcontractorId', '==', p.sub.id]]),
  ]);
  const liveProjects = new Map(projects.filter((x) => !['archived', 'completed'].includes(x.status)).map((x) => [x.id, x]));
  const myProjectIds = assignments.filter((a) => a.active && liveProjects.has(a.projectId)).map((a) => a.projectId);
  const scopeProjects = p.link.scope.fullPortal || !p.link.scope.projectIds.length ? myProjectIds : p.link.scope.projectIds.filter((x) => myProjectIds.includes(x) || liveProjects.has(x));
  const defMap = new Map(defs.map((d) => [d.id, d]));
  // Requirement ids in scope: explicit for request links; all applicable for full portal access.
  const results = evals.filter((e) => scopeProjects.includes(e.projectId)).flatMap((e) => e.results.map((r) => ({ ...r, projectId: e.projectId })));
  const reqIds = p.link.scope.fullPortal ? [...new Set(results.filter((r) => r.status !== 'not_applicable').map((r) => r.requirementId))] : p.link.scope.requirementIds;
  const rank: RequirementStatus[] = ['expired', 'rejected', 'overdue', 'missing', 'requested', 'review_required', 'expiring_soon', 'awaiting_review', 'submitted', 'approved', 'not_applicable', 'not_requested'];
  const requirements = reqIds.map((rid) => {
    const def = defMap.get(rid);
    if (!def) return null;
    const rs = results.filter((r) => r.requirementId === rid);
    const worst = rs.sort((a, b) => rank.indexOf(a.status) - rank.indexOf(b.status))[0];
    const myVersions = versions.filter((v) => v.requirementId === rid && !['uploading'].includes(v.reviewStatus)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    const latest = myVersions[0];
    const status: RequirementStatus = worst?.status ?? (latest ? (latest.reviewStatus === 'approved' ? 'approved' : latest.reviewStatus === 'rejected' ? 'rejected' : 'awaiting_review') : 'missing');
    return {
      id: rid, name: def.name, description: def.description, instructions: def.instructions, kind: def.kind, expiryRequired: def.expiryRequired,
      status, label: STATUS_FOR_SUB[status] ?? STATUS_LABELS[status], needsAction: ['expired', 'rejected', 'overdue', 'missing', 'requested', 'expiring_soon'].includes(status) && def.kind === 'document',
      expiryDate: worst?.expiryDate, rejectionReason: latest && ['rejected', 'info_requested'].includes(latest.reviewStatus) ? latest.review?.reason : undefined,
      projects: [...new Set(rs.map((r) => liveProjects.get(r.projectId)?.name).filter(Boolean))],
      mandatory: rs.some((r) => r.mandatory),
    };
  }).filter(Boolean) as any[];
  requirements.sort((a, b) => Number(b.needsAction) - Number(a.needsAction) || rank.indexOf(a.status) - rank.indexOf(b.status));
  const contact = p.sub.contacts.find((c) => c.id === p.contactId)!;
  const history = versions.filter((v) => v.reviewStatus !== 'uploading').sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).map((v) => ({
    versionId: v.id, fileName: v.fileName, requirement: v.requirementId ? defMap.get(v.requirementId)?.name : docs.find((d) => d.id === v.documentId)?.title,
    uploadedAt: v.uploadedAt, uploadedBy: v.uploadedBy.type === 'portal' ? v.uploadedBy.name : `${p.org.name}`, versionNumber: v.versionNumber,
    status: v.reviewStatus === 'approved' ? 'Accepted' : v.reviewStatus === 'rejected' ? 'Not accepted' : v.reviewStatus === 'info_requested' ? 'More information needed' : v.reviewStatus === 'superseded' ? 'Replaced by newer version' : v.reviewStatus === 'quarantined' ? 'Blocked by security checks' : 'Under review',
    reason: ['rejected', 'info_requested'].includes(v.reviewStatus) ? v.review?.reason : v.reviewStatus === 'quarantined' ? v.scan.detail : undefined,
    expiryDate: v.reviewStatus === 'approved' ? v.metadata.expiryDate : undefined, canView: !!v.storagePath && !['quarantined'].includes(v.reviewStatus),
  }));
  const library = docs.filter((d) => !d.archived && d.approvedVersionId).map((d) => {
    const v = versions.find((x) => x.id === d.approvedVersionId)!;
    return { title: d.requirementId ? defMap.get(d.requirementId)?.name ?? d.title : d.title, fileName: v?.fileName, versionId: v?.id, expiryDate: v?.metadata.expiryDate, acceptedAt: v?.review?.at };
  });
  const openRequests = requests.filter((r) => ['sent', 'acknowledged', 'partially_fulfilled'].includes(r.status)).map((r) => ({ id: r.id, message: r.message, dueDate: r.dueDate, createdAt: r.createdAt, from: r.createdBy.name, requirements: r.requirementIds.map((x) => defMap.get(x)?.name).filter(Boolean) }));
  return {
    organisation: { name: p.org.name }, subcontractor: { legalName: p.sub.legalName, tradingName: p.sub.tradingName },
    contact: { name: contact.name, email: contact.email, phone: contact.phone }, fullPortal: p.link.scope.fullPortal,
    linkExpiresAt: p.link.expiresAt, projects: scopeProjects.map((x) => liveProjects.get(x)?.name).filter(Boolean),
    requirements, history, library, openRequests,
    summary: { needed: requirements.filter((r) => r.needsAction).length, review: requirements.filter((r) => ['awaiting_review', 'review_required'].includes(r.status)).length, accepted: requirements.filter((r) => r.status === 'approved').length },
    readinessLabels: READINESS_LABELS,
  };
}

export async function portalUploadCreate(svc: Services, db: Db, input: any, ip?: string) {
  const p = await ctxFromSession(svc, db, input.session, ip);
  await rateLimit(db, `upload:${p.link.id}`, 60, 3600, svc.now());
  const rid = id(input.requirementId, 'Requirement');
  if (!p.link.scope.fullPortal && !p.link.scope.requirementIds.includes(rid)) throw new HttpError(403, 'This link does not cover that document', 'out_of_scope');
  if (p.link.scope.fullPortal) {
    const evals = await db.list<Evaluation>(C.col(p.org.id, 'readiness'), [['subcontractorId', '==', p.sub.id]]);
    if (!evals.some((e) => e.results.some((r) => r.requirementId === rid && r.status !== 'not_applicable'))) throw new HttpError(403, 'That document is not required from you', 'out_of_scope');
  }
  return createUploadSlot({ svc, db, org: p.org }, { type: 'portal', id: p.contactId, name: `${p.contactName} (${p.sub.legalName})` }, {
    subcontractorId: p.sub.id, requirementId: rid, fileName: input.fileName, mimeType: input.mimeType, size: input.size,
    projectIds: [],
  });
}

export async function portalUploadFinalize(svc: Services, db: Db, input: any, ip?: string) {
  const p = await ctxFromSession(svc, db, input.session, ip);
  const res = await finalizeUploadSlot({ svc, db, org: p.org }, { type: 'portal', id: p.contactId, name: `${p.contactName} (${p.sub.legalName})` }, id(input.versionId, 'Upload'), 'portal', p.sub.id);
  if (!res.alreadyFinalized) {
    const v = await db.get<DocumentVersion>(C.doc(p.org.id, 'versions', res.versionId));
    const contact = p.sub.contacts.find((c) => c.id === p.contactId)!;
    await sendEmail({ db, svc, org: p.org }, {
      to: contact.email, template: 'sub.submission_received', dedupeKey: `received:${res.versionId}`,
      subject: `${p.org.name} received ${v?.fileName}`, heading: 'Document received',
      body: `Thanks — ${p.org.name} has received ${v?.fileName}. It will be reviewed, and you'll hear back if anything else is needed.`,
    });
  }
  return res;
}

export async function portalUpdateContact(svc: Services, db: Db, input: any, ip?: string) {
  const p = await ctxFromSession(svc, db, input.session, ip);
  const name = reqStr(input.name, 'Name', 120);
  const phone = str(input.phone, 'Phone', { max: 40 });
  const before = p.sub.contacts.find((c) => c.id === p.contactId)!;
  const contacts = p.sub.contacts.map((c) => (c.id === p.contactId ? { ...c, name, phone } : c));
  await db.update(C.doc(p.org.id, 'subcontractors', p.sub.id), { contacts, lastActivityAt: svc.now().toISOString() });
  await audit({ db, svc, org: p.org, ip, source: 'portal' }, { action: 'subcontractor.contact_self_updated', entity: { type: 'subcontractor', id: p.sub.id, label: p.sub.legalName }, before: { name: before.name, phone: before.phone }, after: { name, phone }, actor: { type: 'subcontractor', id: p.contactId, name: `${name} (${p.sub.legalName})` } });
  return { ok: true };
}

export async function portalFileUrl(svc: Services, db: Db, input: any, ip?: string) {
  const p = await ctxFromSession(svc, db, input.session, ip);
  const v = await db.get<DocumentVersion>(C.doc(p.org.id, 'versions', id(input.versionId, 'Document')));
  if (!v || v.subcontractorId !== p.sub.id || !v.storagePath || ['uploading', 'quarantined'].includes(v.reviewStatus)) throw new HttpError(404, 'Document not found');
  return { url: await svc.files.readUrl(v.storagePath, { ttlSeconds: 300, fileName: v.fileName }) };
}

export { bad };
