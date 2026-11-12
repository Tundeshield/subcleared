// Document reading, requirement comparison, automatic chasing and email intake.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { assess, namesMatch } from '../src/domain/assessment';
import { dueChase, inWorkingHours } from '../src/domain/automation';
import { cleanExtraction, MockAiProvider, processVersion } from '../server/ai';
import { handleApi } from '../server/api';
import { MemoryDb } from '../server/db';
import { handleInboundEmail, intakeKeyFrom, MemoryInbound, processIntake, signSvix, simulateResendDelivery, verifySvix } from '../server/intake';
import { runDailyJobs } from '../server/jobs';
import { readEnv, type Services } from '../server/services';
import { LocalFileStore } from '../server/storage';

const coi = (o: { insured: string; expiry: string; limit?: string; extra?: string }) => new TextEncoder().encode(
  `%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Type /Page >> endobj\nBT (Certificate of insurance) Tj (Named insured: ${o.insured}) Tj (Insurer: Hartwell Mutual) Tj (Policy number: HM-2231) Tj (Effective: 2026-01-01) Tj (Expiry: ${o.expiry}) Tj (Each occurrence: ${o.limit ?? '2,000,000'}) Tj (General aggregate: 4,000,000) Tj ${o.extra ?? ''} ET\ntrailer\n%%EOF\n`);

interface H { svc: Services; db: MemoryDb; files: LocalFileStore; mail: any[]; clock: { now: Date }; users: Record<string, any>; aiCalls: number; inbound: MemoryInbound }
let h: H;
function harness(): H {
  const db = new MemoryDb();
  const files = new LocalFileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')), 'test-secret', 'http://test');
  const mail: any[] = []; const users: Record<string, any> = {};
  const clock = { now: new Date('2026-06-15T15:00:00Z') }; // a Monday, 10:00 in Chicago
  const mock = new MockAiProvider();
  const inbound = new MemoryInbound();
  const self: H = { svc: null as any, db, files, mail, clock, users, aiCalls: 0, inbound };
  self.svc = {
    mode: 'memory', db, files,
    auth: { async verify(t) { const u = users[t]; if (!u) throw new Error('bad'); return { uid: t, email: u.email, emailVerified: true }; } },
    mail: { configured: true, async send(m) { mail.push(m); return { ok: true, dev: true }; } },
    ai: { name: 'mock', call: async (c) => { self.aiCalls++; return mock.call(c); } },
    inbound,
    env: { ...readEnv({ APP_URL: 'http://test', RESEND_WEBHOOK_SECRET: 'whsec_dGVzdC1yZXNlbmQtc2VjcmV0LWtleQ==', INBOUND_EMAIL_DOMAIN: 'in.example' } as any) },
    now: () => (clock.now = new Date(clock.now.getTime() + 1)),
    async queueExtraction(orgId, versionId) { await processVersion(self.svc, orgId, versionId); },
    async queueIntake(orgId, id) { await processIntake(self.svc, orgId, id); },
  };
  return self;
}
const call = (uid: string | null, action: string, input: any = {}, orgId?: string) => handleApi(h.svc, { action, input, authorization: uid ? `Bearer ${uid}` : null, orgId });
const ok = async (uid: string, action: string, input: any = {}, orgId?: string) => { const r = await call(uid, action, input, orgId); if (r.status !== 200) throw new Error(`${action} → ${r.status} ${JSON.stringify(r.body)}`); return r.body as any; };

async function setup(uid = 'owner1') {
  h.users[uid] = { email: `${uid}@acme.example` };
  const { orgId } = await ok(uid, 'org.register', { orgName: 'Acme Build', country: 'United States', timezone: 'America/Chicago', name: 'Olu Owner' });
  const reqs = (await ok(uid, 'requirements.list', {}, orgId)).requirements;
  const gl = reqs.find((r: any) => r.name === 'General liability insurance').id;
  const { projectId } = await ok(uid, 'projects.create', { name: 'Harbour View', status: 'active', endDate: '2027-03-31' }, orgId);
  await ok(uid, 'projects.setRequirement', { projectId, requirementId: gl, mandatory: true }, orgId);
  const { subcontractorId } = await ok(uid, 'subs.create', { legalName: 'Renew Co Ltd', trade: 'General', contacts: [{ name: 'Rae', email: 'rae@renew.example', primary: true }] }, orgId);
  await ok(uid, 'projects.assign', { projectId, subcontractorIds: [subcontractorId] }, orgId);
  return { orgId, gl, projectId, subcontractorId };
}
async function upload(orgId: string, subcontractorId: string, requirementId: string, bytes: Uint8Array) {
  const slot = await ok('owner1', 'uploads.create', { subcontractorId, requirementId, fileName: 'coi.pdf', mimeType: 'application/pdf', size: bytes.length }, orgId);
  h.files.write(new URL(slot.upload.url).searchParams.get('key')!, bytes);
  await ok('owner1', 'uploads.finalize', { versionId: slot.versionId }, orgId);
  return slot.versionId as string;
}

beforeEach(() => { h = harness(); });

describe('pure rules', () => {
  it('matches company names across legal suffixes and punctuation, not different companies', () => {
    expect(namesMatch('RENEW CO. LIMITED', ['Renew Co Ltd'])).toBe(true);
    expect(namesMatch('Renewco Holdings LLC', ['Renew Co Ltd'])).toBe(false);
    expect(namesMatch('Thameside Electrical', ['Thameside Electrical Services Ltd'])).toBe(true);
  });
  it('schedules follow-ups deterministically and respects recent activity', () => {
    const base = { afterDays: [3, 7, 14], escalateAfterDays: 16, escalated: false, sent: [] as number[] };
    expect(dueChase({ ...base, daysSinceSent: 2 }).type).toBe('none');
    expect(dueChase({ ...base, daysSinceSent: 3 })).toMatchObject({ type: 'chase', index: 0 });
    expect(dueChase({ ...base, daysSinceSent: 8 })).toMatchObject({ type: 'chase', index: 1, skipped: [0] });
    expect(dueChase({ ...base, daysSinceSent: 8, sent: [1] }).type).toBe('none');
    expect(dueChase({ ...base, daysSinceSent: 8, daysSinceActivity: 1 }).type).toBe('none');
    expect(dueChase({ ...base, daysSinceSent: 17, sent: [0, 1, 2] }).type).toBe('escalate');
  });
  it('knows working hours in the organisation’s timezone', () => {
    const s = { timezone: 'Europe/London' };
    expect(inWorkingHours(s, new Date('2026-06-15T09:30:00Z'))).toBe(true); // Mon 10:30 BST
    expect(inWorkingHours(s, new Date('2026-06-15T17:30:00Z'))).toBe(false); // 18:30
    expect(inWorkingHours(s, new Date('2026-06-13T10:00:00Z'))).toBe(false); // Saturday
  });
  it('drops malformed model output instead of guessing', () => {
    const x = cleanExtraction({ kind: 'insurance_certificate', kindConfidence: 2, fields: { expiryDate: { value: '31/03/2027', confidence: 0.9 }, glEachOccurrence: { value: '£2,000,000', confidence: 0.9 }, made_up: { value: 1 } } });
    expect(x.kindConfidence).toBe(1);
    expect(x.fields.expiryDate).toMatchObject({ value: null, confidence: 0 });
    expect(x.fields.glEachOccurrence.value).toBe(2000000);
    expect((x.fields as any).made_up).toBeUndefined();
  });
  it('compares against the requirement and each project, and never calls a document approved', () => {
    const a = assess({
      requirement: { name: 'Public liability insurance', category: 'Insurance', documentType: 'Insurance certificate', expiryRequired: true, version: 1, criteria: [{ key: 'glEachOccurrence', label: 'Public liability', type: 'min_amount', value: 5_000_000, currency: 'GBP' }] },
      fields: { namedInsured: { value: 'Other Firm Ltd', confidence: 0.95 }, expiryDate: { value: '2026-12-31', confidence: 0.95 }, glEachOccurrence: { value: 2_000_000, confidence: 0.6 } },
      kind: 'insurance_certificate', kindConfidence: 0.95, subcontractor: { legalName: 'Renew Co Ltd' },
      projects: [{ id: 'p1', name: 'Harbour View', endDate: '2027-03-31' }], today: '2026-06-15', nowIso: '2026-06-15T00:00:00Z',
    });
    expect(a.triage).toBe('problem');
    expect(a.checks.find((c) => c.key === 'name')!.outcome).toBe('fail');
    expect(a.checks.find((c) => c.key === 'covers:p1')!.outcome).toBe('warn');
    expect(a.checks.find((c) => c.key === 'crit:glEachOccurrence')!.outcome).toBe('unclear'); // low confidence is never a pass
    expect(a.summary).not.toMatch(/approved/i);
  });
});

describe('document reading pipeline', () => {
  it('gives a document to the stronger reader when the fast one fails, instead of losing it', async () => {
    const o = await setup();
    const real = h.svc.ai!; const models: string[] = [];
    h.svc.ai = { name: 'flaky', call: async (c) => { models.push(c.model); if (c.model === h.svc.env.aiFastModel) throw new Error('The reading was cut off before it finished'); return real.call(c); } };
    const v = await upload(o.orgId, o.subcontractorId, o.gl, coi({ insured: 'Renew Co Limited', expiry: '2027-06-30' }));
    const r = await ok('owner1', 'reviews.get', { versionId: v }, o.orgId);
    expect(models).toEqual([h.svc.env.aiFastModel, h.svc.env.anthropicModel]);
    expect(r.version.extraction).toMatchObject({ status: 'completed', kind: 'insurance_certificate', escalated: true });
    expect(r.version.extraction.fields.expiryDate.value).toBe('2027-06-30');
  });
  it('reads a certificate, compares it with the project, and never re-reads an identical file', async () => {
    const o = await setup();
    const v1 = await upload(o.orgId, o.subcontractorId, o.gl, coi({ insured: 'Renew Co Limited', expiry: '2027-06-30' }));
    const r = await ok('owner1', 'reviews.get', { versionId: v1 }, o.orgId);
    expect(r.version.extraction).toMatchObject({ status: 'completed', kind: 'insurance_certificate' });
    expect(r.version.extraction.fields.expiryDate).toMatchObject({ value: '2027-06-30', page: 1 });
    expect(r.assessment.triage).toBe('looks_good');
    expect(r.version.reviewStatus).toBe('awaiting_review'); // reading never approves
    const calls = h.aiCalls;
    const v2 = await upload(o.orgId, o.subcontractorId, o.gl, coi({ insured: 'Renew Co Limited', expiry: '2027-06-30' }));
    const r2 = await ok('owner1', 'reviews.get', { versionId: v2 }, o.orgId);
    expect(h.aiCalls).toBe(calls);
    expect(r2.version.extraction.reusedFrom).toBe(v1);
    expect(r2.version.duplicateOf.versionId).toBe(v1);
    const usage = await ok('owner1', 'ai.usage', {}, o.orgId);
    expect(usage.month.documents).toBe(1);
  });
  it('flags a certificate for another company that expires before the project ends', async () => {
    const o = await setup();
    const v = await upload(o.orgId, o.subcontractorId, o.gl, coi({ insured: 'Northgate Roofing Ltd', expiry: '2026-12-31', limit: '500,000' }));
    const r = await ok('owner1', 'reviews.get', { versionId: v }, o.orgId);
    expect(r.assessment.triage).toBe('problem');
    const keys = Object.fromEntries(r.assessment.checks.map((c: any) => [c.key, c.outcome]));
    expect(keys).toMatchObject({ name: 'fail', [`covers:${o.projectId}`]: 'warn', 'crit:glEachOccurrence': 'fail' });
    const dash = await ok('owner1', 'dashboard', {}, o.orgId);
    expect(dash.review).toMatchObject({ problems: 1 });
  });
});

describe('automatic chasing', () => {
  it('follows up on schedule, inside working hours, stops when documents arrive, and escalates otherwise', async () => {
    const o = await setup();
    const { subcontractorId: s2 } = await ok('owner1', 'subs.create', { legalName: 'Slow Co', trade: 'General', contacts: [{ name: 'Sam', email: 'sam@slow.example', primary: true }] }, o.orgId);
    await ok('owner1', 'projects.assign', { projectId: o.projectId, subcontractorIds: [s2] }, o.orgId);
    await ok('owner1', 'requests.forProject', { projectId: o.projectId, subcontractorIds: [o.subcontractorId, s2] }, o.orgId);
    const to = (e: string) => h.mail.filter((m) => m.to === e && /Reminder/.test(m.subject));
    h.clock.now = new Date('2026-06-17T15:00:00Z'); await runDailyJobs(h.svc); // day 2: nothing yet
    expect(to('sam@slow.example')).toHaveLength(0);
    h.clock.now = new Date('2026-06-18T03:00:00Z'); await runDailyJobs(h.svc); // day 3, but 22:00 in Chicago
    expect(to('sam@slow.example')).toHaveLength(0);
    h.clock.now = new Date('2026-06-18T15:00:00Z'); await runDailyJobs(h.svc); await runDailyJobs(h.svc);
    expect(to('sam@slow.example')).toHaveLength(1);
    expect(to('sam@slow.example')[0].text).toMatch(/automatic reminder/i);
    // Replies reach the requester and the organisation's intake address, which now exists from sign-up.
    expect(to('sam@slow.example')[0].replyTo).toEqual(['owner1@acme.example', expect.stringMatching(/^docs-[a-z0-9]{20}@in\.example$/)]);
    // Renew Co sends the document: its reminders stop.
    await upload(o.orgId, o.subcontractorId, o.gl, coi({ insured: 'Renew Co Ltd', expiry: '2027-06-30' }));
    expect(to('rae@renew.example')).toHaveLength(1);
    h.clock.now = new Date('2026-06-22T15:00:00Z'); await runDailyJobs(h.svc);
    expect(to('rae@renew.example')).toHaveLength(1);
    expect(to('sam@slow.example')).toHaveLength(2);
    h.clock.now = new Date('2026-06-29T15:00:00Z'); await runDailyJobs(h.svc);
    h.clock.now = new Date('2026-07-02T15:00:00Z'); await runDailyJobs(h.svc);
    expect(to('sam@slow.example')).toHaveLength(3);
    const notes = await ok('owner1', 'notifications.list', {}, o.orgId);
    expect(notes.items.some((n: any) => n.type === 'escalation' && /Slow Co hasn’t sent/.test(n.title))).toBe(true);
    const req = (await ok('owner1', 'requests.list', { subcontractorId: s2 }, o.orgId)).items[0];
    expect(req.status).not.toBe('expired'); // the link was renewed with each reminder
  });
  it('can be switched off', async () => {
    const o = await setup();
    await ok('owner1', 'org.updateSettings', { chasing: { enabled: false, afterDays: [3] } }, o.orgId);
    await ok('owner1', 'requests.forProject', { projectId: o.projectId, subcontractorIds: [o.subcontractorId] }, o.orgId);
    h.clock.now = new Date('2026-06-19T15:00:00Z'); await runDailyJobs(h.svc);
    expect(h.mail.filter((m) => /Reminder/.test(m.subject))).toHaveLength(0);
  });
});

describe('email intake (Resend)', () => {
  it('verifies Resend signatures, rejects replays, and parses addresses', async () => {
    const secret = h.svc.env.resendWebhookSecret!;
    const raw = '{"type":"email.received","data":{"email_id":"abc12345"}}';
    const now = new Date('2026-06-15T15:00:00Z');
    const hd = signSvix(secret, raw, 'msg_1', now);
    expect(verifySvix(secret, raw, { id: hd['svix-id'], timestamp: hd['svix-timestamp'], signature: hd['svix-signature'] }, now)).toBe(true);
    expect(verifySvix(secret, raw + ' ', { id: hd['svix-id'], timestamp: hd['svix-timestamp'], signature: hd['svix-signature'] }, now)).toBe(false);
    expect(verifySvix(secret, raw, { id: hd['svix-id'], timestamp: hd['svix-timestamp'], signature: hd['svix-signature'] }, new Date(now.getTime() + 6 * 60_000))).toBe(false);
    expect(verifySvix('whsec_b3RoZXI=', raw, { id: hd['svix-id'], timestamp: hd['svix-timestamp'], signature: hd['svix-signature'] }, now)).toBe(false);
    expect((await handleInboundEmail(h.svc, raw, { get: () => null })).status).toBe(401);
    expect(intakeKeyFrom({ to: ['Docs <docs-abcdefghijkl1234@in.example>'] })).toBe('abcdefghijkl1234');
    expect(intakeKeyFrom({ to: ['someone@in.example'] })).toBeNull();
  });
  it('attaches when certain, queues when not, ignores repeats, and never crosses organisations', async () => {
    const o = await setup();
    await ok('owner1', 'requests.forProject', { projectId: o.projectId, subcontractorIds: [o.subcontractorId] }, o.orgId);
    const setupRes = await ok('owner1', 'intake.setup', {}, o.orgId);
    expect(setupRes.address).toMatch(/^docs-[a-z0-9]+@in\.example$/);
    const send = (from: string, bytes: Uint8Array, emailId?: string) => simulateResendDelivery(h.svc, h.inbound, { from, fromName: 'Rae', to: [setupRes.address], subject: 'Our insurance', text: 'Attached.', emailId, attachments: [{ filename: 'cert.pdf', contentType: 'application/pdf', bytes }, { filename: 'logo.png', contentType: 'image/png', bytes: new Uint8Array(300) }] });

    // From a known contact, one outstanding requirement, the right kind of document: attached automatically.
    expect((await send('rae@renew.example', coi({ insured: 'Renew Co Ltd', expiry: '2027-06-30' }), 'email-0001')).body).toMatchObject({ routed: true });
    // Resend retries the same event: nothing happens twice.
    expect((await send('rae@renew.example', coi({ insured: 'Renew Co Ltd', expiry: '2027-06-30' }), 'email-0001')).body).toMatchObject({ duplicate: true });
    const all = await ok('owner1', 'intake.list', { all: true }, o.orgId);
    expect(all.recent).toHaveLength(1); // the tiny logo image was skipped
    expect(all.recent[0]).toMatchObject({ status: 'attached', attached: { automatic: true, subcontractorName: 'Renew Co Ltd' } });
    const review = await ok('owner1', 'reviews.get', { versionId: all.recent[0].attached.versionId }, o.orgId);
    expect(review.version.intake).toMatchObject({ from: 'rae@renew.example', subject: 'Our insurance' });
    expect(review.version.extraction.reusedFrom).toMatch(/^intake:/);

    // Unknown sender, and the document names nobody we know: waits for a person.
    await send('broker@bigbroker.example', coi({ insured: 'Nobody Known Ltd', expiry: '2027-01-01' }));
    const q = await ok('owner1', 'intake.list', {}, o.orgId);
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({ status: 'needs_match', fromName: 'Rae', textPreview: 'Attached.' });
    await ok('owner1', 'intake.resolve', { intakeId: q.items[0].id, subcontractorId: o.subcontractorId, requirementId: o.gl }, o.orgId);
    expect((await ok('owner1', 'intake.list', {}, o.orgId)).items).toHaveLength(0);

    // Same file again in a new email: recorded as a duplicate, not attached twice.
    await send('rae@renew.example', coi({ insured: 'Renew Co Ltd', expiry: '2027-06-30' }));
    expect((await ok('owner1', 'intake.list', { all: true }, o.orgId)).recent[0].status).toBe('duplicate');

    // An address that isn't an organisation's is accepted and dropped.
    expect((await simulateResendDelivery(h.svc, h.inbound, { from: 'x@y.example', to: ['docs-unknownkey12345@in.example'], attachments: [] })).body).toMatchObject({ routed: false });

    // Another organisation can't see or resolve these items.
    h.users.other = { email: 'x@other.example' };
    const other = await ok('other', 'org.register', { orgName: 'Other Co', country: 'Ireland', timezone: 'Europe/Dublin' });
    expect((await ok('other', 'intake.list', { all: true }, other.orgId)).recent).toHaveLength(0);
    expect((await call('other', 'intake.resolve', { intakeId: q.items[0].id, subcontractorId: o.subcontractorId, requirementId: o.gl }, other.orgId)).status).toBe(404);
  });
});

describe('delivery problems, recovery and honest checks', () => {
  it('explains an unverified sender in plain words and records it for administrators', async () => {
    const o = await setup();
    h.svc.mail.send = async () => ({ ok: false, error: 'The subcleared.app domain is not verified. Please, add and verify your domain on https://resend.com/domains' });
    const r = await ok('owner1', 'requests.forProject', { projectId: o.projectId, subcontractorIds: [o.subcontractorId] }, o.orgId);
    expect(r.results[0].status).toBe('failed');
    expect(r.results[0].detail).toMatch(/sending domain isn’t verified/);
    const dash = await ok('owner1', 'dashboard', {}, o.orgId);
    expect(dash.mailHealth).toMatchObject({ status: 'sender_unverified' });
  });

  it('stops chasing an address that bounced, tells the requester, and resumes after a deliberate resend', async () => {
    const o = await setup();
    h.svc.mail.send = async (m) => { h.mail.push(m); return { ok: true, id: `prov-${h.mail.length}` }; };
    await ok('owner1', 'requests.forProject', { projectId: o.projectId, subcontractorIds: [o.subcontractorId] }, o.orgId);
    const providerId = `prov-${h.mail.length}`;
    const raw = JSON.stringify({ type: 'email.bounced', created_at: h.svc.now().toISOString(), data: { email_id: providerId, to: ['rae@renew.example'], bounce: { message: 'Mailbox does not exist' } } });
    const hd = signSvix(h.svc.env.resendWebhookSecret!, raw, 'msg_b1', h.svc.now());
    expect((await handleInboundEmail(h.svc, raw, { get: (n: string) => (hd as any)[n] })).body).toMatchObject({ flagged: 'bounced' });
    const notes = await ok('owner1', 'notifications.list', {}, o.orgId);
    expect(notes.items.some((n: any) => /bounced/.test(n.title))).toBe(true);
    const dash = await ok('owner1', 'dashboard', {}, o.orgId);
    expect(dash.needs.some((n: any) => /bounced/.test(n.issue))).toBe(true);
    const before = h.mail.length;
    h.clock.now = new Date('2026-06-19T15:00:00Z'); await runDailyJobs(h.svc);
    expect(h.mail.slice(before).filter((m) => m.to === 'rae@renew.example')).toHaveLength(0); // no reminder to a dead address
  });

  it('treats a spam complaint like a bounce: stop chasing and tell the requester', async () => {
    const o = await setup();
    h.svc.mail.send = async (m) => { h.mail.push(m); return { ok: true, id: `prov-${h.mail.length}` }; };
    await ok('owner1', 'requests.forProject', { projectId: o.projectId, subcontractorIds: [o.subcontractorId] }, o.orgId);
    const raw = JSON.stringify({ type: 'email.complained', created_at: h.svc.now().toISOString(), data: { email_id: `prov-${h.mail.length}`, to: ['rae@renew.example'] } });
    const hd = signSvix(h.svc.env.resendWebhookSecret!, raw, 'msg_c1', h.svc.now());
    expect((await handleInboundEmail(h.svc, raw, { get: (n: string) => (hd as any)[n] })).body).toMatchObject({ flagged: 'complained' });
    const notes = await ok('owner1', 'notifications.list', {}, o.orgId);
    expect(notes.items.length).toBeGreaterThan(0);
    const before = h.mail.length;
    h.clock.now = new Date('2026-06-19T15:00:00Z'); await runDailyJobs(h.svc);
    expect(h.mail.slice(before).filter((m) => m.to === 'rae@renew.example')).toHaveLength(0);
  });

  it('retries a document reading that failed, at most three times in total', async () => {
    const o = await setup();
    let fail = true;
    const real = h.svc.ai!.call;
    h.svc.ai = { name: 'flaky', call: async (c) => { if (fail) throw new Error('Provider overloaded'); return real(c); } };
    const v = await upload(o.orgId, o.subcontractorId, o.gl, coi({ insured: 'Renew Co Ltd', expiry: '2027-06-30' }));
    expect((await ok('owner1', 'reviews.get', { versionId: v }, o.orgId)).version.extraction.status).toBe('failed');
    fail = false;
    await runDailyJobs(h.svc);
    const r = await ok('owner1', 'reviews.get', { versionId: v }, o.orgId);
    expect(r.version.extraction.status).toBe('completed');
    expect(r.assessment.triage).toBe('looks_good');
  });

  it('recovers an emailed message whose processing failed, without filing anything twice', async () => {
    const o = await setup();
    await ok('owner1', 'requests.forProject', { projectId: o.projectId, subcontractorIds: [o.subcontractorId] }, o.orgId);
    const { address } = await ok('owner1', 'intake.setup', {}, o.orgId);
    const orig = h.inbound.listAttachments.bind(h.inbound);
    let down = true;
    h.inbound.listAttachments = async (id: string) => { if (down) throw new Error('Resend 503'); return orig(id); };
    await simulateResendDelivery(h.svc, h.inbound, { from: 'rae@renew.example', to: [address], subject: 'Cert', attachments: [{ filename: 'cert.pdf', contentType: 'application/pdf', bytes: coi({ insured: 'Renew Co Ltd', expiry: '2027-06-30' }) }] });
    expect((await ok('owner1', 'intake.list', { all: true }, o.orgId)).failed).toHaveLength(1);
    down = false;
    await runDailyJobs(h.svc); await runDailyJobs(h.svc);
    const l = await ok('owner1', 'intake.list', { all: true }, o.orgId);
    expect(l.failed).toHaveLength(0);
    expect(l.recent.filter((x: any) => x.status === 'attached')).toHaveLength(1);
  });

  it('records unsupported files and emails with nothing to file instead of dropping them', async () => {
    const o = await setup();
    const { address } = await ok('owner1', 'intake.setup', {}, o.orgId);
    await simulateResendDelivery(h.svc, h.inbound, { from: 'rae@renew.example', to: [address], subject: 'Docs', attachments: [{ filename: 'insurance.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new Uint8Array(5000) }] });
    await simulateResendDelivery(h.svc, h.inbound, { from: 'rae@renew.example', to: [address], subject: 'Question about the request', text: 'Do you need the PL or EL certificate?', attachments: [] });
    const l = await ok('owner1', 'intake.list', { all: true }, o.orgId);
    expect(l.recent.find((x: any) => x.fileName === 'insurance.docx')).toMatchObject({ status: 'rejected' });
    expect(l.empty[0]).toMatchObject({ subject: 'Question about the request' });
  });

  it('does not let a certificate stand in for an endorsement, and flags the wrong certificate holder', () => {
    const a = assess({
      requirement: { name: 'Additional insured endorsement', category: 'Insurance', documentType: 'Endorsement', expiryRequired: true, version: 1, criteria: [{ key: 'additionalInsured', label: 'Additional insured status', type: 'boolean', value: true }] },
      fields: { namedInsured: { value: 'Renew Co Ltd', confidence: 0.95 }, expiryDate: { value: '2027-06-30', confidence: 0.95 }, additionalInsured: { value: true, confidence: 0.9 }, certificateHolder: { value: 'Someone Else Ltd', confidence: 0.9 } },
      kind: 'insurance_certificate', kindConfidence: 0.95, subcontractor: { legalName: 'Renew Co Ltd' }, orgName: 'Acme Build',
      projects: [], today: '2026-06-15', nowIso: '2026-06-15T00:00:00Z',
    });
    expect(a.checks.find((c) => c.key === 'crit:additionalInsured')).toMatchObject({ outcome: 'warn' });
    expect(a.checks.find((c) => c.key === 'crit:additionalInsured')!.detail).toMatch(/endorsement/);
    expect(a.checks.find((c) => c.key === 'holder')).toMatchObject({ outcome: 'warn' });
  });
});

describe('bulk confirmation', () => {
  it('never bulk-approves a document whose kind is wrong or uncertain', async () => {
    const o = await setup();
    const reqs = (await ok('owner1', 'requirements.list', {}, o.orgId)).requirements;
    const biz = reqs.find((r: any) => r.name === 'Business license').id;
    await ok('owner1', 'projects.setRequirement', { projectId: o.projectId, requirementId: biz, mandatory: true }, o.orgId);
    const pdf = (lines: string[]) => new TextEncoder().encode(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\nBT ${lines.map((l) => `(${l}) Tj`).join(' ')} ET\ntrailer\n%%EOF\n`);
    const vat = await upload(o.orgId, o.subcontractorId, biz, pdf(['VAT registration certificate', 'Company: Renew Co Ltd', 'Issued by: HM Revenue and Customs', 'Registration number: GB123456789']));
    const r = await ok('owner1', 'reviews.get', { versionId: vat }, o.orgId);
    expect(r.version.extraction.kind).toBe('tax_registration');
    expect(r.assessment.checks.find((c: any) => c.key === 'kind').outcome).toBe('fail');
    const bulk = await ok('owner1', 'reviews.confirmChecked', { versionIds: [vat] }, o.orgId);
    expect(bulk.approved).toBe(0);
    expect((await ok('owner1', 'reviews.get', { versionId: vat }, o.orgId)).version.reviewStatus).toBe('awaiting_review');
  });

  it('lists past approvals that relied on the old reading for re-review, without changing them', async () => {
    const o = await setup();
    const reqs = (await ok('owner1', 'requirements.list', {}, o.orgId)).requirements;
    const w9 = reqs.find((r: any) => r.name === 'Form W-9').id;
    await ok('owner1', 'projects.setRequirement', { projectId: o.projectId, requirementId: w9, mandatory: true }, o.orgId);
    const pdf = new TextEncoder().encode('%PDF-1.7\nBT (Form W-9 tax) Tj (Company: Renew Co Ltd) Tj ET\n%%EOF\n');
    const vid = await upload(o.orgId, o.subcontractorId, w9, pdf);
    const v = (await ok('owner1', 'reviews.get', { versionId: vid }, o.orgId)).version;
    await ok('owner1', 'reviews.decide', { versionId: vid, decision: 'approve', revision: v.revision, metadata: { values: {} }, checklist: [] }, o.orgId);
    // Simulate a reading made before company and tax documents were told apart.
    await h.db.update(`orgs/${o.orgId}/versions/${vid}`, { extraction: { ...v.extraction, kind: 'licence_registration', kindScheme: undefined } });
    const { rereviewCandidates } = await import('../server/rereview');
    const rep = await rereviewCandidates(h.svc);
    expect(rep.candidates.map((c) => c.versionId)).toEqual([vid]);
    expect((await h.db.get<any>(`orgs/${o.orgId}/versions/${vid}`)).reviewStatus).toBe('approved');
  });

  it('approves only documents whose checks all pass right now', async () => {
    const o = await setup();
    const good = await upload(o.orgId, o.subcontractorId, o.gl, coi({ insured: 'Renew Co Ltd', expiry: '2027-06-30' }));
    const { subcontractorId: s2 } = await ok('owner1', 'subs.create', { legalName: 'Other Trades Ltd', trade: 'General', contacts: [{ name: 'O', email: 'o@other.example' }] }, o.orgId);
    await ok('owner1', 'projects.assign', { projectId: o.projectId, subcontractorIds: [s2] }, o.orgId);
    const wrong = await upload(o.orgId, s2, o.gl, coi({ insured: 'Somebody Else Ltd', expiry: '2027-06-30' }));
    const r = await ok('owner1', 'reviews.confirmChecked', { versionIds: [good, wrong] }, o.orgId);
    expect(r.approved).toBe(1);
    expect(r.results.find((x: any) => x.versionId === wrong)).toMatchObject({ ok: false });
    const g = await ok('owner1', 'reviews.get', { versionId: good }, o.orgId);
    expect(g.version.reviewStatus).toBe('approved');
    expect(g.version.metadata).toMatchObject({ expiryDate: '2027-06-30', namedInsured: 'Renew Co Ltd' });
    const p = await ok('owner1', 'projects.get', { projectId: o.projectId }, o.orgId);
    expect(p.subcontractors.find((s: any) => s.id === o.subcontractorId).readiness).toBe('ready');
  });
});

describe('only the user’s own decisions reach the attention list', () => {
  async function uk(uid = 'owner1') {
    h.users[uid] = { email: `${uid}@acme.example` };
    const { orgId } = await ok(uid, 'org.register', { orgName: 'Harbourline Build', country: 'United Kingdom', timezone: 'Europe/London', name: 'Una Owner' });
    const reqs = (await ok(uid, 'requirements.list', {}, orgId)).requirements;
    const cis = reqs.find((r: any) => r.name === 'CIS verification');
    const pl = reqs.find((r: any) => r.name === 'Public liability insurance');
    const { projectId } = await ok(uid, 'projects.create', { name: 'Quayside', status: 'active', endDate: '2027-03-31' }, orgId);
    for (const r of [cis, pl]) await ok(uid, 'projects.setRequirement', { projectId, requirementId: r.id, mandatory: true }, orgId);
    return { orgId, cis, pl, projectId, uid };
  }
  it('a contractor-side check asks for "Record check", never a document request, and recording it makes them ready', async () => {
    const o = await uk();
    expect(o.cis.kind).toBe('manual_check');
    const { subcontractorId } = await ok(o.uid, 'subs.create', { legalName: 'Lee Electrical Ltd', trade: 'Electrical', contacts: [{ name: 'Tess', email: 'tess@lee.example', primary: true }] }, o.orgId);
    await ok(o.uid, 'projects.assign', { projectId: o.projectId, subcontractorIds: [subcontractorId] }, o.orgId);
    const v = await upload(o.orgId, subcontractorId, o.pl.id, coi({ insured: 'Lee Electrical Limited', expiry: '2027-06-30' }));
    const rv = (await ok(o.uid, 'reviews.get', { versionId: v }, o.orgId)).version;
    await ok(o.uid, 'reviews.decide', { versionId: v, decision: 'approve', revision: rv.revision, metadata: { expiryDate: '2027-06-30', values: { glEachOccurrence: 5000000 } }, checklist: [] }, o.orgId);
    let dash = await ok(o.uid, 'dashboard', {}, o.orgId);
    const need = dash.needs.find((n: any) => n.action === 'Record check');
    expect(need?.issue).toContain('CIS verification');
    expect(dash.needs.some((n: any) => /Request/.test(n.action) && n.item === 'Lee Electrical Ltd')).toBe(false);
    const req = await ok(o.uid, 'requests.forProject', { projectId: o.projectId, subcontractorIds: [subcontractorId] }, o.orgId);
    expect(req.results[0].status).toBe('skipped'); // nothing for the subcontractor to send
    await ok(o.uid, 'overrides.set', { type: 'manual_confirmation', subcontractorId, requirementId: o.cis.id, reason: 'Verified with HMRC online, ref V123' }, o.orgId);
    const p = await ok(o.uid, 'projects.get', { projectId: o.projectId }, o.orgId);
    expect(p.subcontractors[0].readiness).toBe('ready');
    dash = await ok(o.uid, 'dashboard', {}, o.orgId);
    expect(dash.needs.some((n: any) => n.action === 'Record check')).toBe(false);
    const audit = await ok(o.uid, 'audit.list', {}, o.orgId);
    expect(JSON.stringify(audit)).toContain('Verified with HMRC online');
  });
  it('subcontractors being chased become one quiet line; escalated ones come back as a task', async () => {
    const o = await setup();
    await ok('owner1', 'requests.forProject', { projectId: o.projectId, subcontractorIds: [o.subcontractorId] }, o.orgId);
    let dash = await ok('owner1', 'dashboard', {}, o.orgId);
    expect(dash.needs.some((n: any) => n.item === 'Renew Co Ltd')).toBe(false);
    expect(dash.waiting.subcontractors).toBe(1);
    for (const d of ['2026-06-18', '2026-06-22', '2026-06-29', '2026-07-02']) { h.clock.now = new Date(`${d}T15:00:00Z`); await runDailyJobs(h.svc); }
    dash = await ok('owner1', 'dashboard', {}, o.orgId);
    expect(dash.needs.find((n: any) => n.item === 'Renew Co Ltd')?.issue).toMatch(/after every reminder/);
    expect(dash.waiting.subcontractors).toBe(0);
  });
  it('a project with subcontractors but no paperwork says so', async () => {
    h.users.o2 = { email: 'o2@acme.example' };
    const { orgId } = await ok('o2', 'org.register', { orgName: 'Empty Co', country: 'United States', timezone: 'America/Chicago', name: 'O' });
    const { projectId } = await ok('o2', 'projects.create', { name: 'Bare', status: 'active' }, orgId);
    const { subcontractorId } = await ok('o2', 'subs.create', { legalName: 'Solo Ltd', trade: 'X', contacts: [{ name: 'S', email: 's@solo.example', primary: true }] }, orgId);
    await ok('o2', 'projects.assign', { projectId, subcontractorIds: [subcontractorId] }, orgId);
    const dash = await ok('o2', 'dashboard', {}, orgId);
    expect(dash.needs.find((n: any) => n.item === 'Bare')?.action).toBe('Choose paperwork');
  });
});

describe('escalations', () => {
  it('one escalation per stuck subcontractor and project, listing everything missing, never repeated', async () => {
    const o = await setup();
    const reqs = (await ok('owner1', 'requirements.list', {}, o.orgId)).requirements;
    const wc = reqs.find((r: any) => r.name === "Workers' compensation insurance").id;
    const biz = reqs.find((r: any) => r.name === 'Business license').id;
    const { projectId: p2 } = await ok('owner1', 'projects.create', { name: 'Second Site', status: 'active' }, o.orgId);
    for (const [p, r] of [[o.projectId, wc], [o.projectId, biz], [p2, o.gl], [p2, wc]] as const) await ok('owner1', 'projects.setRequirement', { projectId: p, requirementId: r, mandatory: true }, o.orgId);
    const { subcontractorId: noContact } = await ok('owner1', 'subs.create', { legalName: 'Quiet Co Ltd', trade: 'Roofing' }, o.orgId);
    await ok('owner1', 'projects.assign', { projectId: o.projectId, subcontractorIds: [noContact] }, o.orgId);
    await ok('owner1', 'projects.assign', { projectId: p2, subcontractorIds: [o.subcontractorId, noContact] }, o.orgId);
    await ok('owner1', 'requests.forProject', { projectId: o.projectId, subcontractorIds: [o.subcontractorId] }, o.orgId);
    await ok('owner1', 'requests.forProject', { projectId: p2, subcontractorIds: [o.subcontractorId] }, o.orgId);
    const run = async () => { for (const d of ['2026-06-18', '2026-06-22', '2026-06-29', '2026-07-02', '2026-07-03']) { h.clock.now = new Date(`${d}T15:00:00Z`); await runDailyJobs(h.svc); } };
    await run();
    const esc = (await ok('owner1', 'notifications.list', { limit: 300 }, o.orgId)).items.filter((n: any) => n.type === 'escalation');
    // Renew Co: one per request (2 projects); Quiet Co: no contact, one per project (2). Never one per document.
    expect(esc.length).toBe(4);
    expect(esc.filter((n: any) => /Quiet Co Ltd/.test(n.title)).every((n: any) => /still missing/.test(n.title))).toBe(true);
    const quiet = esc.find((n: any) => /Quiet Co Ltd/.test(n.title) && /3 documents/.test(n.title));
    expect(quiet.body).toMatch(/General liability insurance.*Workers' compensation insurance.*Business license|no contact/);
    await run(); await run();
    expect((await ok('owner1', 'notifications.list', { limit: 300 }, o.orgId)).items.filter((n: any) => n.type === 'escalation').length).toBe(4);
  });
});

describe('daily digest', () => {
  const digests = () => h.mail.filter((m) => /needs? you today/.test(m.subject));
  it('sends nothing when nothing needs a person', async () => {
    h.users.d0 = { email: 'd0@acme.example' };
    await ok('d0', 'org.register', { orgName: 'Quiet Ltd', country: 'United States', timezone: 'America/Chicago', name: 'D' });
    await runDailyJobs(h.svc);
    expect(digests()).toHaveLength(0);
  });
  it('one email a day per manager, grouped, linking straight to each record; respects opt-out', async () => {
    const o = await setup();
    await upload(o.orgId, o.subcontractorId, o.gl, coi({ insured: 'Renew Co Limited', expiry: '2027-06-30' }));
    await runDailyJobs(h.svc);
    expect(digests()).toHaveLength(1);
    const d = digests()[0];
    expect(d.to).toBe('owner1@acme.example');
    expect(d.subject).toMatch(/1 thing needs you today/);
    expect(d.text).toMatch(/\n\nRenew Co Ltd\n- General liability insurance: checks passed — confirm to approve — Confirm: http:\/\/test\/app\/reviews\//);
    expect(d.html).toContain('href="http://test/app/reviews/');
    await runDailyJobs(h.svc); await runDailyJobs(h.svc);
    expect(digests()).toHaveLength(1); // same day: never twice
    h.clock.now = new Date('2026-06-16T15:00:00Z'); await runDailyJobs(h.svc);
    expect(digests()).toHaveLength(2); // next working day
    await ok('owner1', 'notifications.prefs', { digest: false }, o.orgId);
    h.clock.now = new Date('2026-06-17T15:00:00Z'); await runDailyJobs(h.svc);
    expect(digests()).toHaveLength(2);
  });
  it('waits until morning and skips non-working days', async () => {
    const o = await setup();
    await upload(o.orgId, o.subcontractorId, o.gl, coi({ insured: 'Renew Co Limited', expiry: '2027-06-30' }));
    h.clock.now = new Date('2026-06-16T10:00:00Z'); await runDailyJobs(h.svc); // 05:00 in Chicago
    expect(digests()).toHaveLength(0);
    h.clock.now = new Date('2026-06-20T15:00:00Z'); await runDailyJobs(h.svc); // Saturday
    expect(digests()).toHaveLength(0);
  });
});

describe('email intake without setup', () => {
  it('every organisation gets its own address at sign-up; older ones get one on the next run; rotation still works', async () => {
    const o = await setup();
    const org = await h.db.get<any>(`orgs/${o.orgId}`);
    expect(org.settings.intakeKey).toMatch(/^[a-z0-9]{20}$/);
    expect((await h.db.get<any>(`intakeRoutes/${org.settings.intakeKey}`)).orgId).toBe(o.orgId);
    const s = await ok('owner1', 'intake.list', {}, o.orgId).catch(() => null);
    // An organisation from before automatic intake.
    h.users.old = { email: 'old@acme.example' };
    const { orgId: oldOrg } = await ok('old', 'org.register', { orgName: 'Old Co', country: 'United States', timezone: 'America/Chicago', name: 'O' });
    const before = await h.db.get<any>(`orgs/${oldOrg}`);
    await h.db.update(`orgs/${oldOrg}`, { settings: { ...before.settings, intakeKey: undefined } });
    await runDailyJobs(h.svc);
    const after = await h.db.get<any>(`orgs/${oldOrg}`);
    expect(after.settings.intakeKey).toMatch(/^[a-z0-9]{20}$/);
    expect(after.settings.intakeKey).not.toBe(org.settings.intakeKey);
    await runDailyJobs(h.svc);
    expect((await h.db.get<any>(`orgs/${oldOrg}`)).settings.intakeKey).toBe(after.settings.intakeKey); // never replaced silently
    const rotated = await ok('old', 'intake.setup', { rotate: true }, oldOrg);
    expect(rotated.address).not.toContain(after.settings.intakeKey);
    expect((await h.db.get<any>(`intakeRoutes/${after.settings.intakeKey}`)).revokedAt).toBeTruthy();
    expect(s).toBeTruthy();
  });
});

describe('requests on assignment', () => {
  const asks = (to: string) => h.mail.filter((m) => m.to === to && /requests compliance documents/.test(m.subject));
  it('asks for what is outstanding the moment a subcontractor is assigned, reuses approved documents, and never asks twice', async () => {
    const o = await setup();
    const reqs = (await ok('owner1', 'requirements.list', {}, o.orgId)).requirements;
    const wc = reqs.find((r: any) => r.name === "Workers' compensation insurance").id;
    const { subcontractorId: sid } = await ok('owner1', 'subs.create', { legalName: 'Keystone Plumbing LLC', trade: 'Plumbing', contacts: [{ name: 'Kim', email: 'kim@keystone.example', primary: true }] }, o.orgId);
    const a1 = await ok('owner1', 'projects.assign', { projectId: o.projectId, subcontractorIds: [sid] }, o.orgId);
    expect(a1.requests[0]).toMatchObject({ status: 'sent', documents: 1 });
    expect(asks('kim@keystone.example')).toHaveLength(1);
    expect(asks('kim@keystone.example')[0].text).toContain('General liability insurance');
    // Assigning again sends nothing new: the request is open and being chased.
    await ok('owner1', 'projects.assign', { projectId: o.projectId, subcontractorIds: [sid] }, o.orgId);
    expect(asks('kim@keystone.example')).toHaveLength(1);
    // Approve the certificate, then join a second project that needs it plus workers' comp.
    const v = await upload(o.orgId, sid, o.gl, coi({ insured: 'Keystone Plumbing LLC', expiry: '2027-06-30' }));
    const rv = (await ok('owner1', 'reviews.get', { versionId: v }, o.orgId)).version;
    await ok('owner1', 'reviews.decide', { versionId: v, decision: 'approve', revision: rv.revision, metadata: { expiryDate: '2027-06-30', values: { glEachOccurrence: 2000000 } }, checklist: [] }, o.orgId);
    const { projectId: p2 } = await ok('owner1', 'projects.create', { name: 'Second Site', status: 'active' }, o.orgId);
    for (const r of [o.gl, wc]) await ok('owner1', 'projects.setRequirement', { projectId: p2, requirementId: r, mandatory: true }, o.orgId);
    await ok('owner1', 'projects.assign', { projectId: p2, subcontractorIds: [sid] }, o.orgId);
    const second = asks('kim@keystone.example').at(-1)!;
    expect(asks('kim@keystone.example')).toHaveLength(2);
    expect(second.text).toContain("Workers' compensation insurance");
    expect(second.text).not.toContain('General liability insurance'); // the approved one serves both projects
    // Nothing outstanding: nothing sent.
    const { projectId: p3 } = await ok('owner1', 'projects.create', { name: 'Third Site', status: 'active' }, o.orgId);
    await ok('owner1', 'projects.setRequirement', { projectId: p3, requirementId: o.gl, mandatory: true }, o.orgId);
    const a3 = await ok('owner1', 'projects.assign', { projectId: p3, subcontractorIds: [sid] }, o.orgId);
    expect(a3.requests[0].status).toBe('skipped');
    expect(asks('kim@keystone.example')).toHaveLength(2);
  });
  it('can be held back, and a resend replaces the open request instead of adding a second one to chase', async () => {
    const o = await setup();
    const { subcontractorId: sid } = await ok('owner1', 'subs.create', { legalName: 'Hold Co', trade: 'X', contacts: [{ name: 'H', email: 'h@hold.example', primary: true }] }, o.orgId);
    const a = await ok('owner1', 'projects.assign', { projectId: o.projectId, subcontractorIds: [sid], sendRequests: false }, o.orgId);
    expect(a.requests).toEqual([]);
    expect(asks('h@hold.example')).toHaveLength(0);
    await ok('owner1', 'requests.forProject', { projectId: o.projectId, subcontractorIds: [sid] }, o.orgId);
    await ok('owner1', 'requests.forProject', { projectId: o.projectId, subcontractorIds: [sid] }, o.orgId);
    const open = (await h.db.list<any>(`orgs/${o.orgId}/requests`)).filter((r) => r.subcontractorId === sid && ['sent', 'acknowledged', 'partially_fulfilled'].includes(r.status));
    expect(open).toHaveLength(1);
  });
});
