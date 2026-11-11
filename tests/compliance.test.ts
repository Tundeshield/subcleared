import { describe, expect, it } from 'vitest';
import { dueReminder, evaluate, type EvalInput } from '../src/domain/compliance';
import { addDays, daysBetween, isExpired, todayIn } from '../src/domain/dates';
import type { DocumentRecord, DocumentVersion, ProjectRequirement, RequirementDefinition } from '../src/domain/types';

const NOW = new Date('2026-06-15T12:00:00Z');
const TODAY = '2026-06-15';

function def(id: string, over: Partial<RequirementDefinition> = {}): RequirementDefinition {
  return {
    id, name: id.toUpperCase(), description: '', category: 'Insurance', kind: 'document', subTypes: [], defaultMandatory: true,
    expiryRequired: true, renewal: 'on_expiry', reviewRequired: true, criteria: [], active: true, version: 1,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
  };
}
function pr(projectId: string, requirementId: string, mandatory = true): ProjectRequirement {
  return { id: `${projectId}_${requirementId}`, projectId, requirementId, mandatory, source: { type: 'manual' }, active: true, addedAt: '2026-01-01T00:00:00Z', addedBy: 'u1' };
}
function doc(id: string, requirementId: string, projectIds: string[] = []): DocumentRecord {
  return { id, subcontractorId: 's1', requirementId, title: id, projectIds, archived: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
}
function ver(id: string, documentId: string, over: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    id, documentId, subcontractorId: 's1', versionNumber: 1, fileName: 'a.pdf', mimeType: 'application/pdf', size: 10,
    uploadedAt: '2026-05-01T00:00:00Z', uploadedBy: { type: 'portal', id: 'c1', name: 'Ada' }, scan: { status: 'clean' },
    extraction: { status: 'not_configured' }, metadata: {}, reviewStatus: 'awaiting_review', verification: 'received', revision: 0, ...over,
  };
}
const approved = (expiryDate?: string, extra: Partial<DocumentVersion> = {}): Partial<DocumentVersion> => ({
  reviewStatus: 'approved', verification: 'reviewed', metadata: { expiryDate },
  review: { decision: 'approved', reviewerUid: 'r1', reviewerName: 'Rev', at: '2026-05-02T00:00:00Z', requirementVersion: 1 }, ...extra,
});

const defs = new Map(['gl', 'wc', 'biz', 'auto'].map((k) => [k, def(k, k === 'biz' ? { expiryRequired: false } : {})]));

function input(over: Partial<EvalInput>): EvalInput {
  return {
    project: { id: 'pA', status: 'active' }, subcontractor: { id: 's1', status: 'active', subTypes: ['general'] },
    projectRequirements: [], definitions: defs, documents: [], versions: [], overrides: [], requests: [],
    settings: { expiringSoonDays: 30, timezone: 'UTC' }, now: NOW, ...over,
  };
}

describe('dates', () => {
  it('computes calendar days and expiry inclusive of the expiry date', () => {
    expect(daysBetween('2026-06-15', '2026-07-15')).toBe(30);
    expect(isExpired('2026-06-15', '2026-06-15')).toBe(false);
    expect(isExpired('2026-06-14', '2026-06-15')).toBe(true);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('is timezone aware for "today"', () => {
    const lateUtc = new Date('2026-06-15T23:30:00Z');
    expect(todayIn('UTC', lateUtc)).toBe('2026-06-15');
    expect(todayIn('Asia/Tokyo', lateUtc)).toBe('2026-06-16');
    expect(todayIn('America/Los_Angeles', new Date('2026-06-16T03:00:00Z'))).toBe('2026-06-15');
  });
});

describe('compliance engine', () => {
  it('is not evaluated when no requirements are configured', () => {
    const e = evaluate(input({}));
    expect(e.readiness).toBe('not_evaluated');
  });

  it('never treats a missing document as compliant', () => {
    const e = evaluate(input({ projectRequirements: [pr('pA', 'gl')] }));
    expect(e.readiness).toBe('not_ready');
    expect(e.results[0].status).toBe('missing');
    expect(e.reasons[0]).toMatch(/GL: missing/);
  });

  it('is ready when all mandatory requirements are approved and in date', () => {
    const e = evaluate(input({
      projectRequirements: [pr('pA', 'gl'), pr('pA', 'biz')],
      documents: [doc('d1', 'gl'), doc('d2', 'biz')],
      versions: [ver('v1', 'd1', approved('2027-01-01')), ver('v2', 'd2', approved(undefined))],
    }));
    expect(e.readiness).toBe('ready');
    expect(e.results.map((r) => r.status)).toEqual(['approved', 'approved']);
    expect(e.results[1].reason).toMatch(/does not expire/);
  });

  it('does not count an upload as compliance before review', () => {
    const e = evaluate(input({ projectRequirements: [pr('pA', 'gl')], documents: [doc('d1', 'gl')], versions: [ver('v1', 'd1')] }));
    expect(e.results[0].status).toBe('awaiting_review');
    expect(e.readiness).toBe('action_required');
  });

  it('optional requirements never block readiness', () => {
    const e = evaluate(input({
      projectRequirements: [pr('pA', 'gl'), pr('pA', 'auto', false)],
      documents: [doc('d1', 'gl')], versions: [ver('v1', 'd1', approved('2027-01-01'))],
    }));
    expect(e.results.find((r) => r.requirementId === 'auto')?.status).toBe('missing');
    expect(e.readiness).toBe('ready');
  });

  it('flags documents expiring within the configured window', () => {
    const e = evaluate(input({ projectRequirements: [pr('pA', 'gl')], documents: [doc('d1', 'gl')], versions: [ver('v1', 'd1', approved(addDays(TODAY, 20)))] }));
    expect(e.results[0].status).toBe('expiring_soon');
    expect(e.results[0].daysToExpiry).toBe(20);
    expect(e.readiness).toBe('action_required');
    const e2 = evaluate(input({ settings: { expiringSoonDays: 14, timezone: 'UTC' }, projectRequirements: [pr('pA', 'gl')], documents: [doc('d1', 'gl')], versions: [ver('v1', 'd1', approved(addDays(TODAY, 20)))] }));
    expect(e2.readiness).toBe('ready');
  });

  it('expired mandatory evidence makes a subcontractor not ready', () => {
    const e = evaluate(input({ projectRequirements: [pr('pA', 'gl')], documents: [doc('d1', 'gl')], versions: [ver('v1', 'd1', approved('2026-06-14'))] }));
    expect(e.results[0].status).toBe('expired');
    expect(e.readiness).toBe('not_ready');
  });

  it('keeps the approved version in force while a replacement awaits review', () => {
    const e = evaluate(input({
      projectRequirements: [pr('pA', 'gl')], documents: [doc('d1', 'gl')],
      versions: [ver('v1', 'd1', approved('2027-01-01')), ver('v2', 'd1', { uploadedAt: '2026-06-10T00:00:00Z', versionNumber: 2 })],
    }));
    expect(e.results[0].status).toBe('approved');
    expect(e.results[0].versionId).toBe('v1');
    expect(e.results[0].reason).toMatch(/replacement is awaiting review/);
  });

  it('a document uploaded after its expiry date still reads as expired once approved', () => {
    const e = evaluate(input({ projectRequirements: [pr('pA', 'gl')], documents: [doc('d1', 'gl')], versions: [ver('v1', 'd1', approved('2026-01-01'))] }));
    expect(e.results[0].status).toBe('expired');
  });

  it('rejected submissions block and carry the reason', () => {
    const e = evaluate(input({
      projectRequirements: [pr('pA', 'gl')], documents: [doc('d1', 'gl')],
      versions: [ver('v1', 'd1', { reviewStatus: 'rejected', review: { decision: 'rejected', reason: 'Wrong named insured', reviewerUid: 'r', reviewerName: 'R', at: '2026-05-03T00:00:00Z' } })],
    }));
    expect(e.results[0].status).toBe('rejected');
    expect(e.results[0].reason).toMatch(/Wrong named insured/);
    expect(e.readiness).toBe('not_ready');
  });

  it('calculates readiness separately per project', () => {
    const base = {
      projectRequirements: [pr('pA', 'gl'), pr('pA', 'wc'), pr('pB', 'gl'), pr('pB', 'wc'), pr('pB', 'auto')],
      documents: [doc('d1', 'gl'), doc('d2', 'wc')],
      versions: [ver('v1', 'd1', approved('2027-01-01')), ver('v2', 'd2', approved('2027-01-01'))],
    };
    expect(evaluate(input({ ...base, project: { id: 'pA', status: 'active' } })).readiness).toBe('ready');
    const b = evaluate(input({ ...base, project: { id: 'pB', status: 'active' } }));
    expect(b.readiness).toBe('not_ready');
    expect(b.results.find((r) => r.requirementId === 'auto')?.status).toBe('missing');
  });

  it('respects project-scoped documents', () => {
    const e = evaluate(input({ project: { id: 'pB', status: 'active' }, projectRequirements: [pr('pB', 'gl')], documents: [doc('d1', 'gl', ['pA'])], versions: [ver('v1', 'd1', approved('2027-01-01'))] }));
    expect(e.results[0].status).toBe('missing');
  });

  it('not applicable needs a recorded decision and shows who made it', () => {
    const e = evaluate(input({
      projectRequirements: [pr('pA', 'auto')],
      overrides: [{ id: 'o', scope: 'pA', subcontractorId: 's1', requirementId: 'auto', type: 'not_applicable', reason: 'No vehicles used', decidedBy: { uid: 'u', name: 'Kemi' }, decidedAt: '2026-06-01T00:00:00Z' }],
    }));
    expect(e.results[0].status).toBe('not_applicable');
    expect(e.results[0].reason).toMatch(/Kemi.*No vehicles used/);
    expect(e.readiness).toBe('ready');
  });

  it('suspended subcontractors are not ready even with full evidence', () => {
    const e = evaluate(input({
      subcontractor: { id: 's1', status: 'suspended', subTypes: [] },
      projectRequirements: [pr('pA', 'gl')], documents: [doc('d1', 'gl')], versions: [ver('v1', 'd1', approved('2027-01-01'))],
    }));
    expect(e.readiness).toBe('not_ready');
    expect(e.reasons[0]).toMatch(/suspended/);
  });

  it('re-checks approved evidence when requirement criteria change', () => {
    const glV2 = def('gl', { version: 2, criteria: [{ key: 'glEachOccurrence', label: 'GL each occurrence', type: 'min_amount', value: 2_000_000 }] });
    const e = evaluate(input({
      definitions: new Map([['gl', glV2]]), projectRequirements: [pr('pA', 'gl')], documents: [doc('d1', 'gl')],
      versions: [ver('v1', 'd1', approved('2027-01-01', { metadata: { expiryDate: '2027-01-01', values: { glEachOccurrence: 1_000_000 } } }))],
    }));
    expect(e.results[0].status).toBe('review_required');
    expect(e.results[0].reason).toMatch(/No longer meets/);
    expect(e.readiness).toBe('not_ready');
  });

  it('flags re-review (non-blocking) when new criteria were not recorded at approval', () => {
    const glV2 = def('gl', { version: 2, criteria: [{ key: 'waiverOfSubrogation', label: 'Waiver', type: 'boolean', value: true }] });
    const e = evaluate(input({ definitions: new Map([['gl', glV2]]), projectRequirements: [pr('pA', 'gl')], documents: [doc('d1', 'gl')], versions: [ver('v1', 'd1', approved('2027-01-01'))] }));
    expect(e.results[0].status).toBe('review_required');
    expect(e.readiness).toBe('action_required');
  });

  it('tracks requested and overdue states', () => {
    const req = { id: 'r1', type: 'request' as const, subcontractorId: 's1', contactEmail: 'a@b.co', projectIds: ['pA'], requirementIds: ['gl'], status: 'sent' as const, linkId: 'l', createdBy: { uid: 'u', name: 'U' }, createdAt: '2026-06-01T00:00:00Z' };
    expect(evaluate(input({ projectRequirements: [pr('pA', 'gl')], requests: [{ ...req, dueDate: '2026-06-20' }] })).results[0].status).toBe('requested');
    expect(evaluate(input({ projectRequirements: [pr('pA', 'gl')], requests: [{ ...req, dueDate: '2026-06-10' }] })).results[0].status).toBe('overdue');
  });

  it('applies subcontractor-type applicability with a configured reason', () => {
    const elec = def('elec', { subTypes: ['electrical'] });
    const e = evaluate(input({ definitions: new Map([['elec', elec]]), projectRequirements: [pr('pA', 'elec')] }));
    expect(e.results[0].status).toBe('not_applicable');
  });

  it('records a rule snapshot so historical decisions are reproducible', () => {
    const e = evaluate(input({ projectRequirements: [pr('pA', 'gl')] }));
    expect(e.ruleSnapshot.requirements[0]).toMatchObject({ requirementId: 'gl', version: 1, mandatory: true });
    expect(e.ruleSnapshot.today).toBe(TODAY);
    expect(e.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles declarations through manual confirmation with renewal dates', () => {
    const decl = def('decl', { kind: 'declaration', expiryRequired: false });
    const conf = { id: 'c', scope: 'all', subcontractorId: 's1', requirementId: 'decl', type: 'manual_confirmation' as const, reason: 'Signed', decidedBy: { uid: 'u', name: 'U' }, decidedAt: '2026-01-01T00:00:00Z' };
    const d = new Map([['decl', decl]]);
    expect(evaluate(input({ definitions: d, projectRequirements: [pr('pA', 'decl')] })).results[0].status).toBe('missing');
    expect(evaluate(input({ definitions: d, projectRequirements: [pr('pA', 'decl')], overrides: [{ ...conf, validUntil: '2027-01-01' }] })).results[0].status).toBe('approved');
    expect(evaluate(input({ definitions: d, projectRequirements: [pr('pA', 'decl')], overrides: [{ ...conf, validUntil: '2026-06-01' }] })).results[0].status).toBe('expired');
  });
});

describe('reminder scheduling', () => {
  const schedule = [90, 60, 30, 14, 7, 0, -7];
  it('sends the closest crossed threshold only once', () => {
    expect(dueReminder(100, schedule, [])).toBeNull();
    expect(dueReminder(85, schedule, [])).toEqual({ offset: 90, supersedes: [] });
    expect(dueReminder(85, schedule, [90])).toBeNull();
    expect(dueReminder(29, schedule, [90])).toEqual({ offset: 30, supersedes: [60] });
    expect(dueReminder(0, schedule, [90, 60, 30, 14, 7])).toEqual({ offset: 0, supersedes: [] });
    expect(dueReminder(-8, schedule, [90, 60, 30, 14, 7, 0])).toEqual({ offset: -7, supersedes: [] });
  });
  it('does not resend when first seen late (no flood of old reminders)', () => {
    const r = dueReminder(5, schedule, []);
    expect(r?.offset).toBe(7);
    expect(r?.supersedes).toEqual([90, 60, 30, 14]);
  });
});
