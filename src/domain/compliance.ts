import { daysBetween, formatDate, todayIn } from './dates';
import type {
  Criterion, DocumentMetadata, DocumentRecord, DocumentRequest, DocumentVersion, Evaluation, OrgSettings,
  Project, ProjectRequirement, Readiness, RequirementDefinition, RequirementOverride, RequirementResult,
  RequirementStatus, Subcontractor,
} from './types';

export interface EvalInput {
  project: Pick<Project, 'id' | 'status'>;
  subcontractor: Pick<Subcontractor, 'id' | 'status' | 'subTypes'>;
  projectRequirements: ProjectRequirement[];
  definitions: Map<string, RequirementDefinition> | Record<string, RequirementDefinition>;
  documents: DocumentRecord[];
  versions: DocumentVersion[];
  overrides: RequirementOverride[];
  requests: DocumentRequest[];
  settings: Pick<OrgSettings, 'expiringSoonDays' | 'timezone'>;
  now?: Date;
}

// Everyday labels. The engine keeps finer internal states; people see nine.
export const STATUS_LABELS: Record<RequirementStatus, string> = {
  not_requested: 'Not requested',
  missing: 'Not requested',
  requested: 'Requested',
  overdue: 'Requested — overdue',
  submitted: 'Submitted',
  awaiting_review: 'Needs review',
  review_required: 'Needs review',
  approved: 'Approved',
  rejected: 'Changes needed',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  not_applicable: 'Not applicable',
};

export const READINESS_LABELS: Record<Readiness, string> = {
  ready: 'Ready',
  action_required: 'Action required',
  not_ready: 'Not ready',
  not_evaluated: 'Not assessed yet',
};

/** What to show for readiness: when the only things in the way are submissions waiting for a decision, say "Needs review". */
export function displayReadiness(readiness: Readiness | string, results?: { status: string; blocking?: boolean; mandatory?: boolean }[]): Readiness | 'needs_review' {
  if (!results || readiness === 'ready' || readiness === 'not_evaluated') return readiness as Readiness;
  const REVIEW = ['awaiting_review', 'submitted', 'review_required'];
  const open = results.filter((r) => r.blocking || ['expiring_soon', 'rejected', 'expired', ...REVIEW].includes(r.status));
  return open.length > 0 && open.every((r) => REVIEW.includes(r.status)) ? 'needs_review' : (readiness as Readiness);
}

const OPEN_REQUEST = new Set(['sent', 'acknowledged', 'partially_fulfilled']);
const PENDING = new Set(['submitted', 'awaiting_review', 'under_review']);
const IGNORED = new Set(['uploading', 'quarantined', 'archived']);

function getDef(defs: EvalInput['definitions'], id: string): RequirementDefinition | undefined {
  return defs instanceof Map ? defs.get(id) : defs[id];
}

export function formatAmount(n: number, currency?: string): string {
  const s = n.toLocaleString('en-GB');
  return currency ? `${currency} ${s}` : s;
}

/** Checks confirmed metadata against a requirement's structured criteria. */
export function checkCriteria(criteria: Criterion[], metadata: DocumentMetadata) {
  const values = metadata.values ?? {};
  return criteria.map((c) => {
    const v = values[c.key];
    let passed: boolean | null = null;
    let detail = '';
    if (v === undefined || v === null || v === '') {
      passed = null;
      detail = 'not recorded';
    } else if (c.type === 'min_amount') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
      passed = !isNaN(n) && n >= Number(c.value ?? 0);
      detail = `document shows ${formatAmount(n, c.currency)}`;
    } else if (c.type === 'boolean') {
      passed = v === true || v === 'true' || v === 'yes';
      detail = passed ? 'confirmed' : 'not confirmed';
    } else if (c.type === 'text_present') {
      passed = String(v).trim().length > 0;
      detail = String(v);
    } else if (c.type === 'text_equals') {
      passed = String(v).trim().toLowerCase() === String(c.value ?? '').trim().toLowerCase();
      detail = `document shows "${v}"`;
    }
    return { criterion: c, passed, detail };
  });
}

export function describeCriterion(c: Criterion): string {
  if (c.type === 'min_amount') return `${c.label} at least ${formatAmount(Number(c.value ?? 0), c.currency)}`;
  if (c.type === 'boolean') return `${c.label} confirmed`;
  if (c.type === 'text_equals') return `${c.label} is "${c.value}"`;
  return `${c.label} recorded`;
}

function evaluateRequirement(
  pr: ProjectRequirement,
  def: RequirementDefinition,
  input: EvalInput,
  today: string,
): RequirementResult {
  const base = {
    requirementId: def.id,
    requirementName: def.name,
    requirementVersion: def.version,
    mandatory: pr.mandatory,
  };
  const result = (status: RequirementStatus, reason: string, blockingIfMandatory: boolean, extra: Partial<RequirementResult> = {}): RequirementResult => ({
    ...base, status, reason, blocking: pr.mandatory && blockingIfMandatory, ...extra,
  });

  // 1. Explicit not-applicable decisions (project scoped or for all projects).
  const na = input.overrides.find((o) =>
    o.type === 'not_applicable' && !o.revoked && o.requirementId === def.id &&
    o.subcontractorId === input.subcontractor.id && (o.scope === input.project.id || o.scope === 'all'));
  if (na) {
    return result('not_applicable', `Marked not applicable by ${na.decidedBy.name} on ${formatDate(na.decidedAt)}: ${na.reason}`, false);
  }

  // 2. Applicability by subcontractor type, as configured on the requirement.
  if (def.subTypes.length > 0 && !def.subTypes.some((t) => input.subcontractor.subTypes.includes(t))) {
    return result('not_applicable', `Requirement is configured to apply only to: ${def.subTypes.join(', ')}`, false);
  }

  const openRequest = input.requests
    .filter((r) => OPEN_REQUEST.has(r.status) && r.subcontractorId === input.subcontractor.id && r.requirementIds.includes(def.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const unsatisfied = (): RequirementResult => {
    if (openRequest) {
      if (openRequest.dueDate && daysBetween(today, openRequest.dueDate) < 0) {
        return result('overdue', `Requested on ${formatDate(openRequest.createdAt)}; due ${formatDate(openRequest.dueDate)} and not yet received`, true);
      }
      return result('requested', `Requested from ${openRequest.contactEmail} on ${formatDate(openRequest.createdAt)}; not yet received`, true);
    }
    return result('missing', 'Nothing submitted and no request sent yet', true);
  };

  // 3. Declarations and manual checks are satisfied by a recorded confirmation.
  if (def.kind !== 'document') {
    const conf = input.overrides
      .filter((o) => o.type === 'manual_confirmation' && !o.revoked && o.requirementId === def.id &&
        o.subcontractorId === input.subcontractor.id && (o.scope === input.project.id || o.scope === 'all'))
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
    if (!conf) return unsatisfied();
    const by = `Confirmed by ${conf.decidedBy.name} on ${formatDate(conf.decidedAt)}`;
    if (conf.validUntil) {
      const days = daysBetween(today, conf.validUntil);
      if (days < 0) return result('expired', `${by}; lapsed on ${formatDate(conf.validUntil)}`, true, { expiryDate: conf.validUntil, daysToExpiry: days });
      if (days <= input.settings.expiringSoonDays) return result('expiring_soon', `${by}; due for renewal on ${formatDate(conf.validUntil)}`, false, { expiryDate: conf.validUntil, daysToExpiry: days });
      return result('approved', `${by}; valid until ${formatDate(conf.validUntil)}`, false, { expiryDate: conf.validUntil, daysToExpiry: days });
    }
    return result('approved', by, false);
  }

  // 4. Document requirements.
  const docs = input.documents.filter((d) =>
    !d.archived && d.subcontractorId === input.subcontractor.id && d.requirementId === def.id &&
    (d.projectIds.length === 0 || d.projectIds.includes(input.project.id)));
  const docIds = new Set(docs.map((d) => d.id));
  const versions = input.versions
    .filter((v) => docIds.has(v.documentId) && !IGNORED.has(v.reviewStatus))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  const accepted = versions.filter((v) =>
    v.reviewStatus === 'approved' || (!def.reviewRequired && PENDING.has(v.reviewStatus) && v.scan.status === 'clean'));
  const current = accepted[0];
  const newerPending = versions.find((v) => PENDING.has(v.reviewStatus) && (!current || v.uploadedAt > current.uploadedAt));
  const ids = (v: DocumentVersion) => ({ documentId: v.documentId, versionId: v.id });

  if (current) {
    const pendingNote = newerPending && newerPending.id !== current.id ? '; a replacement is awaiting review' : '';
    // Re-check confirmed values against the requirement as it stands today.
    const checks = checkCriteria(def.criteria, current.metadata);
    const failed = checks.filter((c) => c.passed === false);
    if (failed.length) {
      return result('review_required',
        `No longer meets: ${failed.map((f) => `${describeCriterion(f.criterion)} (${f.detail})`).join('; ')}${pendingNote}`, true, ids(current));
    }
    const approvedUnder = current.review?.requirementVersion;
    const missingValues = checks.filter((c) => c.passed === null);
    if (approvedUnder !== undefined && approvedUnder < def.version && missingValues.length) {
      return result('review_required',
        `Requirement changed after approval (v${approvedUnder} → v${def.version}); re-review needed for ${missingValues.map((m) => m.criterion.label).join(', ')}${pendingNote}`, false, ids(current));
    }
    const expiry = current.metadata.expiryDate;
    if (!expiry) {
      if (def.expiryRequired) {
        return result('review_required', `Approved document has no expiry date recorded, but this requirement needs one${pendingNote}`, true, ids(current));
      }
      return result('approved', `${current.reviewStatus === 'approved' ? 'Approved' : 'Accepted'} ${formatDate(current.review?.at ?? current.uploadedAt)}; does not expire${pendingNote}`, false, ids(current));
    }
    const days = daysBetween(today, expiry);
    const extra = { ...ids(current), expiryDate: expiry, daysToExpiry: days };
    if (days < 0) return result('expired', `Expired on ${formatDate(expiry)}${pendingNote || '; no replacement submitted'}`, true, extra);
    if (days <= input.settings.expiringSoonDays) {
      return result('expiring_soon', `Approved, but expires on ${formatDate(expiry)} (${days} day${days === 1 ? '' : 's'})${pendingNote}`, false, extra);
    }
    return result('approved', `Approved; valid until ${formatDate(expiry)}${pendingNote}`, false, extra);
  }

  if (newerPending) {
    return result('awaiting_review', `Submitted ${formatDate(newerPending.uploadedAt)} by ${newerPending.uploadedBy.name}; awaiting review`, false, ids(newerPending));
  }
  const latest = versions[0];
  if (latest?.reviewStatus === 'info_requested') {
    return result('requested', `Reviewer requested more information: ${latest.review?.reason ?? 'see request'}`, true, ids(latest));
  }
  if (latest?.reviewStatus === 'rejected' && !openRequestNewerThan(openRequest, latest)) {
    return result('rejected', `Rejected ${formatDate(latest.review?.at)}: ${latest.review?.reason ?? 'no reason recorded'}`, true, ids(latest));
  }
  if (latest?.reviewStatus === 'rejected') {
    const r = unsatisfied();
    return { ...r, reason: `${r.reason} (previous submission rejected: ${latest.review?.reason ?? ''})`, ...ids(latest) };
  }
  return unsatisfied();
}

function openRequestNewerThan(req: DocumentRequest | undefined, v: DocumentVersion) {
  return !!req && req.createdAt > (v.review?.at ?? v.uploadedAt);
}

export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function evaluate(input: EvalInput): Evaluation {
  const now = input.now ?? new Date();
  const today = todayIn(input.settings.timezone, now);
  const active = input.projectRequirements.filter((pr) => pr.active && pr.projectId === input.project.id);
  const results: RequirementResult[] = [];
  const snapshot: Evaluation['ruleSnapshot']['requirements'] = [];

  for (const pr of active) {
    const def = getDef(input.definitions, pr.requirementId);
    if (!def) continue;
    snapshot.push({ requirementId: def.id, version: def.version, mandatory: pr.mandatory, criteria: def.criteria });
    if (!def.active) continue;
    results.push(evaluateRequirement(pr, def, input, today));
  }

  const mandatory = results.filter((r) => r.mandatory && r.status !== 'not_applicable');
  const blocking = results.filter((r) => r.blocking);
  const attention = mandatory.filter((r) => !r.blocking && ['awaiting_review', 'expiring_soon', 'review_required', 'submitted'].includes(r.status));
  const satisfiedStatuses: RequirementStatus[] = ['approved', 'expiring_soon'];

  let readiness: Readiness;
  const reasons: string[] = [];
  if (results.length === 0) {
    readiness = 'not_evaluated';
    reasons.push('No requirements are configured for this project yet.');
  } else {
    if (input.subcontractor.status === 'suspended') reasons.push('Subcontractor is suspended.');
    if (input.subcontractor.status === 'archived') reasons.push('Subcontractor is archived.');
    for (const r of blocking) reasons.push(`${r.requirementName}: ${STATUS_LABELS[r.status].toLowerCase()} — ${r.reason}`);
    for (const r of attention) reasons.push(`${r.requirementName}: ${STATUS_LABELS[r.status].toLowerCase()} — ${r.reason}`);
    if (reasons.length && (blocking.length || ['suspended', 'archived'].includes(input.subcontractor.status))) readiness = 'not_ready';
    else if (attention.length) readiness = 'action_required';
    else readiness = 'ready';
    if (readiness === 'ready') {
      reasons.push(mandatory.length
        ? `All ${mandatory.length} mandatory requirement${mandatory.length === 1 ? ' is' : 's are'} approved and in date.`
        : 'No mandatory requirements apply to this subcontractor.');
    }
  }

  const counts = {
    required: mandatory.length,
    satisfied: mandatory.filter((r) => satisfiedStatuses.includes(r.status)).length,
    missing: mandatory.filter((r) => ['missing', 'requested', 'overdue', 'rejected', 'not_requested'].includes(r.status)).length,
    expiring: results.filter((r) => r.status === 'expiring_soon').length,
    pending: results.filter((r) => r.status === 'awaiting_review').length,
  };

  const summary = readiness === 'not_evaluated'
    ? 'Not evaluated: no requirements configured.'
    : readiness === 'ready'
      ? `Ready: ${counts.satisfied} of ${counts.required} mandatory requirements satisfied.`
      : readiness === 'action_required'
        ? `Action required: ${attention.length} item${attention.length === 1 ? '' : 's'} need attention, nothing blocking.`
        : `Not ready: ${blocking.length || 0} blocking issue${blocking.length === 1 ? '' : 's'}${['suspended', 'archived'].includes(input.subcontractor.status) ? ` (subcontractor ${input.subcontractor.status})` : ''}.`;

  const hash = hashString(JSON.stringify([readiness, input.subcontractor.status, results.map((r) => [r.requirementId, r.status, r.versionId, r.expiryDate, r.mandatory])]));
  return {
    projectId: input.project.id,
    subcontractorId: input.subcontractor.id,
    readiness,
    summary,
    reasons,
    results,
    counts,
    evaluatedAt: now.toISOString(),
    ruleSnapshot: { requirements: snapshot, expiringSoonDays: input.settings.expiringSoonDays, today, timezone: input.settings.timezone },
    hash,
  };
}

/**
 * Reminder scheduling. Given days until expiry and the configured offsets
 * (e.g. [90, 60, 30, 14, 7, 0, -7]), returns which offset (if any) should send
 * now, and which earlier offsets are superseded. Never returns an offset that
 * was already sent, so retries are idempotent.
 */
export function dueReminder(daysToExpiry: number, schedule: number[], alreadySent: Iterable<number>) {
  const sent = new Set(alreadySent);
  const offsets = [...new Set(schedule)].sort((a, b) => b - a);
  const crossed = offsets.filter((o) => daysToExpiry <= o);
  if (!crossed.length) return null;
  const closest = crossed[crossed.length - 1];
  if (sent.has(closest)) return null;
  return { offset: closest, supersedes: crossed.filter((o) => o !== closest && !sent.has(o)) };
}

export function readinessRank(r: Readiness): number {
  return { not_ready: 0, action_required: 1, not_evaluated: 2, ready: 3 }[r];
}
