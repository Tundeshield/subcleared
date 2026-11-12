// Email document intake, received through Resend.
//
// Each organisation gets a private address: docs-<key>@<INBOUND_EMAIL_DOMAIN>,
// where the domain is a Resend receiving domain (a subdomain with its MX
// pointed at Resend, or the <id>.resend.app domain Resend provides).
// Resend sends an `email.received` webhook to /webhooks/inbound-email. That
// webhook carries metadata only, so it is verified (Svix signature, 5-minute
// window), de-duplicated on the email id, routed to the organisation by the
// recipient address, and handed to a background function. The background
// function downloads each attachment from Resend's Attachments API, checks and
// scans it, stores it with its provenance, reads it and matches it.
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
  /** Resend's id for the received email. */
  providerId?: string;
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

/** Where received emails and their attachments are fetched from. Production: Resend. Tests and dev: an in-memory fake. */
export interface InboundSource {
  getEmail(emailId: string): Promise<{ text?: string; fromName?: string } | null>;
  listAttachments(emailId: string): Promise<{ filename: string; contentType: string; size?: number; inline?: boolean; download: () => Promise<Uint8Array> }[]>;
}

export class ResendInbound implements InboundSource {
  constructor(private apiKey: string) {}
  private async get(path: string) {
    const res = await fetch(`https://api.resend.com${path}`, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    if (!res.ok) throw new Error(`Resend ${path} responded ${res.status}`);
    return res.json() as Promise<any>;
  }
  async getEmail(emailId: string) {
    try {
      const e = await this.get(`/emails/receiving/${encodeURIComponent(emailId)}`);
      const fromHeader: string = e?.headers?.from ?? '';
      const name = fromHeader.includes('<') ? fromHeader.split('<')[0].trim().replace(/^"|"$/g, '') : undefined;
      return { text: typeof e?.text === 'string' ? e.text : undefined, fromName: name || undefined };
    } catch { return null; }
  }
  async listAttachments(emailId: string) {
    const out: any[] = [];
    let after: string | undefined;
    for (let page = 0; page < 5; page++) {
      const r = await this.get(`/emails/receiving/${encodeURIComponent(emailId)}/attachments?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`);
      out.push(...(r.data ?? []));
      if (!r.has_more || !r.data?.length) break;
      after = r.data[r.data.length - 1].id;
    }
    return out.map((a) => ({
      filename: String(a.filename ?? 'attachment'), contentType: String(a.content_type ?? '').toLowerCase(), size: Number(a.size) || undefined,
      inline: a.content_disposition === 'inline' && !!a.content_id,
      download: async () => {
        const res = await fetch(a.download_url);
        if (!res.ok) throw new Error(`Attachment download failed (${res.status})`);
        return new Uint8Array(await res.arrayBuffer());
      },
    }));
  }
}

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'btinternet.com', 'sky.com']);

export function intakeKeyFrom(m: { to: string[] }): string | null {
  for (const raw of m.to) {
    const addr = raw.toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1').trim();
    const local = addr.split('@')[0] ?? '';
    const hit = local.match(/^docs-([a-z0-9]{12,40})(?:\+.*)?$/);
    if (hit) return hit[1];
  }
  return null;
}

/**
 * Svix signature check used by Resend webhooks: HMAC-SHA256 over
 * "<id>.<timestamp>.<raw body>" with the base64 key after "whsec_".
 * Accepts any of several "v1,<sig>" values (secret rotation) and rejects
 * timestamps more than five minutes from now (replays).
 */
export function verifySvix(secret: string, raw: string, h: { id?: string | null; timestamp?: string | null; signature?: string | null }, now: Date): boolean {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > 300) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64'); } catch { return false; }
  const expected = crypto.createHmac('sha256', key).update(`${h.id}.${h.timestamp}.${raw}`).digest();
  return h.signature.split(' ').some((part) => {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  });
}

/** Test/dev helper: signs a payload the way Resend does. */
export function signSvix(secret: string, raw: string, id: string, now: Date) {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const sig = crypto.createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${raw}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${sig}` };
}

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

interface InboundMessage { id: string; orgId: string; emailId: string; from: string; to: string[]; subject?: string; messageId?: string; receivedAt: string; status: 'queued' | 'done' | 'failed'; error?: string; attachments?: number }

/** The webhook: verify, de-duplicate, route, queue. Fast and small; no attachment bytes pass through it. */
export async function handleInboundEmail(svc: Services, rawBody: string, headers: { get(name: string): string | null | undefined }): Promise<{ status: number; body: any }> {
  if (!svc.env.resendWebhookSecret || !svc.inbound) return { status: 503, body: { error: 'Email intake is not configured (RESEND_WEBHOOK_SECRET / RESEND_API_KEY)' } };
  const h = (n: string) => headers.get(`svix-${n}`) ?? headers.get(`webhook-${n}`);
  if (!verifySvix(svc.env.resendWebhookSecret, rawBody, { id: h('id'), timestamp: h('timestamp'), signature: h('signature') }, svc.now())) return { status: 401, body: { error: 'Invalid signature' } };
  let event: any;
  try { event = JSON.parse(rawBody); } catch { return { status: 400, body: { error: 'Invalid payload' } }; }
  if (event?.type === 'email.bounced' || event?.type === 'email.complained') return handleDeliveryProblem(svc, event);
  if (event?.type !== 'email.received') return { status: 200, body: { ok: true, ignored: event?.type } };
  const d = event.data ?? {};
  const emailId = typeof d.email_id === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(d.email_id) ? d.email_id : null;
  if (!emailId) return { status: 400, body: { error: 'Missing email id' } };
  const to = [...(Array.isArray(d.to) ? d.to : []), ...(Array.isArray(d.cc) ? d.cc : []), ...(Array.isArray(d.received_for) ? d.received_for : [])].map(String);
  const key = intakeKeyFrom({ to });
  // Unknown addresses are accepted and dropped (200) so senders can't probe which keys exist, and Resend doesn't retry.
  if (!key) return { status: 200, body: { ok: true, routed: false } };
  const route = await svc.db.get<{ orgId: string; key: string; revokedAt?: string }>(`intakeRoutes/${key}`);
  if (!route || route.revokedAt) return { status: 200, body: { ok: true, routed: false } };
  const org = await svc.db.get<Organisation>(C.org(route.orgId));
  if (!org || org.settings.intakeKey !== key) return { status: 200, body: { ok: true, routed: false } };
  try { await rateLimit(svc.db, `intake:${org.id}`, 300, 3600, svc.now()); } catch { return { status: 429, body: { error: 'Too many messages' } }; }
  const msg: InboundMessage = {
    id: emailId, orgId: org.id, emailId, from: String(d.from ?? '').toLowerCase().trim(), to: to.slice(0, 20), subject: typeof d.subject === 'string' ? d.subject.slice(0, 300) : undefined,
    messageId: typeof d.message_id === 'string' ? d.message_id.slice(0, 300) : undefined, receivedAt: typeof d.created_at === 'string' ? d.created_at : svc.now().toISOString(), status: 'queued',
  };
  // Resend delivers at least once: the email id makes repeats harmless.
  try { await svc.db.create(C.doc(org.id, 'intakeMessages', emailId), msg as any); } catch { return { status: 200, body: { ok: true, duplicate: true } }; }
  try { await svc.queueIntake(org.id, `msg:${emailId}`); } catch (e: any) { console.error('queue intake failed', e); await fetchMessage(svc, org, emailId).catch(() => undefined); }
  return { status: 200, body: { ok: true, routed: true } };
}

/**
 * A message SubCleared sent bounced or was marked as spam. The address is
 * flagged so automatic chasing stops writing to it, and the people who care
 * are told to check it. Sending again on purpose clears the flag.
 */
async function handleDeliveryProblem(svc: Services, event: any) {
  const d = event.data ?? {};
  const providerId = typeof d.email_id === 'string' ? d.email_id.replace(/\//g, '_') : null;
  if (!providerId) return { status: 200, body: { ok: true } };
  const idx = await svc.db.get<{ orgId: string; logId: string; to: string }>(`emailIndex/${providerId}`);
  if (!idx) return { status: 200, body: { ok: true, unknown: true } };
  const org = await svc.db.get<Organisation>(C.org(idx.orgId));
  if (!org) return { status: 200, body: { ok: true } };
  const kind = event.type === 'email.bounced' ? 'bounced' : 'complained';
  const email = idx.to.toLowerCase();
  const key = sha256(email).slice(0, 32);
  const base = { svc, db: svc.db, org };
  await svc.db.update(C.doc(org.id, 'deliveryLogs', idx.logId), { status: kind, updatedAt: svc.now().toISOString(), error: kind === 'bounced' ? 'The recipient’s mail server rejected this message. Check the address.' : 'The recipient marked this message as spam.' }).catch(() => undefined);
  try {
    await svc.db.create(C.doc(org.id, 'emailProblems', key), { id: key, email, kind, at: svc.now().toISOString(), detail: String(d.bounce?.message ?? d.bounce?.type ?? '').slice(0, 300) });
  } catch { return { status: 200, body: { ok: true, already: true } }; }
  const subs = (await svc.db.list<Subcontractor>(C.col(org.id, 'subcontractors'))).filter((s) => s.contacts.some((c) => c.email.toLowerCase() === email));
  const requests = (await svc.db.list<DocumentRequest>(C.col(org.id, 'requests'))).filter((r) => r.contactEmail.toLowerCase() === email);
  const to = new Set<string>([...subs.map((s) => s.ownerUid), ...requests.map((r) => r.createdBy.uid)].filter((u): u is string => !!u && u !== 'system'));
  if (!to.size) (await membersWith(base, 'requests.send')).forEach((m) => to.add(m.uid));
  for (const s of subs.length ? subs : [null]) {
    await notifyMembers(base, [...to], {
      type: 'escalation', title: kind === 'bounced' ? `Email to ${email} bounced` : `${email} marked our email as spam`,
      body: `${s ? `${s.legalName}: ` : ''}automatic reminders to this address have stopped. Check the address or add another contact, then send the request again.`,
      link: s ? `/app/subcontractors/${s.id}` : '/app/settings/delivery', dedupeKey: `mailproblem:${key}:${s?.id ?? ''}`,
    });
  }
  await audit({ ...base, source: 'webhook' }, { action: `email.${kind}`, entity: { type: 'email', id: idx.logId, label: email }, actor: { type: 'system', id: 'email', name: 'Email provider' }, refs: subs.map((s) => s.id) });
  return { status: 200, body: { ok: true, flagged: kind } };
}

/** Background: download attachments from Resend, check, scan and store each, then read and match. */
async function fetchMessage(svc: Services, org: Organisation, emailId: string) {
  const mpath = C.doc(org.id, 'intakeMessages', emailId);
  const msg = await svc.db.get<InboundMessage>(mpath);
  if (!msg || msg.status !== 'queued' || !svc.inbound) return;
  const base = { svc, db: svc.db, org };
  try {
    const [email, attachments] = await Promise.all([svc.inbound.getEmail(emailId), svc.inbound.listAttachments(emailId)]);
    const created: string[] = [];
    for (const [index, a] of attachments.slice(0, 10).entries()) {
      const fileName = a.filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
      const mime = a.contentType === 'image/jpg' ? 'image/jpeg' : a.contentType;
      // Logos and signature images embedded in the email body aren't documents.
      if (a.inline && mime.startsWith('image/')) continue;
      if (a.size !== undefined && a.size < 2048 && mime.startsWith('image/')) continue;
      const unsupported = !ALLOWED_MIME.includes(mime as any) && !/\.(pdf|jpe?g|png)$/i.test(fileName);
      if (unsupported && /calendar|ics|vcard|pkcs7|signature/i.test(`${mime} ${fileName}`)) continue; // invites and email signatures
      // Deterministic id: a retried message never files the same attachment twice.
      const itemId = sha256(`${emailId}:${index}:${a.filename}`).slice(0, 20);
      const existing = await svc.db.get<IntakeItem>(C.doc(org.id, 'intake', itemId));
      if (existing) { if (existing.status === 'processing') created.push(itemId); continue; }
      const item: IntakeItem = {
        id: itemId, status: 'processing', receivedAt: msg.receivedAt, from: msg.from, fromName: email?.fromName, to: msg.to.join(', ').slice(0, 300), subject: msg.subject, messageId: msg.messageId,
        providerId: emailId, textPreview: email?.text?.slice(0, 2000), fileName, mimeType: mime, size: a.size ?? 0, sha256: '', scan: { status: 'rejected' },
      };
      if (unsupported) { item.status = 'rejected'; item.rejectedReason = 'Only PDF, JPG and PNG files can be filed. Ask the sender for a PDF or a photo.'; }
      else if ((a.size ?? 0) > MAX_UPLOAD_BYTES) { item.status = 'rejected'; item.rejectedReason = `Larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`; }
      else {
        const bytes = await a.download();
        item.size = bytes.length; item.sha256 = sha256(bytes);
        if (bytes.length < 2048 && mime.startsWith('image/')) continue;
        if (bytes.length > MAX_UPLOAD_BYTES) { item.status = 'rejected'; item.rejectedReason = `Larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`; }
        else {
          const scan = await scanFile(svc, bytes, fileName, mime);
          if (!scan.ok) { item.status = 'rejected'; item.rejectedReason = scan.reason; item.scan = { status: 'rejected', method: scan.method, detail: scan.detail }; }
          else {
            item.mimeType = scan.mime!;
            item.scan = { status: 'clean', method: scan.method, detail: scan.detail };
            item.storagePath = `orgs/${org.id}/intake/${itemId}.${EXT[scan.mime!]}`;
            await svc.files.write(item.storagePath, bytes, scan.mime!);
          }
        }
      }
      await svc.db.set(C.doc(org.id, 'intake', itemId), item as any);
      await audit({ ...base, source: 'webhook' }, { action: item.status === 'rejected' ? 'intake.rejected' : 'intake.received', entity: { type: 'intake', id: itemId, label: item.fileName }, after: { from: item.from, subject: item.subject, size: item.size, reason: item.rejectedReason, emailId }, actor: { type: 'system', id: 'email', name: `Email from ${item.from}` } });
      if (item.status === 'processing') created.push(itemId);
    }
    await svc.db.update(mpath, { status: 'done', attachments: created.length, text: email?.text?.slice(0, 1000), fromName: email?.fromName });
    for (const itemId of created) await processIntake(svc, org.id, itemId);
  } catch (e: any) {
    await svc.db.update(mpath, { status: 'failed', error: String(e?.message ?? e).slice(0, 300), failedAt: svc.now().toISOString() });
    throw e;
  }
}

/**
 * Picks up email work that failed or got stuck (provider outage, function
 * timeout). Runs from the hourly scheduler. Three attempts, then it stays
 * visible on the Emailed documents page for a person.
 */
export async function recoverIntake(svc: Services, org: Organisation) {
  const now = svc.now().getTime();
  const stale = (iso?: string, mins = 15) => !iso || now - new Date(iso).getTime() > mins * 60_000;
  let retried = 0;
  for (const m of await svc.db.list<any>(C.col(org.id, 'intakeMessages'))) {
    const attempts = m.attempts ?? 1;
    const stuck = m.status === 'queued' && stale(m.queuedAt ?? m.receivedAt);
    if (attempts >= 3 || !(stuck || m.status === 'failed')) continue;
    await svc.db.update(C.doc(org.id, 'intakeMessages', m.id), { status: 'queued', attempts: attempts + 1, queuedAt: svc.now().toISOString() });
    await svc.queueIntake(org.id, `msg:${m.id}`).catch(() => undefined);
    retried++;
  }
  for (const i of await svc.db.list<IntakeItem & { attempts?: number; processingAt?: string }>(C.col(org.id, 'intake'), [['status', '==', 'processing']])) {
    if ((i.attempts ?? 1) >= 3 || !stale(i.processingAt ?? i.receivedAt, 20)) continue;
    await svc.db.update(C.doc(org.id, 'intake', i.id), { attempts: (i.attempts ?? 1) + 1, processingAt: svc.now().toISOString() });
    await svc.queueIntake(org.id, i.id).catch(() => undefined);
    retried++;
  }
  return retried;
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
export async function processIntake(svc: Services, orgId: string, itemId: string): Promise<any> {
  if (itemId.startsWith('msg:')) {
    const org = await svc.db.get<Organisation>(C.org(orgId));
    if (org) await fetchMessage(svc, org, itemId.slice(4));
    return { fetched: true };
  }
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
    configured: !!ctx.svc.env.resendWebhookSecret && !!ctx.svc.inbound && !!ctx.svc.env.inboundDomain,
    address: intakeAddress(ctx.svc, ctx.org.settings.intakeKey),
    readingOn: !!ctx.svc.ai,
  };
}

export async function enableIntake(ctx: Ctx, input: any) {
  need(ctx, 'settings.manage');
  if (!ctx.svc.env.inboundDomain || !ctx.svc.env.resendWebhookSecret || !ctx.svc.inbound) throw new HttpError(503, 'Email intake needs Resend receiving. Set INBOUND_EMAIL_DOMAIN, RESEND_WEBHOOK_SECRET and RESEND_API_KEY for this deployment.', 'not_configured');
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
    // Emails with nothing to file are listed too, so no message disappears without a trace.
    empty: (await ctx.db.list<any>(C.col(ctx.org.id, 'intakeMessages'))).filter((m) => m.status === 'done' && !m.attachments && !all.some((i) => i.providerId === m.emailId))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 10).map((m) => ({ id: m.id, from: m.from, fromName: m.fromName, subject: m.subject, receivedAt: m.receivedAt, text: m.text?.slice(0, 300) })),
    failed: (await ctx.db.list<any>(C.col(ctx.org.id, 'intakeMessages'))).filter((m) => m.status === 'failed').map((m) => ({ id: m.id, from: m.from, subject: m.subject, receivedAt: m.receivedAt, attempts: m.attempts ?? 1, error: m.error })),
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


// --- Development and tests --------------------------------------------------------

/** Stands in for Resend's receiving API locally: holds messages in memory. */
export class MemoryInbound implements InboundSource {
  private store = new Map<string, { text?: string; fromName?: string; attachments: { filename: string; contentType: string; bytes: Uint8Array }[] }>();
  put(emailId: string, m: { text?: string; fromName?: string; attachments: { filename: string; contentType: string; bytes: Uint8Array }[] }) { this.store.set(emailId, m); }
  async getEmail(emailId: string) { const m = this.store.get(emailId); return m ? { text: m.text, fromName: m.fromName } : null; }
  async listAttachments(emailId: string) {
    return (this.store.get(emailId)?.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.bytes.length, download: async () => a.bytes }));
  }
}

/** Simulates one Resend delivery end to end: stores the message, then calls the webhook with a correctly signed event. */
export async function simulateResendDelivery(svc: Services, inbound: MemoryInbound, m: { from: string; fromName?: string; to: string[]; subject?: string; text?: string; attachments: { filename: string; contentType: string; bytes: Uint8Array }[]; emailId?: string }) {
  const emailId = m.emailId ?? crypto.randomUUID();
  inbound.put(emailId, { text: m.text, fromName: m.fromName, attachments: m.attachments });
  const raw = JSON.stringify({ type: 'email.received', created_at: svc.now().toISOString(), data: { email_id: emailId, created_at: svc.now().toISOString(), from: m.from, to: m.to, cc: [], bcc: [], subject: m.subject, message_id: `<${emailId}@example>`, attachments: m.attachments.map((a, i) => ({ id: `${emailId}-${i}`, filename: a.filename, content_type: a.contentType })) } });
  const headers = signSvix(svc.env.resendWebhookSecret!, raw, `msg_${emailId}`, svc.now());
  return handleInboundEmail(svc, raw, { get: (n: string) => (headers as any)[n] ?? null });
}
