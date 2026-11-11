// End-to-end API tests against the real handlers with an in-memory database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleApi } from '../server/api';
import { MemoryDb } from '../server/db';
import { runDailyJobs } from '../server/jobs';
import { readEnv, type Services } from '../server/services';
import { LocalFileStore } from '../server/storage';

const PDF = (extra = '') => new TextEncoder().encode(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj ${extra}\ntrailer\n%%EOF\n`);

interface Harness { svc: Services; db: MemoryDb; files: LocalFileStore; mail: any[]; clock: { now: Date }; users: Record<string, { email: string; verified: boolean }> }

function harness(): Harness {
  const db = new MemoryDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
  const files = new LocalFileStore(dir, 'test-secret', 'http://test');
  const mail: any[] = [];
  const clock = { now: new Date('2026-06-15T14:00:00Z') };
  const users: Harness['users'] = {};
  const svc: Services = {
    mode: 'memory', db, files,
    auth: { async verify(t) { const u = users[t]; if (!u) throw new Error('bad'); return { uid: t, email: u.email, emailVerified: u.verified }; } },
    mail: { configured: true, async send(m) { mail.push(m); return { ok: true, dev: true }; } },
    env: { ...readEnv({ APP_URL: 'http://test' } as any) },
    // Advance 1 ms per read so event ordering is deterministic, like a real clock.
    now: () => (clock.now = new Date(clock.now.getTime() + 1)),
    async queueExtraction() {},
  };
  return { svc, db, files, mail, clock, users };
}

let h: Harness;
const call = async (uid: string | null, action: string, input: any = {}, orgId?: string) => {
  const r = await handleApi(h.svc, { action, input, authorization: uid ? `Bearer ${uid}` : null, orgId });
  return r;
};
const ok = async (uid: string | null, action: string, input: any = {}, orgId?: string) => {
  const r = await call(uid, action, input, orgId);
  if (r.status !== 200) throw new Error(`${action} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
async function uploadAsUser(uid: string, orgId: string, subcontractorId: string, requirementId: string, bytes = PDF(), fileName = 'coi.pdf') {
  const slot = await ok(uid, 'uploads.create', { subcontractorId, requirementId, fileName, mimeType: 'application/pdf', size: bytes.length }, orgId);
  const key = new URL(slot.upload.url).searchParams.get('key')!;
  h.files.write(key, bytes);
  return { slot, fin: await call(uid, 'uploads.finalize', { versionId: slot.versionId }, orgId) };
}
const linkToken = (mailItem: any) => /\/portal\/([A-Za-z0-9_-]+)/.exec(mailItem.text)![1];

async function setupOrg(owner = 'owner1', email = 'owner@acme.example') {
  h.users[owner] = { email, verified: true };
  const { orgId } = await ok(owner, 'org.register', { orgName: 'Acme Build', country: 'United States', timezone: 'America/Chicago', name: 'Olu Owner' });
  const reqs = (await ok(owner, 'requirements.list', {}, orgId)).requirements;
  const byName = (n: string) => reqs.find((r: any) => r.name === n).id;
  return { orgId, gl: byName('General liability insurance'), wc: byName("Workers' compensation insurance"), biz: byName('Business license'), auto: byName('Commercial auto insurance') };
}

beforeEach(() => { h = harness(); });

describe('auth and tenancy', () => {
  it('rejects unauthenticated and unverified callers', async () => {
    expect((await call(null, 'dashboard', {}, 'x')).status).toBe(401);
    h.users.u = { email: 'u@x.co', verified: false };
    const r = await call('u', 'org.register', { orgName: 'A', country: 'UK', timezone: 'UTC' });
    expect(r.status).toBe(403);
  });

  it('isolates tenants: a member of org A cannot read or write org B', async () => {
    const a = await setupOrg('ownerA', 'a@a.example');
    const b = await setupOrg('ownerB', 'b@b.example');
    const { subcontractorId } = await ok('ownerB', 'subs.create', { legalName: 'Bravo Electrical', trade: 'Electrical' }, b.orgId);
    expect((await call('ownerA', 'subs.list', {}, b.orgId)).status).toBe(403);
    expect((await call('ownerA', 'subs.get', { subcontractorId }, a.orgId)).status).toBe(404);
    expect((await call('ownerA', 'subs.update', { subcontractorId, legalName: 'Hacked' }, a.orgId)).status).toBe(404);
    expect((await call('ownerA', 'dashboard', {}, 'does-not-exist')).status).toBe(403);
  });

  it('enforces role permissions server-side', async () => {
    const o = await setupOrg();
    const inv = await ok('owner1', 'members.invite', { email: 'rev@acme.example', role: 'reviewer' }, o.orgId);
    h.users.rev = { email: 'rev@acme.example', verified: true };
    const token = new URL(inv.inviteUrl).searchParams.get('token');
    await ok('rev', 'invitations.accept', { token });
    expect((await call('rev', 'subs.create', { legalName: 'X', trade: 'Y' }, o.orgId)).status).toBe(403);
    expect((await call('rev', 'members.invite', { email: 'z@z.co', role: 'owner' }, o.orgId)).status).toBe(403);
    expect((await call('rev', 'reviews.queue', {}, o.orgId)).status).toBe(200);
    // Deactivated members lose access immediately.
    await ok('owner1', 'members.update', { uid: 'rev', status: 'deactivated' }, o.orgId);
    expect((await call('rev', 'reviews.queue', {}, o.orgId)).status).toBe(403);
    // The last owner cannot be removed.
    expect((await call('owner1', 'members.update', { uid: 'owner1', role: 'admin' }, o.orgId)).status).toBe(400);
  });

  it('scopes project managers to their assigned projects', async () => {
    const o = await setupOrg();
    const inv = await ok('owner1', 'members.invite', { email: 'pm@acme.example', role: 'project_manager' }, o.orgId);
    h.users.pm = { email: 'pm@acme.example', verified: true };
    await ok('pm', 'invitations.accept', { token: new URL(inv.inviteUrl).searchParams.get('token') });
    const p1 = await ok('owner1', 'projects.create', { name: 'Riverside', managerUid: 'pm' }, o.orgId);
    const p2 = await ok('owner1', 'projects.create', { name: 'Hilltop' }, o.orgId);
    const list = await ok('pm', 'projects.list', {}, o.orgId);
    expect(list.items.map((p: any) => p.name)).toEqual(['Riverside']);
    expect((await call('pm', 'projects.get', { projectId: p2.projectId }, o.orgId)).status).toBe(404);
    expect((await call('pm', 'projects.get', { projectId: p1.projectId }, o.orgId)).status).toBe(200);
  });
});

describe('end-to-end compliance workflow', () => {
  it('runs request → portal upload → review → readiness → notifications → audit', async () => {
    const o = await setupOrg();
    const { projectId } = await ok('owner1', 'projects.create', { name: 'Riverside Apartments', code: 'RSA-01', status: 'active' }, o.orgId);
    for (const r of [o.gl, o.wc]) await ok('owner1', 'projects.setRequirement', { projectId, requirementId: r, mandatory: true }, o.orgId);
    const { subcontractorId } = await ok('owner1', 'subs.create', {
      legalName: 'Brightline Electrical Ltd', trade: 'Electrical', contacts: [{ name: 'Ada Obi', email: 'ada@brightline.example', primary: true }],
    }, o.orgId);
    await ok('owner1', 'projects.assign', { projectId, subcontractorIds: [subcontractorId] }, o.orgId);
    let detail = await ok('owner1', 'projects.get', { projectId }, o.orgId);
    expect(detail.subcontractors[0].readiness).toBe('not_ready');
    expect(detail.subcontractors[0].missing).toEqual(['General liability insurance', "Workers' compensation insurance"]);

    const sub = (await ok('owner1', 'subs.get', { subcontractorId }, o.orgId)).subcontractor;
    const reqRes = await ok('owner1', 'requests.create', { subcontractorId, contactIds: [sub.contacts[0].id], requirementIds: [o.gl, o.wc], projectIds: [projectId], dueDate: '2026-06-30' }, o.orgId);
    expect(reqRes.results[0].emailStatus).toBe('dev_logged');
    const email = h.mail.find((m) => m.to === 'ada@brightline.example');
    expect(email.text).toContain('General liability insurance');
    const token = linkToken(email);

    // Subcontractor opens the link (no account) and uploads.
    const { session } = await ok(null, 'portal.open', { token });
    let state = await ok(null, 'portal.state', { session });
    expect(state.organisation.name).toBe('Acme Build');
    expect(state.requirements.map((r: any) => r.label)).toEqual(['Needed', 'Needed']);
    expect(JSON.stringify(state)).not.toContain('internal'); // no internal notes or other subs leak
    const bytes = PDF();
    const slot = await ok(null, 'portal.uploadCreate', { session, requirementId: o.gl, fileName: 'GL certificate.pdf', mimeType: 'application/pdf', size: bytes.length });
    h.files.write(new URL(slot.upload.url).searchParams.get('key')!, bytes);
    await ok(null, 'portal.uploadFinalize', { session, versionId: slot.versionId });
    // Out-of-scope requirement is refused.
    expect((await call(null, 'portal.uploadCreate', { session, requirementId: o.auto, fileName: 'a.pdf', mimeType: 'application/pdf', size: 10 })).status).toBe(403);

    detail = await ok('owner1', 'projects.get', { projectId }, o.orgId);
    expect(detail.subcontractors[0].readiness).toBe('not_ready'); // WC still missing; GL awaiting review
    const queue = await ok('owner1', 'reviews.queue', {}, o.orgId);
    expect(queue.items).toHaveLength(1);
    const notifs = await ok('owner1', 'notifications.list', {}, o.orgId);
    expect(notifs.items.some((n: any) => n.type === 'awaiting_review')).toBe(true);

    // Approval requires an expiry date for expiring requirements.
    const vid = queue.items[0].versionId;
    expect((await call('owner1', 'reviews.decide', { versionId: vid, decision: 'approve', metadata: {} }, o.orgId)).status).toBe(400);
    // Criteria are enforced against confirmed values.
    const low = await call('owner1', 'reviews.decide', { versionId: vid, decision: 'approve', metadata: { expiryDate: '2027-03-31', values: { glEachOccurrence: 500000, glAggregate: 2000000 } } }, o.orgId);
    expect(low.status).toBe(422);
    await ok('owner1', 'reviews.decide', { versionId: vid, decision: 'approve', metadata: { expiryDate: '2027-03-31', issuer: 'Northwind Mutual', referenceNumber: 'GL-123', values: { glEachOccurrence: 2000000, glAggregate: 4000000 } } }, o.orgId);

    // Upload WC as staff, then reject with a reason the subcontractor receives.
    const wc1 = await uploadAsUser('owner1', o.orgId, subcontractorId, o.wc);
    expect(wc1.fin.status).toBe(200);
    await ok('owner1', 'reviews.decide', { versionId: wc1.slot.versionId, decision: 'reject', reason: 'Certificate is for a different company' }, o.orgId);
    expect(h.mail.some((m) => m.to === 'ada@brightline.example' && m.text.includes('different company'))).toBe(true);
    state = await ok(null, 'portal.state', { session });
    const wcState = state.requirements.find((r: any) => r.id === o.wc);
    expect(wcState.label).toMatch(/Not accepted/);
    expect(wcState.rejectionReason).toBe('Certificate is for a different company');

    const wc2 = await uploadAsUser('owner1', o.orgId, subcontractorId, o.wc);
    await ok('owner1', 'reviews.decide', { versionId: wc2.slot.versionId, decision: 'approve', metadata: { expiryDate: '2027-01-31', values: { wcCoverage: true } } }, o.orgId);
    detail = await ok('owner1', 'projects.get', { projectId }, o.orgId);
    expect(detail.subcontractors[0].reasons).toEqual(['All 2 mandatory requirements are approved and in date.']);
    expect(detail.subcontractors[0].readiness).toBe('ready');
    const dash = await ok('owner1', 'dashboard', {}, o.orgId);
    expect(dash.metrics).toMatchObject({ activeProjects: 1, activeSubcontractors: 1, ready: 1, notReady: 0 });
    expect(dash.attention.find((a: any) => a.key === 'reviews').count).toBe(0);

    const auditLog = await ok('owner1', 'audit.list', { ref: subcontractorId }, o.orgId);
    const actions = auditLog.items.map((e: any) => e.action);
    for (const a of ['subcontractor.created', 'request.sent', 'document.uploaded', 'document.approved', 'document.rejected', 'document.replaced', 'compliance.status_changed']) expect(actions).toContain(a);
    const hist = await ok('owner1', 'compliance.history', { subcontractorId, projectId }, o.orgId);
    expect(hist.items[0].readiness).toBe('ready');
    expect(hist.items.at(-1).readiness).toBe('not_ready');
    // Reports reflect the data
    const rep = await ok('owner1', 'reports.run', { type: 'project_readiness', filters: { projectId } }, o.orgId);
    expect(rep.rows[0]).toMatchObject({ company: 'Brightline Electrical Ltd', readiness: 'Ready' });
  });

  it('is compliant on one project but not another', async () => {
    const o = await setupOrg();
    const A = await ok('owner1', 'projects.create', { name: 'A' }, o.orgId);
    const B = await ok('owner1', 'projects.create', { name: 'B' }, o.orgId);
    await ok('owner1', 'projects.setRequirement', { projectId: A.projectId, requirementId: o.biz, mandatory: true }, o.orgId);
    await ok('owner1', 'projects.setRequirement', { projectId: B.projectId, requirementId: o.biz, mandatory: true }, o.orgId);
    await ok('owner1', 'projects.setRequirement', { projectId: B.projectId, requirementId: o.auto, mandatory: true }, o.orgId);
    const { subcontractorId } = await ok('owner1', 'subs.create', { legalName: 'Multi Co', trade: 'General' }, o.orgId);
    await ok('owner1', 'projects.assign', { projectId: A.projectId, subcontractorIds: [subcontractorId] }, o.orgId);
    await ok('owner1', 'projects.assign', { projectId: B.projectId, subcontractorIds: [subcontractorId] }, o.orgId);
    const up = await uploadAsUser('owner1', o.orgId, subcontractorId, o.biz);
    await ok('owner1', 'reviews.decide', { versionId: up.slot.versionId, decision: 'approve', metadata: {} }, o.orgId);
    const s = await ok('owner1', 'subs.get', { subcontractorId }, o.orgId);
    const byName = Object.fromEntries(s.projects.map((p: any) => [p.name, p.readiness]));
    expect(byName).toEqual({ A: 'ready', B: 'not_ready' });
  });

  it('prevents two reviewers deciding the same document', async () => {
    const o = await setupOrg();
    const inv = await ok('owner1', 'members.invite', { email: 'r2@acme.example', role: 'reviewer' }, o.orgId);
    h.users.r2 = { email: 'r2@acme.example', verified: true };
    await ok('r2', 'invitations.accept', { token: new URL(inv.inviteUrl).searchParams.get('token') });
    const { subcontractorId } = await ok('owner1', 'subs.create', { legalName: 'Race Co', trade: 'General' }, o.orgId);
    const up = await uploadAsUser('owner1', o.orgId, subcontractorId, o.biz);
    const vid = up.slot.versionId;
    await ok('owner1', 'reviews.claim', { versionId: vid }, o.orgId);
    expect((await call('r2', 'reviews.claim', { versionId: vid }, o.orgId)).status).toBe(409);
    expect((await call('r2', 'reviews.decide', { versionId: vid, decision: 'approve' }, o.orgId)).status).toBe(409);
    const [a, b] = await Promise.all([
      call('owner1', 'reviews.decide', { versionId: vid, decision: 'approve' }, o.orgId),
      call('owner1', 'reviews.decide', { versionId: vid, decision: 'reject', reason: 'dup' }, o.orgId),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('blocks malicious or disguised uploads and never records them as submitted', async () => {
    const o = await setupOrg();
    const { subcontractorId } = await ok('owner1', 'subs.create', { legalName: 'Evil Co', trade: 'General' }, o.orgId);
    const bad = await uploadAsUser('owner1', o.orgId, subcontractorId, o.biz, PDF('<< /OpenAction << /S /JavaScript /JS (x) >> >>'));
    expect(bad.fin.status).toBe(422);
    const exe = await uploadAsUser('owner1', o.orgId, subcontractorId, o.biz, new TextEncoder().encode('MZ executable'));
    expect(exe.fin.status).toBe(422);
    expect((await ok('owner1', 'reviews.queue', {}, o.orgId)).items).toHaveLength(0);
    expect((await call('owner1', 'uploads.create', { subcontractorId, requirementId: o.biz, fileName: 'x.exe', mimeType: 'application/x-msdownload', size: 10 }, o.orgId)).status).toBe(400);
    expect((await call('owner1', 'uploads.create', { subcontractorId, requirementId: o.biz, fileName: 'x.pdf', mimeType: 'application/pdf', size: 40 * 1024 * 1024 }, o.orgId)).status).toBe(400);
    // Signed file URLs are refused for quarantined versions.
    expect((await call('owner1', 'files.url', { versionId: bad.slot.versionId }, o.orgId)).status).toBe(404);
  });

  it('keeps every version and supersedes the old approval on replacement', async () => {
    const o = await setupOrg();
    const { subcontractorId } = await ok('owner1', 'subs.create', { legalName: 'Versions Ltd', trade: 'General' }, o.orgId);
    const v1 = await uploadAsUser('owner1', o.orgId, subcontractorId, o.gl);
    await ok('owner1', 'reviews.decide', { versionId: v1.slot.versionId, decision: 'approve', metadata: { expiryDate: '2026-07-01', values: { glEachOccurrence: 1e6, glAggregate: 2e6 } } }, o.orgId);
    const v2 = await uploadAsUser('owner1', o.orgId, subcontractorId, o.gl);
    expect(v2.slot.documentId).toBe(v1.slot.documentId);
    await ok('owner1', 'reviews.decide', { versionId: v2.slot.versionId, decision: 'approve', metadata: { expiryDate: '2027-07-01', values: { glEachOccurrence: 1e6, glAggregate: 2e6 } } }, o.orgId);
    const doc = await ok('owner1', 'documents.get', { documentId: v1.slot.documentId }, o.orgId);
    expect(doc.versions.map((v: any) => [v.versionNumber, v.reviewStatus])).toEqual([[2, 'approved'], [1, 'superseded']]);
    expect(doc.document.approvedVersionId).toBe(v2.slot.versionId);
    const url = await ok('owner1', 'files.url', { versionId: v1.slot.versionId }, o.orgId);
    expect(url.url).toContain('sig=');
  });
});

describe('external links', () => {
  async function linkFor() {
    const o = await setupOrg();
    const { subcontractorId } = await ok('owner1', 'subs.create', { legalName: 'Link Co', trade: 'General', contacts: [{ name: 'Sam', email: 'sam@link.example' }, { name: 'Kay', email: 'kay@link.example' }] }, o.orgId);
    const s = (await ok('owner1', 'subs.get', { subcontractorId }, o.orgId)).subcontractor;
    const res = await ok('owner1', 'requests.create', { subcontractorId, contactIds: s.contacts.map((c: any) => c.id), requirementIds: [o.biz], expiresInDays: 3 }, o.orgId);
    return { o, subcontractorId, res, tokens: h.mail.filter((m) => m.to.endsWith('@link.example')).map(linkToken) };
  }
  it('issues one link per contact and expires them', async () => {
    const { tokens } = await linkFor();
    expect(tokens).toHaveLength(2);
    await ok(null, 'portal.open', { token: tokens[0] });
    h.clock.now = new Date('2026-06-19T09:00:00Z');
    const r = await call(null, 'portal.open', { token: tokens[0] });
    expect(r.status).toBe(410);
    expect((r.body as any).code).toBe('link_expired');
  });
  it('revocation and suspension cut off access, including live sessions', async () => {
    const { o, subcontractorId, res, tokens } = await linkFor();
    const { session } = await ok(null, 'portal.open', { token: tokens[1] });
    const list = await ok('owner1', 'requests.list', { subcontractorId }, o.orgId);
    const kay = list.items.find((i: any) => i.contactEmail === 'kay@link.example');
    await ok('owner1', 'links.revoke', { linkId: kay.link.id }, o.orgId);
    expect((await call(null, 'portal.state', { session })).status).toBe(410);
    expect((await call(null, 'portal.open', { token: tokens[1] })).status).toBe(410);
    const s0 = await ok(null, 'portal.open', { token: tokens[0] });
    await ok('owner1', 'subs.setStatus', { subcontractorId, status: 'suspended', reason: 'Safety incident under investigation' }, o.orgId);
    expect((await call(null, 'portal.state', { session: s0.session })).status).toBe(410);
    expect(res.results).toHaveLength(2);
  });
  it('rejects forged or tampered tokens and sessions', async () => {
    expect((await call(null, 'portal.open', { token: 'not-a-real-token' })).status).toBe(404);
    expect((await call(null, 'portal.state', { session: 'eyJvIjoieCJ9.forged' })).status).toBe(401);
  });
  it('requires an email code for full portal access', async () => {
    const o = await setupOrg();
    const { subcontractorId } = await ok('owner1', 'subs.create', { legalName: 'Portal Co', trade: 'General', contacts: [{ name: 'Lee', email: 'lee@portal.example' }] }, o.orgId);
    const s = (await ok('owner1', 'subs.get', { subcontractorId }, o.orgId)).subcontractor;
    await ok('owner1', 'requests.create', { subcontractorId, type: 'portal_access', contactIds: [s.contacts[0].id] }, o.orgId);
    const token = linkToken(h.mail.find((m) => m.to === 'lee@portal.example'));
    const first = await ok(null, 'portal.open', { token });
    expect(first.needsCode).toBe(true);
    const code = /\n(\d{6})\n/.exec(h.mail.at(-1).text)![1];
    expect((await call(null, 'portal.open', { token, code: '000000' === code ? '111111' : '000000' })).status).toBe(401);
    expect((await ok(null, 'portal.open', { token, code })).session).toBeTruthy();
  });
});

describe('renewals and reminders', () => {
  it('sends each reminder once, retries failures, and respects archived records', async () => {
    const o = await setupOrg();
    const { projectId } = await ok('owner1', 'projects.create', { name: 'Live', status: 'active' }, o.orgId);
    await ok('owner1', 'projects.setRequirement', { projectId, requirementId: o.gl, mandatory: true }, o.orgId);
    const { subcontractorId } = await ok('owner1', 'subs.create', { legalName: 'Renew Co', trade: 'General', contacts: [{ name: 'Rae', email: 'rae@renew.example' }] }, o.orgId);
    await ok('owner1', 'projects.assign', { projectId, subcontractorIds: [subcontractorId] }, o.orgId);
    const up = await uploadAsUser('owner1', o.orgId, subcontractorId, o.gl);
    await ok('owner1', 'reviews.decide', { versionId: up.slot.versionId, decision: 'approve', metadata: { expiryDate: '2026-07-10', values: { glEachOccurrence: 1e6, glAggregate: 2e6 } } }, o.orgId); // 25 days out
    const before = h.mail.length;
    await runDailyJobs(h.svc);
    await runDailyJobs(h.svc); // retry/overlap must not duplicate
    const sent = h.mail.slice(before).filter((m) => m.to === 'rae@renew.example');
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/expires in 25 days/);
    const ren = await ok('owner1', 'renewals.list', {}, o.orgId);
    expect(ren.items[0]).toMatchObject({ stage: 'requested', days: 25 });
    // Advance to 13 days before expiry: the 14-day reminder fires.
    h.clock.now = new Date('2026-06-27T09:00:00Z');
    await runDailyJobs(h.svc);
    expect(h.mail.filter((m) => m.to === 'rae@renew.example' && /expires in 13 days/.test(m.subject))).toHaveLength(1);
    // After expiry the subcontractor becomes not ready.
    h.clock.now = new Date('2026-07-11T09:00:00Z');
    await runDailyJobs(h.svc);
    const d = await ok('owner1', 'projects.get', { projectId }, o.orgId);
    expect(d.subcontractors[0].readiness).toBe('not_ready');
    expect(d.subcontractors[0].expired).toEqual(['General liability insurance']);
    // Archiving the project stops reminders.
    await ok('owner1', 'projects.archive', { projectId, archived: true }, o.orgId);
    const n = h.mail.length;
    h.clock.now = new Date('2026-07-20T09:00:00Z');
    await runDailyJobs(h.svc);
    expect(h.mail.length).toBe(n);
  });

  it('retries a failed reminder delivery and logs the failure', async () => {
    const o = await setupOrg();
    const { projectId } = await ok('owner1', 'projects.create', { name: 'Live', status: 'active' }, o.orgId);
    const { subcontractorId } = await ok('owner1', 'subs.create', { legalName: 'Flaky Co', trade: 'General', contacts: [{ name: 'F', email: 'f@flaky.example' }] }, o.orgId);
    await ok('owner1', 'projects.assign', { projectId, subcontractorIds: [subcontractorId] }, o.orgId);
    const up = await uploadAsUser('owner1', o.orgId, subcontractorId, o.biz);
    await ok('owner1', 'reviews.decide', { versionId: up.slot.versionId, decision: 'approve', metadata: { expiryDate: '2026-06-20' } }, o.orgId);
    const orig = h.svc.mail.send;
    h.svc.mail.send = async () => ({ ok: false, error: 'SMTP down' });
    await runDailyJobs(h.svc);
    const logs = await ok('owner1', 'deliveryLogs.list', {}, o.orgId);
    expect(logs.items.some((l: any) => l.status === 'failed' && l.error === 'SMTP down')).toBe(true);
    h.svc.mail.send = orig;
    const before = h.mail.length;
    await runDailyJobs(h.svc);
    expect(h.mail.slice(before).filter((m) => m.to === 'f@flaky.example')).toHaveLength(1);
  });
});

describe('templates and requirement changes', () => {
  it('versions templates without silently changing projects, and re-checks approvals when requirements change', async () => {
    const o = await setupOrg();
    const { templates } = await ok('owner1', 'requirements.list', {}, o.orgId);
    const tpl = templates.find((t: any) => t.name === 'General subcontractor onboarding');
    const { projectId } = await ok('owner1', 'projects.create', { name: 'T', templateId: tpl.id }, o.orgId);
    let d = await ok('owner1', 'projects.get', { projectId }, o.orgId);
    expect(d.requirements).toHaveLength(tpl.items.length);
    await ok('owner1', 'templates.save', { templateId: tpl.id, items: tpl.items.slice(0, 2) }, o.orgId);
    d = await ok('owner1', 'projects.get', { projectId }, o.orgId);
    expect(d.requirements).toHaveLength(tpl.items.length); // unchanged until re-applied
    expect(d.templates.find((t: any) => t.id === tpl.id).outdated).toBe(true);

    const { subcontractorId } = await ok('owner1', 'subs.create', { legalName: 'Crit Co', trade: 'General' }, o.orgId);
    const { projectId: p2 } = await ok('owner1', 'projects.create', { name: 'GL only' }, o.orgId);
    await ok('owner1', 'projects.setRequirement', { projectId: p2, requirementId: o.gl, mandatory: true }, o.orgId);
    await ok('owner1', 'projects.assign', { projectId: p2, subcontractorIds: [subcontractorId] }, o.orgId);
    const up = await uploadAsUser('owner1', o.orgId, subcontractorId, o.gl);
    await ok('owner1', 'reviews.decide', { versionId: up.slot.versionId, decision: 'approve', metadata: { expiryDate: '2027-06-01', values: { glEachOccurrence: 1e6, glAggregate: 2e6 } } }, o.orgId);
    expect((await ok('owner1', 'projects.get', { projectId: p2 }, o.orgId)).subcontractors[0].readiness).toBe('ready');
    const glDef = (await ok('owner1', 'requirements.list', {}, o.orgId)).requirements.find((r: any) => r.id === o.gl);
    await ok('owner1', 'requirements.update', { requirementId: o.gl, criteria: glDef.criteria.map((c: any) => c.key === 'glEachOccurrence' ? { ...c, value: 2e6 } : c) }, o.orgId);
    const after = (await ok('owner1', 'projects.get', { projectId: p2 }, o.orgId)).subcontractors[0];
    expect(after.readiness).toBe('not_ready');
    expect(after.results[0].status).toBe('review_required');
    const hist = await ok('owner1', 'requirements.history', { requirementId: o.gl }, o.orgId);
    expect(hist.versions.map((v: any) => v.version)).toEqual([2, 1]);
  });

  it('records not-applicable decisions with reason and actor', async () => {
    const o = await setupOrg();
    const { projectId } = await ok('owner1', 'projects.create', { name: 'NA' }, o.orgId);
    await ok('owner1', 'projects.setRequirement', { projectId, requirementId: o.auto, mandatory: true }, o.orgId);
    const { subcontractorId } = await ok('owner1', 'subs.create', { legalName: 'No Vans Ltd', trade: 'General' }, o.orgId);
    await ok('owner1', 'projects.assign', { projectId, subcontractorIds: [subcontractorId] }, o.orgId);
    expect((await call('owner1', 'overrides.set', { type: 'not_applicable', subcontractorId, requirementId: o.auto, projectId }, o.orgId)).status).toBe(400);
    await ok('owner1', 'overrides.set', { type: 'not_applicable', subcontractorId, requirementId: o.auto, projectId, reason: 'Works on foot; no vehicles on site' }, o.orgId);
    const s = (await ok('owner1', 'projects.get', { projectId }, o.orgId)).subcontractors[0];
    expect(s.readiness).toBe('ready');
    expect(s.results[0].reason).toMatch(/Olu Owner.*no vehicles/);
  });
});

describe('CSV import and plan limits', () => {
  it('imports, skips duplicates and enforces plan limits', async () => {
    const o = await setupOrg();
    const csv = 'Legal name,Trade,Contact email\nAlpha Roofing,Roofing,a@alpha.example\nBeta Plumbing,Plumbing,b@beta.example\nBad Row,,\n';
    const dry = await ok('owner1', 'subs.import', { csv, dryRun: true }, o.orgId);
    expect(dry.preview).toHaveLength(2);
    expect(dry.errors).toHaveLength(1);
    const r = await ok('owner1', 'subs.import', { csv }, o.orgId);
    expect(r.created).toBe(2);
    const again = await ok('owner1', 'subs.import', { csv }, o.orgId);
    expect(again.created).toBe(0);
    expect(again.skipped).toHaveLength(2);
    // Trial ends → creating records is blocked with a clear message.
    h.clock.now = new Date('2026-07-15T00:00:00Z');
    const blocked = await call('owner1', 'subs.create', { legalName: 'Late Co', trade: 'X' }, o.orgId);
    expect(blocked.status).toBe(402);
  });
});

describe('US/UK markets and sample data', () => {
  it('seeds market-specific terminology and loads/removes labelled sample data', async () => {
    h.users.uk = { email: 'ops@ashdown.example', verified: true };
    const { orgId } = await ok('uk', 'org.register', { orgName: 'Ashdown Construction Ltd', country: 'United Kingdom', timezone: 'Europe/London' });
    const me = await ok('uk', 'me', {}, orgId);
    expect(me.org.settings).toMatchObject({ market: 'UK', locale: 'en-GB', currency: 'GBP' });
    const lib = await ok('uk', 'requirements.list', {}, orgId);
    expect(lib.requirements.map((r: any) => r.name)).toContain('Public liability insurance');
    expect(lib.requirements.map((r: any) => r.name)).toContain("Employers' liability insurance");
    const r = await ok('uk', 'org.loadSample', {}, orgId);
    expect(r).toEqual({ projects: 3, subcontractors: 5 });
    const projects = await ok('uk', 'projects.list', {}, orgId);
    expect(projects.items.map((p: any) => p.location).sort()).toEqual(['Birmingham', 'London', 'Manchester']);
    expect(projects.items.every((p: any) => p.sample)).toBe(true);
    const dash = await ok('uk', 'dashboard', {}, orgId);
    expect(dash.metrics.activeSubcontractors).toBe(5);
    expect(dash.metrics.ready).toBeGreaterThan(0);
    expect(dash.attention.find((a: any) => a.key === 'reviews').count).toBeGreaterThan(0);
    expect(h.mail.filter((m) => m.to.endsWith('.example') && !m.to.startsWith('ops'))).toHaveLength(0); // no emails to sample contacts
    await ok('uk', 'org.clearSample', {}, orgId);
    expect((await ok('uk', 'projects.list', {}, orgId)).items).toHaveLength(0);
    expect((await ok('uk', 'subs.list', {}, orgId)).items).toHaveLength(0);

    h.users.us = { email: 'ops@lonestar-gc.example', verified: true };
    const us = await ok('us', 'org.register', { orgName: 'Brazos Builders Inc.', country: 'United States', timezone: 'America/Chicago' });
    expect((await ok('us', 'requirements.list', {}, us.orgId)).requirements.map((x: any) => x.name)).toContain('General liability insurance');
    await ok('us', 'org.loadSample', {}, us.orgId);
    const usp = await ok('us', 'projects.list', {}, us.orgId);
    expect(usp.items.map((p: any) => p.location).sort()).toEqual(['Austin, TX', 'Chicago, IL', 'Dallas, TX']);
  });
});
