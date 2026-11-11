import { checkCriteria, describeCriterion } from '../../src/domain/compliance';
import { daysBetween, isISODate, todayIn } from '../../src/domain/dates';
import { ALLOWED_MIME, MAX_UPLOAD_BYTES } from '../../src/domain/fileSafety';
import { METADATA_FIELDS, VALUE_FIELDS } from '../../src/domain/library';
import { permissionsFor } from '../../src/domain/permissions';
import type {
  DocumentMetadata, DocumentRecord, DocumentRequest, DocumentVersion, Organisation, RequirementDefinition, ReviewRecord, Subcontractor, VerificationRecord,
} from '../../src/domain/types';
import { audit, bad, C, conflict, type Ctx, HttpError, id, ids, membersWith, need, notFound, notifyMembers, oneOf, reqStr, sha256, str } from '../core';
import { loadOrgData, recompute } from '../data';
import type { Db } from '../db';
import { sendEmail } from '../email';
import { scanFile } from '../scan';
import type { Services } from '../services';
import { loadSub, visibleSubIds } from './subs';

const LOCK_MINUTES = 30;
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

export interface UploadActor { type: 'user' | 'portal'; id: string; name: string; email?: string }
interface Base { db: Db; svc: Services; org: Organisation }

function safeFileName(n: unknown) {
  const name = reqStr(n, 'File name', 200).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  return name;
}

/** Creates the version record and a short-lived signed upload URL. Shared by staff uploads and the portal. */
export async function createUploadSlot(base: Base, actor: UploadActor, input: {
  subcontractorId: string; requirementId?: string; documentId?: string; title?: string; fileName: unknown; mimeType: unknown; size: unknown; projectIds?: string[];
}) {
  const fileName = safeFileName(input.fileName);
  const mime = oneOf(input.mimeType === 'image/jpg' ? 'image/jpeg' : input.mimeType, ALLOWED_MIME, 'File type');
  const size = Number(input.size);
  if (!Number.isFinite(size) || size <= 0) throw bad('File is empty');
  if (size > MAX_UPLOAD_BYTES) throw bad(`Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller`);
  const now = base.svc.now().toISOString();
  let def: RequirementDefinition | null = null;
  if (input.requirementId) {
    def = await base.db.get<RequirementDefinition>(C.doc(base.org.id, 'requirements', input.requirementId));
    if (!def) throw bad('Unknown requirement');
    if (def.kind !== 'document') throw bad(`${def.name} is confirmed by a declaration, not a document upload`);
  }
  const docs = await base.db.list<DocumentRecord>(C.col(base.org.id, 'documents'), [['subcontractorId', '==', input.subcontractorId]]);
  let doc = input.documentId ? docs.find((d) => d.id === input.documentId) : def ? docs.find((d) => !d.archived && d.requirementId === def!.id && sameSet(d.projectIds, input.projectIds ?? [])) : undefined;
  if (input.documentId && !doc) throw notFound('Document not found');
  if (!doc) {
    doc = {
      id: base.db.newId(), subcontractorId: input.subcontractorId, requirementId: def?.id, title: str(input.title, 'Title', { max: 200 }) || def?.name || fileName,
      documentType: def?.documentType, projectIds: input.projectIds ?? [], archived: false, createdAt: now, updatedAt: now,
    };
    await base.db.set(C.doc(base.org.id, 'documents', doc.id), doc as any);
  }
  const versions = await base.db.list<DocumentVersion>(C.col(base.org.id, 'versions'), [['documentId', '==', doc.id]]);
  const vid = base.db.newId();
  const key = `quarantine/${base.org.id}/${vid}`;
  const v: DocumentVersion = {
    id: vid, documentId: doc.id, subcontractorId: input.subcontractorId, requirementId: doc.requirementId,
    versionNumber: versions.reduce((m, x) => Math.max(m, x.versionNumber), 0) + 1, fileName, mimeType: mime, size, storagePath: key,
    uploadedAt: now, uploadedBy: { type: actor.type, id: actor.id, name: actor.name }, scan: { status: 'pending' },
    extraction: { status: 'not_started' }, metadata: {}, reviewStatus: 'uploading', verification: 'received', revision: 0,
  };
  await base.db.set(C.doc(base.org.id, 'versions', vid), v as any);
  const target = await base.svc.files.uploadUrl(key, mime, 900);
  return { versionId: vid, documentId: doc.id, upload: target };
}

function sameSet(a: string[], b: string[]) { return a.length === b.length && a.every((x) => b.includes(x)); }

/**
 * Called after the browser finishes the PUT. Validates the stored bytes, moves
 * the file out of quarantine and only then records the submission. Nothing is
 * reported as submitted until this succeeds.
 */
export async function finalizeUploadSlot(base: Base, actor: UploadActor, versionId: string, source: 'web' | 'portal', allowedSubId?: string) {
  const vpath = C.doc(base.org.id, 'versions', versionId);
  const v = await base.db.get<DocumentVersion>(vpath);
  if (!v || (allowedSubId && v.subcontractorId !== allowedSubId)) throw notFound('Upload not found');
  if (v.uploadedBy.id !== actor.id) throw notFound('Upload not found');
  if (v.reviewStatus !== 'uploading') return { versionId, status: v.reviewStatus, alreadyFinalized: true };
  const bytes = await base.svc.files.read(v.storagePath!);
  if (!bytes) throw new HttpError(409, 'The file did not finish uploading. Please try again.', 'upload_incomplete');
  const scan = await scanFile(base.svc, bytes, v.fileName, v.mimeType);
  if (!scan.ok) {
    await base.db.update(vpath, { reviewStatus: 'quarantined', scan: { status: 'rejected', method: scan.method, detail: scan.reason } });
    await base.svc.files.remove(v.storagePath!);
    await audit({ ...base, source }, { action: 'document.upload_blocked', entity: { type: 'document', id: v.documentId, label: v.fileName }, after: { reason: scan.reason, method: scan.method }, actor: actorFor(actor), refs: [v.subcontractorId] });
    throw new HttpError(422, scan.reason ?? 'File rejected', 'file_rejected');
  }
  const finalPath = `orgs/${base.org.id}/subcontractors/${v.subcontractorId}/documents/${v.documentId}/${v.id}.${EXT[scan.mime!]}`;
  await base.svc.files.move(v.storagePath!, finalPath);
  const now = base.svc.now().toISOString();
  const doc = await base.db.get<DocumentRecord>(C.doc(base.org.id, 'documents', v.documentId));
  const def = v.requirementId ? await base.db.get<RequirementDefinition>(C.doc(base.org.id, 'requirements', v.requirementId)) : null;
  const sub = await base.db.get<Subcontractor>(C.doc(base.org.id, 'subcontractors', v.subcontractorId));
  const extractionOn = !!base.svc.env.anthropicKey;
  await base.db.update(vpath, {
    storagePath: finalPath, sha256: sha256(bytes), size: bytes.length, mimeType: scan.mime,
    scan: { status: 'clean', method: scan.method, detail: scan.detail }, reviewStatus: def && !def.reviewRequired ? 'submitted' : 'awaiting_review',
    extraction: { status: extractionOn ? 'queued' : 'not_configured' }, uploadedAt: now, revision: 1,
  });
  await base.db.update(C.doc(base.org.id, 'documents', v.documentId), { currentVersionId: v.id, updatedAt: now });
  await base.db.update(C.doc(base.org.id, 'subcontractors', v.subcontractorId), { lastActivityAt: now });

  // Fulfil open requests that asked for this requirement.
  if (v.requirementId) await progressRequests(base, v.subcontractorId);
  const isReplacement = v.versionNumber > 1;
  await audit({ ...base, source }, {
    action: isReplacement ? 'document.replaced' : 'document.uploaded', entity: { type: 'document', id: v.documentId, label: doc?.title ?? v.fileName },
    after: { version: v.versionNumber, fileName: v.fileName, size: bytes.length, sha256: sha256(bytes).slice(0, 16), scan: scan.method }, actor: actorFor(actor), refs: [v.subcontractorId, v.id],
  });
  const reviewers = await membersWith(base, 'documents.review');
  await notifyMembers(base, [...reviewers.map((m) => m.uid), sub?.ownerUid].filter(Boolean) as string[], {
    type: 'awaiting_review', title: `${sub?.legalName ?? 'A subcontractor'} submitted ${doc?.title ?? v.fileName}`,
    body: `${v.fileName} (version ${v.versionNumber}) is awaiting review.`, link: `/app/reviews/${v.id}`, dedupeKey: `submitted:${v.id}`,
  });
  if (extractionOn) {
    try { await base.svc.queueExtraction(base.org.id, v.id); } catch (e: any) {
      await base.db.update(vpath, { extraction: { status: 'failed', error: `Could not start extraction: ${e.message}` } });
    }
  }
  await recompute(base, { subcontractorId: v.subcontractorId }, isReplacement ? 'document.replaced' : 'document.uploaded', source === 'portal' ? 'portal' : 'web');
  return { versionId, documentId: v.documentId, status: 'awaiting_review' };
}

function actorFor(a: UploadActor) { return { type: a.type === 'portal' ? 'subcontractor' as const : 'user' as const, id: a.id, name: a.name }; }

export async function progressRequests(base: Base, subcontractorId: string) {
  const [requests, versions, docs] = await Promise.all([
    base.db.list<DocumentRequest>(C.col(base.org.id, 'requests'), [['subcontractorId', '==', subcontractorId]]),
    base.db.list<DocumentVersion>(C.col(base.org.id, 'versions'), [['subcontractorId', '==', subcontractorId]]),
    base.db.list<DocumentRecord>(C.col(base.org.id, 'documents'), [['subcontractorId', '==', subcontractorId]]),
  ]);
  for (const r of requests.filter((x) => ['sent', 'acknowledged', 'partially_fulfilled'].includes(x.status))) {
    const done = r.requirementIds.filter((rid) => versions.some((v) => v.requirementId === rid && v.uploadedAt >= r.createdAt && !['uploading', 'quarantined', 'rejected', 'info_requested'].includes(v.reviewStatus) && docs.find((d) => d.id === v.documentId && !d.archived)));
    const status = done.length === r.requirementIds.length ? 'fulfilled' : done.length ? 'partially_fulfilled' : r.status;
    if (status !== r.status) await base.db.update(C.doc(base.org.id, 'requests', r.id), { status, ...(status === 'fulfilled' ? { fulfilledAt: base.svc.now().toISOString() } : {}) });
  }
}

export async function createUpload(ctx: Ctx, input: any) {
  need(ctx, 'documents.upload');
  const s = await loadSub(ctx, input.subcontractorId);
  if (s.status === 'archived') throw bad('Restore this subcontractor before adding documents');
  return createUploadSlot(ctx, { type: 'user', id: ctx.member.uid, name: ctx.member.name }, {
    subcontractorId: s.id, requirementId: input.requirementId ? id(input.requirementId, 'Requirement') : undefined,
    documentId: input.documentId ? id(input.documentId, 'Document') : undefined, title: input.title,
    fileName: input.fileName, mimeType: input.mimeType, size: input.size, projectIds: ids(input.projectIds, 'Projects'),
  });
}

export async function finalizeUpload(ctx: Ctx, input: any) {
  need(ctx, 'documents.upload');
  return finalizeUploadSlot(ctx, { type: 'user', id: ctx.member.uid, name: ctx.member.name }, id(input.versionId, 'Upload'), 'web');
}

async function visibleVersion(ctx: Ctx, versionId: unknown) {
  const v = await ctx.db.get<DocumentVersion>(C.doc(ctx.org.id, 'versions', id(versionId, 'Version')));
  if (!v) throw notFound('Document not found');
  await loadSub(ctx, v.subcontractorId); // tenant + project scoping
  return v;
}

export async function fileUrl(ctx: Ctx, input: any) {
  const v = await visibleVersion(ctx, input.versionId);
  if (!v.storagePath || ['uploading', 'quarantined'].includes(v.reviewStatus)) throw notFound('File is not available');
  const url = await ctx.svc.files.readUrl(v.storagePath, { ttlSeconds: 300, fileName: v.fileName, inline: !input.download });
  await audit(ctx, { action: input.download ? 'document.downloaded' : 'document.viewed', entity: { type: 'document', id: v.documentId, label: v.fileName }, refs: [v.subcontractorId, v.id] });
  return { url, expiresInSeconds: 300, mimeType: v.mimeType };
}

/** Status shown in the repository: review state plus expiry, from the version in force. */
function docStatus(d: DocumentRecord, versions: DocumentVersion[], today: string, soon: number) {
  const current = versions.find((v) => v.id === d.currentVersionId);
  const approved = versions.find((v) => v.id === d.approvedVersionId);
  if (d.archived) return { status: 'archived', current, approved };
  const pending = current && ['submitted', 'awaiting_review', 'under_review'].includes(current.reviewStatus) && current.id !== approved?.id;
  if (approved) {
    const exp = approved.metadata.expiryDate;
    if (exp) {
      const days = daysBetween(today, exp);
      if (days < 0) return { status: pending ? 'expired_replacement_pending' : 'expired', current, approved, days };
      if (days <= soon) return { status: pending ? 'expiring_replacement_pending' : 'expiring_soon', current, approved, days };
      return { status: pending ? 'approved_replacement_pending' : 'approved', current, approved, days };
    }
    return { status: pending ? 'approved_replacement_pending' : 'approved', current, approved };
  }
  return { status: current?.reviewStatus ?? 'not_submitted', current, approved };
}

export async function listDocuments(ctx: Ctx, input: any) {
  const data = await loadOrgData(ctx.db, ctx.org.id, ['documents', 'versions', 'subs', 'requirements', 'projects', 'assignments', 'readiness']);
  const visible = visibleSubIds(ctx, data);
  const today = todayIn(ctx.org.settings.timezone, ctx.svc.now());
  const subs = new Map(data.subs.map((s) => [s.id, s]));
  const defs = new Map(data.requirements.map((r) => [r.id, r]));
  const byDoc = new Map<string, DocumentVersion[]>();
  for (const v of data.versions) byDoc.set(v.documentId, [...(byDoc.get(v.documentId) ?? []), v]);
  let rows = data.documents.filter((d) => !visible || visible.has(d.subcontractorId)).map((d) => {
    const vs = byDoc.get(d.id) ?? [];
    const st = docStatus(d, vs, today, ctx.org.settings.expiringSoonDays);
    const show = st.approved ?? st.current;
    const sub = subs.get(d.subcontractorId);
    const projects = d.projectIds.length ? d.projectIds : data.assignments.filter((a) => a.active && a.subcontractorId === d.subcontractorId).map((a) => a.projectId);
    const blocking = data.readiness.some((r) => r.results.some((x) => x.documentId === d.id && x.blocking));
    return {
      id: d.id, title: d.title, subcontractorId: d.subcontractorId, subcontractor: sub?.legalName, trade: sub?.trade, requirementId: d.requirementId,
      requirement: d.requirementId ? defs.get(d.requirementId)?.name : undefined, documentType: show?.metadata.documentType || d.documentType,
      issuer: show?.metadata.issuer, referenceNumber: show?.metadata.referenceNumber, expiryDate: st.approved?.metadata.expiryDate, days: st.days,
      issueDate: show?.metadata.issueDate, versionNumber: show?.versionNumber, category: d.requirementId ? defs.get(d.requirementId)?.category : 'Other',
      projectNames: projects.map((pid) => data.projects.find((p) => p.id === pid)?.name).filter(Boolean),
      jurisdiction: show?.metadata.jurisdiction ?? sub?.jurisdiction, status: st.status, reviewStatus: st.current?.reviewStatus,
      verification: st.approved?.verification ?? st.current?.verification, versions: vs.filter((v) => !['uploading'].includes(v.reviewStatus)).length,
      uploadedAt: st.current?.uploadedAt, currentVersionId: st.current?.id, approvedVersionId: st.approved?.id, projectIds: projects, archived: d.archived,
      complianceImpact: blocking ? 'blocking' : 'none',
    };
  }).filter((r) => r.versions > 0);
  const f = input ?? {};
  if (f.subcontractorId) rows = rows.filter((r) => r.subcontractorId === f.subcontractorId);
  if (f.projectId) rows = rows.filter((r) => r.projectIds.includes(f.projectId));
  if (f.documentType) rows = rows.filter((r) => r.documentType === f.documentType);
  if (f.status) rows = rows.filter((r) => r.status.startsWith(f.status) || r.reviewStatus === f.status);
  if (f.issuer) rows = rows.filter((r) => r.issuer?.toLowerCase().includes(String(f.issuer).toLowerCase()));
  if (f.jurisdiction) rows = rows.filter((r) => r.jurisdiction?.toLowerCase().includes(String(f.jurisdiction).toLowerCase()));
  if (f.expiresBefore) rows = rows.filter((r) => r.expiryDate && r.expiryDate <= f.expiresBefore);
  if (f.uploadedAfter) rows = rows.filter((r) => r.uploadedAt && r.uploadedAt >= f.uploadedAfter);
  if (!f.includeArchived) rows = rows.filter((r) => !r.archived);
  return { items: rows.sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? '')), documentTypes: [...new Set(rows.map((r) => r.documentType).filter(Boolean))] };
}

export async function getDocument(ctx: Ctx, input: any) {
  const d = await ctx.db.get<DocumentRecord>(C.doc(ctx.org.id, 'documents', id(input.documentId, 'Document')));
  if (!d) throw notFound('Document not found');
  const sub = await loadSub(ctx, d.subcontractorId);
  const [versions, reviews, verifications] = await Promise.all([
    ctx.db.list<DocumentVersion>(C.col(ctx.org.id, 'versions'), [['documentId', '==', d.id]]),
    ctx.db.list<ReviewRecord>(C.col(ctx.org.id, 'reviews'), [['documentId', '==', d.id]]),
    ctx.db.list<VerificationRecord>(C.col(ctx.org.id, 'verifications')),
  ]);
  const vids = new Set(versions.map((v) => v.id));
  const def = d.requirementId ? await ctx.db.get<RequirementDefinition>(C.doc(ctx.org.id, 'requirements', d.requirementId)) : null;
  const projects = await ctx.db.list<any>(C.col(ctx.org.id, 'projects'));
  return {
    document: d, subcontractor: { id: sub.id, legalName: sub.legalName }, requirement: def,
    versions: versions.filter((v) => v.reviewStatus !== 'uploading').sort((a, b) => b.versionNumber - a.versionNumber).map(({ storagePath, ...v }) => v),
    reviews: reviews.sort((a, b) => b.at.localeCompare(a.at)), verifications: verifications.filter((x) => vids.has(x.versionId)),
    projects: projects.filter((p) => d.projectIds.includes(p.id)).map((p) => ({ id: p.id, name: p.name })),
  };
}

export async function updateDocument(ctx: Ctx, input: any) {
  need(ctx, 'documents.upload');
  const d = await ctx.db.get<DocumentRecord>(C.doc(ctx.org.id, 'documents', id(input.documentId, 'Document')));
  if (!d) throw notFound('Document not found');
  await loadSub(ctx, d.subcontractorId);
  const patch: Partial<DocumentRecord> = { updatedAt: ctx.svc.now().toISOString() };
  if (input.title !== undefined) patch.title = reqStr(input.title, 'Title', 200);
  if (input.projectIds !== undefined) patch.projectIds = ids(input.projectIds, 'Projects');
  if (input.archived !== undefined) {
    need(ctx, 'documents.archive');
    patch.archived = !!input.archived;
  }
  await ctx.db.update(C.doc(ctx.org.id, 'documents', d.id), patch as any);
  await audit(ctx, {
    action: input.archived === true ? 'document.archived' : input.archived === false ? 'document.restored' : 'document.updated',
    entity: { type: 'document', id: d.id, label: patch.title ?? d.title }, before: { title: d.title, projectIds: d.projectIds, archived: d.archived },
    after: { title: patch.title ?? d.title, projectIds: patch.projectIds ?? d.projectIds, archived: patch.archived ?? d.archived }, refs: [d.subcontractorId],
  });
  await recompute(ctx, { subcontractorId: d.subcontractorId }, 'document.updated');
  return { ok: true };
}

// --- Reviews ---------------------------------------------------------------------

export async function reviewQueue(ctx: Ctx) {
  need(ctx, 'documents.review');
  const data = await loadOrgData(ctx.db, ctx.org.id, ['versions', 'documents', 'subs', 'requirements', 'projects', 'assignments']);
  const visible = visibleSubIds(ctx, data);
  const subs = new Map(data.subs.map((s) => [s.id, s]));
  const docs = new Map(data.documents.map((d) => [d.id, d]));
  const defs = new Map(data.requirements.map((r) => [r.id, r]));
  const now = ctx.svc.now().getTime();
  const items = data.versions
    .filter((v) => ['submitted', 'awaiting_review', 'under_review'].includes(v.reviewStatus) && (!visible || visible.has(v.subcontractorId)) && !docs.get(v.documentId)?.archived)
    .map((v) => {
      const lockFresh = v.lock && now - new Date(v.lock.at).getTime() < LOCK_MINUTES * 60_000;
      return {
        versionId: v.id, documentId: v.documentId, fileName: v.fileName, versionNumber: v.versionNumber, uploadedAt: v.uploadedAt, uploadedBy: v.uploadedBy,
        subcontractorId: v.subcontractorId, subcontractor: subs.get(v.subcontractorId)?.legalName, title: docs.get(v.documentId)?.title,
        requirement: v.requirementId ? defs.get(v.requirementId)?.name : undefined, extraction: v.extraction.status,
        lockedBy: lockFresh ? v.lock : null, status: v.reviewStatus, replacing: !!docs.get(v.documentId)?.approvedVersionId,
        ageHours: Math.round((now - new Date(v.uploadedAt).getTime()) / 3_600_000),
      };
    }).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  return { items };
}

export async function getReview(ctx: Ctx, input: any) {
  const v = await visibleVersion(ctx, input.versionId);
  const d = await ctx.db.get<DocumentRecord>(C.doc(ctx.org.id, 'documents', v.documentId));
  const sub = await ctx.db.get<Subcontractor>(C.doc(ctx.org.id, 'subcontractors', v.subcontractorId));
  const def = v.requirementId ? await ctx.db.get<RequirementDefinition>(C.doc(ctx.org.id, 'requirements', v.requirementId)) : null;
  const all = await ctx.db.list<DocumentVersion>(C.col(ctx.org.id, 'versions'), [['documentId', '==', v.documentId]]);
  const previous = d?.approvedVersionId && d.approvedVersionId !== v.id ? all.find((x) => x.id === d.approvedVersionId) : undefined;
  const reviews = (await ctx.db.list<ReviewRecord>(C.col(ctx.org.id, 'reviews'), [['versionId', '==', v.id]])).sort((a, b) => b.at.localeCompare(a.at));
  const verifications = await ctx.db.list<VerificationRecord>(C.col(ctx.org.id, 'verifications'), [['versionId', '==', v.id]]);
  const { storagePath, ...version } = v;
  return {
    version, document: d, subcontractor: sub && { id: sub.id, legalName: sub.legalName, tradingName: sub.tradingName, jurisdiction: sub.jurisdiction },
    requirement: def, criteria: def?.criteria.map((c) => ({ ...c, description: describeCriterion(c) })) ?? [],
    previous: previous && { id: previous.id, versionNumber: previous.versionNumber, metadata: previous.metadata, fileName: previous.fileName, review: previous.review },
    reviews, verifications, metadataFields: METADATA_FIELDS, valueFields: VALUE_FIELDS,
    canReview: permissionsFor(ctx.member).has('documents.review'), canVerify: permissionsFor(ctx.member).has('documents.verify'),
    me: ctx.member.uid,
  };
}

function parseMetadata(raw: any): DocumentMetadata {
  if (!raw || typeof raw !== 'object') return {};
  const m: DocumentMetadata = {};
  for (const f of METADATA_FIELDS) {
    const v = raw[f.key];
    if (v === undefined || v === null || v === '') continue;
    if (f.type === 'date') { if (!isISODate(v)) throw bad(`${f.label} must be a valid date`); (m as any)[f.key] = v; }
    else (m as any)[f.key] = reqStr(v, f.label, 300);
  }
  if (m.issueDate && m.expiryDate && m.expiryDate < m.issueDate) throw bad('Expiry date is before the issue date');
  if (raw.title) m.title = reqStr(raw.title, 'Title', 200);
  if (raw.values && typeof raw.values === 'object') {
    m.values = {};
    for (const [k, v] of Object.entries(raw.values)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/.test(k) || v === '' || v === null || v === undefined) continue;
      const fdef = VALUE_FIELDS.find((x) => x.key === k);
      if (fdef?.type === 'amount' || typeof v === 'number') { const n = Number(String(v).replace(/[^0-9.]/g, '')); if (!isFinite(n)) throw bad(`${fdef?.label ?? k} must be a number`); m.values[k] = n; }
      else if (fdef?.type === 'boolean' || typeof v === 'boolean') m.values[k] = v === true || v === 'true';
      else m.values[k] = String(v).slice(0, 300);
    }
  }
  return m;
}

export async function claimReview(ctx: Ctx, input: any) {
  need(ctx, 'documents.review');
  const v0 = await visibleVersion(ctx, input.versionId);
  const path = C.doc(ctx.org.id, 'versions', v0.id);
  const release = !!input.release;
  return ctx.db.transaction(async (tx) => {
    const v = await tx.get<DocumentVersion>(path);
    if (!v) throw notFound();
    const fresh = v.lock && ctx.svc.now().getTime() - new Date(v.lock.at).getTime() < LOCK_MINUTES * 60_000;
    if (release) {
      if (v.lock?.uid === ctx.member.uid) tx.update(path, { lock: null, reviewStatus: v.reviewStatus === 'under_review' ? 'awaiting_review' : v.reviewStatus });
      return { ok: true };
    }
    if (!['submitted', 'awaiting_review', 'under_review'].includes(v.reviewStatus)) throw conflict(`This document is already ${v.reviewStatus.replace('_', ' ')}`);
    if (fresh && v.lock!.uid !== ctx.member.uid && !input.takeOver) throw conflict(`${v.lock!.name} is reviewing this document`);
    tx.update(path, { lock: { uid: ctx.member.uid, name: ctx.member.name, at: ctx.svc.now().toISOString() }, reviewStatus: 'under_review', revision: v.revision + 1 });
    return { ok: true, revision: v.revision + 1 };
  });
}

export async function saveMetadata(ctx: Ctx, input: any) {
  need(ctx, 'documents.review');
  const v0 = await visibleVersion(ctx, input.versionId);
  const metadata = parseMetadata(input.metadata);
  const path = C.doc(ctx.org.id, 'versions', v0.id);
  const before = await ctx.db.transaction(async (tx) => {
    const v = await tx.get<DocumentVersion>(path);
    if (!v) throw notFound();
    if (input.revision !== undefined && v.revision !== input.revision) throw conflict('This document changed while you were editing. Reload to see the latest version.');
    tx.update(path, { metadata, revision: v.revision + 1 });
    return v.metadata;
  });
  await audit(ctx, { action: 'document.metadata_corrected', entity: { type: 'document', id: v0.documentId, label: v0.fileName }, before, after: metadata, refs: [v0.subcontractorId, v0.id] });
  if (v0.reviewStatus === 'approved') await recompute(ctx, { subcontractorId: v0.subcontractorId }, 'document.metadata_corrected');
  return { ok: true };
}

export async function decideReview(ctx: Ctx, input: any) {
  need(ctx, 'documents.review');
  const decision = oneOf(input.decision, ['approve', 'reject', 'request_info', 'comment'] as const, 'Decision');
  const v0 = await visibleVersion(ctx, input.versionId);
  const reason = str(input.reason, 'Reason', { max: 2000 });
  const internalComment = str(input.internalComment, 'Internal comment', { max: 4000 });
  if ((decision === 'reject' || decision === 'request_info') && !reason) throw bad('Give the subcontractor a reason they can act on');
  if (decision === 'comment' && !internalComment) throw bad('Write a comment');
  const metadata = input.metadata ? parseMetadata(input.metadata) : v0.metadata;
  const def = v0.requirementId ? await ctx.db.get<RequirementDefinition>(C.doc(ctx.org.id, 'requirements', v0.requirementId)) : null;
  const checklist = Array.isArray(input.checklist) ? input.checklist.slice(0, 40).map((c: any) => ({ key: String(c.key).slice(0, 60), label: String(c.label).slice(0, 200), passed: c.passed === true ? true : c.passed === false ? false : null })) : undefined;
  if (decision === 'approve') {
    if (def?.expiryRequired && !metadata.expiryDate) throw bad(`${def.name} needs an expiry date before it can be approved`);
    const failed = def ? checkCriteria(def.criteria, metadata).filter((c) => c.passed === false) : [];
    if (failed.length && !input.overrideCriteria) {
      throw new HttpError(422, `Does not meet: ${failed.map((f) => describeCriterion(f.criterion)).join('; ')}. Correct the values or reject the document.`, 'criteria_failed');
    }
  }
  const vpath = C.doc(ctx.org.id, 'versions', v0.id);
  const dpath = C.doc(ctx.org.id, 'documents', v0.documentId);
  const now = ctx.svc.now().toISOString();
  const rec: ReviewRecord = {
    id: ctx.db.newId(), versionId: v0.id, documentId: v0.documentId, subcontractorId: v0.subcontractorId,
    decision: decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : decision === 'request_info' ? 'info_requested' : 'comment',
    reason, internalComment, checklist, metadataBefore: v0.metadata, metadataAfter: metadata, requirementId: def?.id, requirementVersion: def?.version,
    reviewerUid: ctx.member.uid, reviewerName: ctx.member.name, at: now,
  };
  await ctx.db.transaction(async (tx) => {
    const v = await tx.get<DocumentVersion>(vpath);
    const d = await tx.get<DocumentRecord>(dpath);
    if (!v || !d) throw notFound();
    const prevApproved = d.approvedVersionId && d.approvedVersionId !== v.id ? await tx.get<DocumentVersion>(C.doc(ctx.org.id, 'versions', d.approvedVersionId)) : null;
    if (decision === 'comment') { tx.create(C.doc(ctx.org.id, 'reviews', rec.id), rec as any); return; }
    if (input.revision !== undefined && v.revision !== input.revision) throw conflict('Someone else updated this document while you were reviewing. Reload to see the latest state.');
    if (!['submitted', 'awaiting_review', 'under_review'].includes(v.reviewStatus)) throw conflict(`This document has already been ${v.reviewStatus.replace('_', ' ')} by ${v.review?.reviewerName ?? 'another reviewer'}`);
    const fresh = v.lock && ctx.svc.now().getTime() - new Date(v.lock.at).getTime() < LOCK_MINUTES * 60_000;
    if (fresh && v.lock!.uid !== ctx.member.uid) throw conflict(`${v.lock!.name} is reviewing this document`);
    if (decision === 'approve' && prevApproved && prevApproved.uploadedAt > v.uploadedAt) throw conflict('A newer version of this document is already approved');
    tx.update(vpath, {
      reviewStatus: rec.decision, metadata, lock: null, revision: v.revision + 1, verification: decision === 'approve' ? 'reviewed' : v.verification,
      review: { decision: rec.decision, reason, reviewerUid: ctx.member.uid, reviewerName: ctx.member.name, at: now, requirementVersion: def?.version },
    });
    if (decision === 'approve') {
      tx.update(dpath, { approvedVersionId: v.id, updatedAt: now, ...(metadata.title ? { title: metadata.title } : {}) });
      if (prevApproved) tx.update(C.doc(ctx.org.id, 'versions', prevApproved.id), { reviewStatus: 'superseded', supersededBy: v.id });
    }
    tx.create(C.doc(ctx.org.id, 'reviews', rec.id), rec as any);
  });

  const sub = await ctx.db.get<Subcontractor>(C.doc(ctx.org.id, 'subcontractors', v0.subcontractorId));
  const d = await ctx.db.get<DocumentRecord>(dpath);
  await audit(ctx, {
    action: `document.${rec.decision === 'comment' ? 'commented' : rec.decision}`, entity: { type: 'document', id: v0.documentId, label: d?.title },
    before: { status: v0.reviewStatus, metadata: v0.metadata }, after: { status: rec.decision, reason, metadata, requirementVersion: def?.version }, refs: [v0.subcontractorId, v0.id],
  });
  if (decision !== 'comment') {
    if (decision === 'approve') await progressRenewals(ctx, v0);
    if (decision !== 'approve') await progressRequests(ctx, v0.subcontractorId);
    await notifySubcontractorOfDecision(ctx, sub, d, v0, rec);
    await notifyMembers(ctx, [sub?.ownerUid].filter(Boolean) as string[], {
      type: decision === 'approve' ? 'document_approved' : decision === 'reject' ? 'document_rejected' : 'info_requested',
      title: `${d?.title} ${decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'needs more information'}`,
      body: `${sub?.legalName}: ${reason ?? 'Approved by ' + ctx.member.name}`, link: `/app/subcontractors/${v0.subcontractorId}?tab=documents`, dedupeKey: `decision:${rec.id}`,
    });
    await recompute(ctx, { subcontractorId: v0.subcontractorId }, `review.${rec.decision}`);
  }
  return { ok: true, decision: rec.decision };
}

async function progressRenewals(ctx: Ctx, v: DocumentVersion) {
  const reqs = await ctx.db.list<DocumentRequest>(C.col(ctx.org.id, 'requests'), [['subcontractorId', '==', v.subcontractorId]]);
  for (const r of reqs.filter((x) => x.type === 'renewal' && ['sent', 'acknowledged', 'partially_fulfilled'].includes(x.status) && v.requirementId && x.requirementIds.includes(v.requirementId))) {
    await ctx.db.update(C.doc(ctx.org.id, 'requests', r.id), { status: 'fulfilled', fulfilledAt: ctx.svc.now().toISOString() });
  }
  await progressRequests(ctx, v.subcontractorId);
}

async function notifySubcontractorOfDecision(ctx: Ctx, sub: Subcontractor | null, d: DocumentRecord | null, v: DocumentVersion, rec: ReviewRecord) {
  if (!sub || rec.decision === 'approved' || sub.sample) return; // sample contacts are not real mailboxes // approvals are visible in the portal; only actionable outcomes are emailed
  const contact = v.uploadedBy.type === 'portal' ? sub.contacts.find((c) => c.id === v.uploadedBy.id || c.email === v.uploadedBy.id) : undefined;
  const to = contact?.email ?? (sub.contacts.find((c) => c.primary) ?? sub.contacts[0])?.email;
  if (!to) return;
  const { issuePortalLink } = await import('./requests');
  const link = await issuePortalLink(ctx, { subcontractorId: sub.id, contactEmail: to, requirementIds: v.requirementId ? [v.requirementId] : [], projectIds: [], fullPortal: false, days: ctx.org.settings.defaultLinkExpiryDays });
  await sendEmail(ctx, {
    to, template: `sub.${rec.decision}`, dedupeKey: `sub-decision:${rec.id}`,
    subject: rec.decision === 'rejected' ? `${ctx.org.name} could not accept ${d?.title}` : `${ctx.org.name} needs more information about ${d?.title}`,
    heading: rec.decision === 'rejected' ? `Please send a replacement for ${d?.title}` : `More information needed: ${d?.title}`,
    body: `${ctx.org.name} reviewed ${v.fileName}.\n\nReason: ${rec.reason}\n\nUse the secure link below to upload a replacement. The link expires in ${ctx.org.settings.defaultLinkExpiryDays} days.`,
    cta: { label: 'Upload a replacement', url: link.url },
  });
}

export async function recordVerification(ctx: Ctx, input: any) {
  need(ctx, 'documents.verify');
  const v = await visibleVersion(ctx, input.versionId);
  if (v.reviewStatus !== 'approved') throw bad('Only approved documents can be marked independently verified');
  const rec: VerificationRecord = {
    id: ctx.db.newId(), versionId: v.id,
    method: oneOf(input.method, ['broker_confirmation', 'insurer_confirmation', 'register_lookup', 'other'] as const, 'Verification method'),
    source: reqStr(input.source, 'Who confirmed it', 200), reference: reqStr(input.reference, 'Confirmation reference', 200),
    notes: str(input.notes, 'Notes', { max: 2000 }), verifiedBy: { uid: ctx.member.uid, name: ctx.member.name }, at: ctx.svc.now().toISOString(),
  };
  await ctx.db.set(C.doc(ctx.org.id, 'verifications', rec.id), rec as any);
  await ctx.db.update(C.doc(ctx.org.id, 'versions', v.id), { verification: 'independently_verified' });
  await audit(ctx, { action: 'document.independently_verified', entity: { type: 'document', id: v.documentId, label: v.fileName }, after: rec, refs: [v.subcontractorId, v.id] });
  return { ok: true };
}
