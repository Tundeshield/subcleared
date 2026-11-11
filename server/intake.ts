// Email document intake.
//
// Each organisation gets a private address: docs-<key>@<INBOUND_EMAIL_DOMAIN>.
// An inbound-email provider (Postmark inbound, or any relay that posts the
// generic JSON shape below) forwards each message to /webhooks/inbound-email
// with the shared INBOUND_EMAIL_SECRET. The webhook only does fast, safe work:
// find the organisation from the address, check and scan each attachment,
// store it, record provenance. Reading and matching run in the background.
//
// A document is attached automatically only when exactly one subcontractor and
// exactly one outstanding requirement fit. Anything less certain waits in a
// small queue for a person to confirm. Nothing is ever attached across
// organisations: the address alone decides the organisation.
import crypto from 'node:crypto';
import { namesMatch, TRUST } from '../src/domain/assessment';
import { expectedKinds } from '../src/domain/extraction';
import { ALLOWED_MIME, MAX_UPLOAD_BYTES } from '../src/domain/fileSafety';
import type { DocumentRequest, DocumentVersion, Extraction, Organisation, ProjectRequirement, RequirementDefinition, Subcontractor, Assignment } from '../src/domain/types';
import { readDocument } from './ai';
import { audit, bad, C, type Ctx, HttpError, id, membersWith, need, notFound, notifyMembers, randomToken, rateLimit, sha256 } from './core';
import { recompute } from './data';
import { createUploadSlot, finalizeUploadSlot, progressRequests } from './handlers/documents';
import { scanFile } from './scan';
import type { Services } from './services';

export interface IntakeItem {
  id: string;
  status: 'processing' | 'attached' | 'needs_match' | 'duplicate' | 'rejected' | 'discarded';
  receivedAt: string;
  from: string;
  fromName?: string;
  to: string;
  subject?: string;
  messageId?: string;
  textPreview?: string;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  storagePath?: string;
  scan: { status: 'clean' | 'rejected'; method?: string; detail?: string };
  rejectedReason?: string;
  extraction?: Extraction;
  suggestion?: { subcontractorId?: string; requirementId?: string; confidence: 'high' | 'low' | 'none'; reasons: string[] };
  attached?: { versionId: string; documentId: string; subcontractorId: string; requirementId?: string; by: string; at: string; automatic: boolean };
  duplicateOf?: { versionId: string; documentId: string };
}

interface Attachment { name: string; contentType: string; content: Buffer }
interface Inbound { from: string; fromName?: string; to: string[]; subject?: string; messageId?: string; date?: string; text?: string; mailboxHash?: string; attachments: Attachment[] }

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'btinternet.com', 'sky.com']);

/** Accepts Postmark's inbound JSON or a generic shape: {from, fromName, to, subject, messageId, date, text, attachments:[{filename, contentType, content (base64)}]}. */
export function parseInbound(p: any): Inbound {
  const lower = (s: any) => String(s ?? '').trim().toLowerCase();
  if (p && (p.FromFull || p.From || p.Attachments)) {
    return {
      from: lower(p.FromFull?.Email ?? p.From), fromName: p.FromFull?.Name || p.FromName || undefined,
      to: [p.OriginalRecipient, ...(p.ToFull ?? []).map((t: any) => t.Email), ...(p.CcFull ?? []).map((t: any) => t.Email), p.To].filter(Boolean).flatMap((x: string) => String(x).split(',')).map(lower),
      subject: p.Subject, messageId: p.MessageID, date: p.Date, text: p.TextBody, mailboxHash: p.MailboxHash || (p.ToFull ?? []).find((t: any) => t.MailboxHash)?.MailboxHash,
      attachments: (p.Attachments ?? []).map((a: any) => ({ name: String(a.Name ?? 'attachment'), contentType: lower(a.ContentType), content: Buffer.from(String(a.Content ?? ''), 'base64') })),
    };
  }
  return {
    from: lower(typeof p?.from === 'object' ? p.from.email : p?.from).replace(/^.*<([^>]+)>.*$/, '$1'), fromName: p?.fromName,
    to: (Array.isArray(p?.to) ? p.to : [p?.to]).filter(Boolean).map((x: any) => lower(typeof x === 'object' ? x.email : x).replace(/^.*<([^>]+)>.*$/, '$1')),
    subject: p?.subject, messageId: p?.messageId, date: p?.date, text: p?.text,
    attachments: (p?.attachments ?? []).map((a: any) => ({ name: String(a.filename ?? a.name ?? 'attachment'), contentType: lower(a.contentType ?? a.type), content: Buffer.from(String(a.content ?? ''), 'base64') })),
  };
}

export function intakeKeyFrom(m: Pick<Inbound, 'to' | 'mailboxHash'>): string | null {
  const ok = (k?: string | null) => (k && /^[a-z0-9]{12,40}$/.test(k) ? k : null);
  for (const addr of m.to) {
    const local = addr.split('@')[0] ?? '';
    const hit = local.match(/(?:^|[+.])docs-([a-z0-9]{12,40})$/) ?? local.match(/^docs-([a-z0-9]{12,40})(?:\+|$)/);
    if (ok(hit?.[1])) return hit![1];
  }
  const h = m.mailboxHash?.toLowerCase().replace(/^docs-/, '');
  return ok(h);
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

export async function handleInboundEmail(svc: Services, rawBody: string, secret?: string | null): Promise<{ status: number; body: any }> {
  if (!svc.env.inboundSecret) return { status: 503, body: { error: 'Email intake is not configured (INBOUND_EMAIL_SECRET)' } };
  if (!secret || !safeEqual(secret, svc.env.inboundSecret)) return { status: 403, body: { error: 'Forbidden' } };
  let msg: Inbound;
  try { msg = parseInbound(JSON.parse(rawBody)); } catch { return { status: 400, body: { error: 'Invalid payload' } }; }
  const key = intakeKeyFrom(msg);
  // Unknown addresses are accepted and dropped (200) so senders can't probe which keys exist.
  if (!key) return { status: 200, body: { ok: true, accepted: 0 } };
  const route = await svc.db.get<{ orgId: string; key: string; revokedAt?: string }>(`intakeRoutes/${key}`);
  if (!route || route.revokedAt) return { status: 200, body: { ok: true, accepted: 0 } };
  const org = await svc.db.get<Organisation>(C.org(route.orgId));
  if (!org || org.settings.intakeKey !== key) return { status: 200, body: { ok: true, accepted: 0 } };
  try { await rateLimit(svc.db, `intake:${org.id}`, 300, 3600, svc.now()); } catch { return { status: 429, body: { error: 'Too many messages' } }; }

  const base = { svc, db: svc.db, org };
  const receivedAt = svc.now().toISOString();
  const created: string[] = [];
  for (const a of msg.attachments.slice(0, 10)) {
    const itemId = svc.db.newId();
    const item: IntakeItem = {
      id: itemId, status: 'processing', receivedAt, from: msg.from, fromName: msg.fromName, to: msg.to.join(', ').slice(0, 300), subject: msg.subject?.slice(0, 300), messageId: msg.messageId?.slice(0, 300),
      textPreview: msg.text?.slice(0, 2000), fileName: a.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200), mimeType: a.contentType === 'image/jpg' ? 'image/jpeg' : a.contentType,
      size: a.content.length, sha256: sha256(a.content), scan: { status: 'rejected' },
    };
    // Signatures, logos and calendar invites are common in email; skip quietly if they aren't documents we accept.
    if (!ALLOWED_MIME.includes(item.mimeType as any) && !/\.(pdf|jpe?g|png)$/i.test(item.fileName)) continue;
    if (a.content.length < 2048 && item.mimeType.startsWith('image/')) continue; // tracking pixels and tiny signature images
    if (a.content.length > MAX_UPLOAD_BYTES) {
      item.status = 'rejected'; item.rejectedReason = `Larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`;
    } else {
      const scan = await scanFile(svc, a.content, item.fileName, item.mimeType);
      if (!scan.ok) { item.status = 'rejected'; item.rejectedReason = scan.reason; item.scan = { status: 'rejected', method: scan.method, detail: scan.detail }; }
      else {
        item.mimeType = scan.mime!;
        item.scan = { status: 'clean', method: scan.method, detail: scan.detail };
        item.storagePath = `orgs/${org.id}/intake/${itemId}.${EXT[scan.mime!]}`;
        await svc.files.write(item.storagePath, a.content, scan.mime!);
      }
    }
    await svc.db.set(C.doc(org.id, 'intake', itemId), item as any);
    await audit({ ...base, source: 'webhook' }, { action: item.status === 'rejected' ? 'intake.rejected' : 'intake.received', entity: { type: 'intake', id: itemId, label: item.fileName }, after: { from: item.from, subject: item.subject, size: item.size, reason: item.rejectedReason }, actor: { type: 'system', id: 'email', name: `Email from ${item.from}` } });
    if (item.status === 'processing') created.push(itemId);
  }
  for (const itemId of created) {
    try { await svc.queueIntake(org.id, itemId); } catch (e: any) { console.error('queue intake failed', e); await processIntake(svc, org.id, itemId).catch(() => undefined); }
  }
  return { status: 200, body: { ok: true, accepted: created.length } };
}

/** What this subcontractor still owes: requested and not yet received, or approved but expired/expiring. */
async function outstandingFor(svc: Services, orgId: string, subId: string) {
  const [requests, versions] = await Promise.all([
    svc.db.list<DocumentRequest>(C.col(orgId, 'requests'), [['subcontractorId', '==', subId]]),
    svc.db.list<DocumentVersion>(C.col(orgId, 'versions'), [['subcontractorId', '==', subId]]),
  ]);
  const out = new Set<string>();
  for (const r of requests.filter((x) => ['sent', 'acknowledged', 'partially_fulfilled'].includes(x.status))) {
    for (const rid of r.requirementIds) {
      if (!versions.some((v) => v.requirementId === rid && v.uploadedAt >= r.createdAt && !['uploading', 'quarantined', 'rejected', 'info_requested'].includes(v.reviewStatus))) out.add(rid);
    }
  }
  return out;
}

export async function suggestMatch(svc: Services, org: Organisation, item: Pick<IntakeItem, 'from' | 'extraction'>) {
  const [subs, defs, assignments, projectReqs] = await Promise.all([
    svc.db.list<Subcontractor>(C.col(org.id, 'subcontractors')), svc.db.list<RequirementDefinition>(C.col(org.id, 'requirements')),
    svc.db.list<Assignment>(C.col(org.id, 'assignments')), svc.db.list<ProjectRequirement>(C.col(org.id, 'projectRequirements')),
  ]);
  const live = subs.filter((s) => s.status !== 'archived');
  const reasons: string[] = [];
  const byContact = live.filter((s) => s.contacts.some((c) => c.email.toLowerCase() === item.from));
  const named = item.extraction?.fields?.namedInsured;
  const byName = named?.value && named.confidence >= TRUST ? live.filter((s) => namesMatch(String(named.value), [s.legalName, s.tradingName])) : [];
  const domain = item.from.split('@')[1] ?? '';
  const byDomain = domain && !FREE_MAIL.has(domain) ? live.filter((s) => s.contacts.some((c) => c.email.toLowerCase().endsWith(`@${domain}`))) : [];

  let sub: Subcontractor | undefined; let strong = false;
  const strongSet = [...new Map([...byContact, ...byName].map((s) => [s.id, s])).values()];
  if (strongSet.length === 1) { sub = strongSet[0]; strong = true; reasons.push(byContact.length ? `Sent by ${item.from}, a contact for ${sub.legalName}` : `The document names ${named!.value}`); }
  else if (strongSet.length > 1) {
    // Contact and named company point to different subs: let a person decide.
    const both = byContact.filter((s) => byName.some((n) => n.id === s.id));
    if (both.length === 1) { sub = both[0]; strong = true; reasons.push(`Sent by a contact for ${sub.legalName}, and the document names them`); }
    else { sub = byName[0] ?? byContact[0]; reasons.push('More than one subcontractor could match'); }
  } else if (byDomain.length === 1) { sub = byDomain[0]; reasons.push(`Sent from the same domain as ${sub.legalName}’s contacts`); }
  else reasons.push(`No subcontractor has ${item.from} as a contact${named?.value ? `, and none is called “${named.value}”` : ''}`);

  if (!sub) return { confidence: 'none' as const, reasons };
  const outstanding = await outstandingFor(svc, org.id, sub.id);
  const projectsForSub = new Set(assignments.filter((a) => a.active && a.subcontractorId === sub!.id).map((a) => a.projectId));
  const applicable = new Set(projectReqs.filter((p) => p.active && projectsForSub.has(p.projectId)).map((p) => p.requirementId));
  const kind = item.extraction?.status === 'completed' && (item.extraction.kindConfidence ?? 0) >= TRUST ? item.extraction.kind : undefined;
  const fits = (rid: string) => { const d = defs.find((x) => x.id === rid); if (!d || d.kind !== 'document') return false; if (!kind) return true; const want = expectedKinds(d); return !want.length || want.includes(kind as any); };
  const outstandingFit = [...outstanding].filter(fits);
  let requirementId: string | undefined; let reqStrong = false;
  if (outstandingFit.length === 1 && (kind || outstanding.size === 1)) { requirementId = outstandingFit[0]; reqStrong = true; reasons.push(`${defs.find((d) => d.id === requirementId)?.name} was requested and not yet received`); }
  else if (outstandingFit.length > 1) { requirementId = outstandingFit[0]; reasons.push(`${outstandingFit.length} outstanding requests could match this document`); }
  else {
    const any = [...applicable].filter(fits);
    // A replacement for something that failed its checks or was sent back is the likeliest reason to email it in.
    const versions = await svc.db.list<DocumentVersion>(C.col(org.id, 'versions'), [['subcontractorId', '==', sub.id]]);
    const latest = (rid: string) => versions.filter((v) => v.requirementId === rid && !['uploading', 'quarantined'].includes(v.reviewStatus)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
    const needsFix = any.filter((rid) => { const v = latest(rid); return v && (['rejected', 'info_requested'].includes(v.reviewStatus) || v.assessment?.triage === 'problem'); });
    if (any.length === 1) { requirementId = any[0]; reasons.push(`Looks like ${defs.find((d) => d.id === requirementId)?.name}, which wasn’t outstanding`); }
    else if (needsFix.length === 1) { requirementId = needsFix[0]; reasons.push(`Probably a replacement for ${defs.find((d) => d.id === requirementId)?.name}, whose last copy had a problem`); }
    else reasons.push(kind ? 'Couldn’t tell which requirement this is for' : 'The document couldn’t be read to tell which requirement it is for');
  }
  return { subcontractorId: sub.id, requirementId, confidence: strong && reqStrong ? 'high' as const : 'low' as const, reasons };
}

/** Background step: read, match, and attach when certain. */
export async function processIntake(svc: Services, orgId: string, itemId: string) {
  const path = C.doc(orgId, 'intake', itemId);
  const [item, org] = await Promise.all([svc.db.get<IntakeItem>(path), svc.db.get<Organisation>(C.org(orgId))]);
  if (!item || !org || item.status !== 'processing' || !item.storagePath) return { skipped: true };

  const dupe = (await svc.db.list<DocumentVersion>(C.col(orgId, 'versions'), [['sha256', '==', item.sha256]])).find((v) => !['quarantined', 'uploading'].includes(v.reviewStatus));
  if (dupe) {
    await svc.db.update(path, { status: 'duplicate', duplicateOf: { versionId: dupe.id, documentId: dupe.documentId } });
    return { duplicate: true };
  }
  const bytes = await svc.files.read(item.storagePath);
  const extraction = bytes ? await readDocument(svc, org, bytes, item.mimeType, 'intake') : { status: 'failed' as const, error: 'Stored file not found' };
  const suggestion = await suggestMatch(svc, org, { from: item.from, extraction });
  await svc.db.update(path, { extraction, suggestion });
  const base = { svc, db: svc.db, org };
  if (suggestion.confidence === 'high' && suggestion.subcontractorId && suggestion.requirementId) {
    await attachIntake(svc, org, { ...item, extraction, suggestion }, suggestion.subcontractorId, suggestion.requirementId, { uid: 'system', name: 'Automatic match' }, true);
    return { attached: true };
  }
  await svc.db.update(path, { status: 'needs_match' });
  const reviewers = await membersWith(base, 'documents.upload');
  await notifyMembers(base, reviewers.map((m) => m.uid), {
    type: 'document_submitted', title: `Emailed document needs matching: ${item.fileName}`,
    body: `From ${item.from}. ${suggestion.reasons[0] ?? ''}`, link: '/app/inbox', dedupeKey: `intake:${item.id}`,
  });
  return { attached: false };
}

async function attachIntake(svc: Services, org: Organisation, item: IntakeItem, subcontractorId: string, requirementId: string, by: { uid: string; name: string }, automatic: boolean) {
  const base = { svc, db: svc.db, org };
  const bytes = await svc.files.read(item.storagePath!);
  if (!bytes) throw new HttpError(409, 'The stored attachment is missing', 'missing_file');
  const actor = { type: 'email' as const, id: `email:${item.from}`, name: `${item.fromName || item.from} (by email)` };
  const slot = await createUploadSlot(base, actor, { subcontractorId, requirementId, fileName: item.fileName, mimeType: item.mimeType, size: bytes.length });
  const v = await svc.db.get<DocumentVersion>(C.doc(org.id, 'versions', slot.versionId));
  await svc.files.write(v!.storagePath!, bytes, item.mimeType);
  // Carry the reading across so the file is never sent to the AI twice.
  await finalizeUploadSlot(base, actor, slot.versionId, 'webhook');
  await svc.db.update(C.doc(org.id, 'versions', slot.versionId), {
    intake: { channel: 'email', intakeId: item.id, from: item.from, subject: item.subject, messageId: item.messageId, receivedAt: item.receivedAt },
  });
  const attached = { versionId: slot.versionId, documentId: slot.documentId, subcontractorId, requirementId, by: by.name, at: svc.now().toISOString(), automatic };
  await svc.db.update(C.doc(org.id, 'intake', item.id), { status: 'attached', attached });
  await audit({ ...base, source: automatic ? 'webhook' : 'web' }, { action: automatic ? 'intake.attached_automatically' : 'intake.attached', entity: { type: 'intake', id: item.id, label: item.fileName }, after: { ...attached, reasons: item.suggestion?.reasons }, actor: automatic ? { type: 'system', id: 'matcher', name: 'Automatic match' } : { type: 'user', id: by.uid, name: by.name }, refs: [subcontractorId, slot.versionId] });
  await progressRequests(base, subcontractorId);
  return attached;
}

// --- Staff actions -------------------------------------------------------------

function intakeAddress(svc: Services, key?: string) {
  return key && svc.env.inboundDomain ? `docs-${key}@${svc.env.inboundDomain}` : null;
}

export async function getIntakeSetup(ctx: Ctx) {
  return {
    configured: !!ctx.svc.env.inboundSecret && !!ctx.svc.env.inboundDomain,
    address: intakeAddress(ctx.svc, ctx.org.settings.intakeKey),
    readingOn: !!ctx.svc.ai,
  };
}

export async function enableIntake(ctx: Ctx, input: any) {
  need(ctx, 'settings.manage');
  if (!ctx.svc.env.inboundDomain || !ctx.svc.env.inboundSecret) throw new HttpError(503, 'Email intake needs an inbound email provider. Set INBOUND_EMAIL_DOMAIN and INBOUND_EMAIL_SECRET for this deployment.', 'not_configured');
  const old = ctx.org.settings.intakeKey;
  if (old && !input.rotate) return getIntakeSetup(ctx);
  const key = randomToken(18).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20).padEnd(20, '0');
  await ctx.db.set(`intakeRoutes/${key}`, { key, orgId: ctx.org.id, createdAt: ctx.svc.now().toISOString() });
  if (old) await ctx.db.update(`intakeRoutes/${old}`, { revokedAt: ctx.svc.now().toISOString() });
  await ctx.db.update(C.org(ctx.org.id), { settings: { ...ctx.org.settings, intakeKey: key } });
  ctx.org.settings.intakeKey = key;
  await audit(ctx, { action: old ? 'intake.address_rotated' : 'intake.enabled', entity: { type: 'org', id: ctx.org.id, label: ctx.org.name } });
  return getIntakeSetup(ctx);
}

export async function listIntake(ctx: Ctx, input: any) {
  need(ctx, 'documents.upload');
  const all = await ctx.db.list<IntakeItem>(C.col(ctx.org.id, 'intake'));
  const subs = await ctx.db.list<Subcontractor>(C.col(ctx.org.id, 'subcontractors'));
  const defs = await ctx.db.list<RequirementDefinition>(C.col(ctx.org.id, 'requirements'));
  const name = (sid?: string) => subs.find((s) => s.id === sid)?.legalName;
  const rname = (rid?: string) => defs.find((d) => d.id === rid)?.name;
  const show = input?.all ? all : all.filter((i) => ['needs_match', 'processing'].includes(i.status));
  return {
    ...(await getIntakeSetup(ctx)),
    items: show.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 200).map((i) => ({
      ...i, storagePath: undefined, textPreview: i.textPreview?.slice(0, 400),
      suggestion: i.suggestion ? { ...i.suggestion, subcontractorName: name(i.suggestion.subcontractorId), requirementName: rname(i.suggestion.requirementId) } : undefined,
      attached: i.attached ? { ...i.attached, subcontractorName: name(i.attached.subcontractorId), requirementName: rname(i.attached.requirementId) } : undefined,
    })),
    recent: all.filter((i) => ['attached', 'duplicate', 'rejected'].includes(i.status)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 20).map((i) => ({ id: i.id, status: i.status, fileName: i.fileName, from: i.from, receivedAt: i.receivedAt, rejectedReason: i.rejectedReason, attached: i.attached ? { ...i.attached, subcontractorName: name(i.attached.subcontractorId), requirementName: rname(i.attached.requirementId) } : undefined, duplicateOf: i.duplicateOf })),
    subcontractors: subs.filter((s) => s.status !== 'archived').map((s) => ({ id: s.id, legalName: s.legalName })),
    requirements: defs.filter((d) => d.active && d.kind === 'document').map((d) => ({ id: d.id, name: d.name })),
  };
}

export async function resolveIntake(ctx: Ctx, input: any) {
  need(ctx, 'documents.upload');
  const item = await ctx.db.get<IntakeItem>(C.doc(ctx.org.id, 'intake', id(input.intakeId, 'Item')));
  if (!item) throw notFound('Item not found');
  if (input.discard) {
    if (!['needs_match', 'processing'].includes(item.status)) throw bad('This item has already been handled');
    await ctx.db.update(C.doc(ctx.org.id, 'intake', item.id), { status: 'discarded' });
    if (item.storagePath) await ctx.svc.files.remove(item.storagePath).catch(() => undefined);
    await audit(ctx, { action: 'intake.discarded', entity: { type: 'intake', id: item.id, label: item.fileName }, after: { from: item.from } });
    return { ok: true };
  }
  if (item.status !== 'needs_match') throw bad('This item has already been handled');
  const subId = id(input.subcontractorId, 'Subcontractor');
  const reqId = id(input.requirementId, 'Requirement');
  const sub = await ctx.db.get<Subcontractor>(C.doc(ctx.org.id, 'subcontractors', subId));
  if (!sub) throw notFound('Subcontractor not found');
  const attached = await attachIntake(ctx.svc, ctx.org, item, subId, reqId, { uid: ctx.member.uid, name: ctx.member.name || ctx.member.email }, false);
  await recompute(ctx, { subcontractorId: subId }, 'intake.attached', 'web');
  return attached;
}

export async function intakeFileUrl(ctx: Ctx, input: any) {
  need(ctx, 'documents.upload');
  const item = await ctx.db.get<IntakeItem>(C.doc(ctx.org.id, 'intake', id(input.intakeId, 'Item')));
  if (!item?.storagePath) throw notFound('File not found');
  return { url: await ctx.svc.files.readUrl(item.storagePath, { fileName: item.fileName, inline: true, ttlSeconds: 300 }) };
}

