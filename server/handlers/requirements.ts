import { addDays, isISODate, todayIn } from '../../src/domain/dates';
import { SUB_TYPES } from '../../src/domain/library';
import type { Criterion, ProjectRequirement, RequirementDefinition, RequirementKind, RequirementOverride, RequirementTemplate, TemplateItem } from '../../src/domain/types';
import { audit, bad, C, type Ctx, diff, id, need, notFound, oneOf, reqStr, str } from '../core';
import { recompute } from '../data';
import { loadSub } from './subs';

const KINDS: RequirementKind[] = ['document', 'declaration', 'manual_check'];

function parseCriteria(raw: unknown): Criterion[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 20) throw bad('Criteria must be a list (max 20)');
  return raw.map((c: any, i) => {
    const type = oneOf(c?.type, ['min_amount', 'boolean', 'text_present', 'text_equals'] as const, `Criterion ${i + 1} type`);
    const key = reqStr(c?.key, `Criterion ${i + 1} field`, 60);
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) throw bad(`Criterion ${i + 1} field must be letters/numbers`);
    const out: Criterion = { key, label: reqStr(c?.label, `Criterion ${i + 1} label`, 120), type };
    if (type === 'min_amount') { const v = Number(c?.value); if (!isFinite(v) || v < 0) throw bad(`Criterion ${i + 1} needs a minimum amount`); out.value = v; out.currency = str(c?.currency, 'Currency', { max: 8 }); }
    if (type === 'boolean') out.value = true;
    if (type === 'text_equals') out.value = reqStr(c?.value, `Criterion ${i + 1} value`, 200);
    return out;
  });
}

function parseDef(input: any, partial: boolean): Partial<RequirementDefinition> {
  const o: Partial<RequirementDefinition> = {};
  if (!partial || input.name !== undefined) o.name = reqStr(input.name, 'Name', 140);
  if (input.description !== undefined || !partial) o.description = str(input.description, 'Description', { max: 2000 }) ?? '';
  if (input.category !== undefined || !partial) o.category = str(input.category, 'Category', { max: 60 }) ?? 'General';
  if (input.kind !== undefined || !partial) o.kind = oneOf(input.kind ?? 'document', KINDS, 'Requirement type');
  if (input.jurisdiction !== undefined) o.jurisdiction = str(input.jurisdiction, 'Jurisdiction', { max: 80 });
  if (input.subTypes !== undefined || !partial) o.subTypes = Array.isArray(input.subTypes) ? input.subTypes.filter((t: any) => SUB_TYPES.includes(t)) : [];
  if (input.defaultMandatory !== undefined || !partial) o.defaultMandatory = input.defaultMandatory !== false;
  if (input.documentType !== undefined) o.documentType = str(input.documentType, 'Document type', { max: 80 });
  if (input.expiryRequired !== undefined || !partial) o.expiryRequired = !!input.expiryRequired;
  if (input.renewal !== undefined || !partial) o.renewal = oneOf(input.renewal ?? 'none', ['none', 'on_expiry', 'annual', 'periodic'] as const, 'Renewal behaviour');
  if (input.renewalPeriodDays !== undefined) { const n = Number(input.renewalPeriodDays); o.renewalPeriodDays = input.renewalPeriodDays === null || input.renewalPeriodDays === '' ? undefined : (Number.isInteger(n) && n > 0 && n <= 3650 ? n : (() => { throw bad('Renewal period must be 1–3650 days'); })()); }
  if (input.reviewRequired !== undefined || !partial) o.reviewRequired = input.reviewRequired !== false;
  if (input.criteria !== undefined || !partial) o.criteria = parseCriteria(input.criteria);
  if (input.instructions !== undefined) o.instructions = str(input.instructions, 'Instructions', { max: 2000 });
  return o;
}

export async function listRequirements(ctx: Ctx) {
  const [reqs, templates, prs] = await Promise.all([
    ctx.db.list<RequirementDefinition>(C.col(ctx.org.id, 'requirements')),
    ctx.db.list<RequirementTemplate>(C.col(ctx.org.id, 'templates')),
    ctx.db.list<ProjectRequirement>(C.col(ctx.org.id, 'projectRequirements')),
  ]);
  return {
    requirements: reqs.map((r) => ({ ...r, projects: new Set(prs.filter((p) => p.active && p.requirementId === r.id).map((p) => p.projectId)).size })).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    templates: templates.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function requirementHistory(ctx: Ctx, input: any) {
  const rid = id(input.requirementId, 'Requirement');
  const versions = (await ctx.db.list<any>(C.col(ctx.org.id, 'requirementVersions'), [['requirementId', '==', rid]])).sort((a, b) => b.version - a.version);
  return { versions };
}

export async function createRequirement(ctx: Ctx, input: any) {
  need(ctx, 'requirements.manage');
  const f = parseDef(input, false);
  const now = ctx.svc.now().toISOString();
  const def: RequirementDefinition = { ...(f as any), id: ctx.db.newId(), active: true, version: 1, createdAt: now, updatedAt: now };
  await ctx.db.set(C.doc(ctx.org.id, 'requirements', def.id), def as any);
  await ctx.db.set(C.doc(ctx.org.id, 'requirementVersions', `${def.id}@1`), { ...def, requirementId: def.id, changedBy: ctx.member.name } as any);
  await audit(ctx, { action: 'requirement.created', entity: { type: 'requirement', id: def.id, label: def.name }, after: def });
  return { requirementId: def.id };
}

/** Every material change creates a new version; earlier evaluations keep the version they used. */
export async function updateRequirement(ctx: Ctx, input: any) {
  need(ctx, 'requirements.manage');
  const rid = id(input.requirementId, 'Requirement');
  const cur = await ctx.db.get<RequirementDefinition>(C.doc(ctx.org.id, 'requirements', rid));
  if (!cur) throw notFound('Requirement not found');
  const f = parseDef(input, true);
  if (input.active !== undefined) f.active = !!input.active;
  const next = { ...cur, ...f };
  const d = diff(cur as any, next as any);
  if (!d.changed) return { version: cur.version };
  next.version = cur.version + 1;
  next.updatedAt = ctx.svc.now().toISOString();
  await ctx.db.set(C.doc(ctx.org.id, 'requirements', rid), next as any);
  await ctx.db.set(C.doc(ctx.org.id, 'requirementVersions', `${rid}@${next.version}`), { ...next, requirementId: rid, changedBy: ctx.member.name } as any);
  await audit(ctx, { action: 'requirement.changed', entity: { type: 'requirement', id: rid, label: next.name }, before: { ...d.before, version: cur.version }, after: { ...d.after, version: next.version } });
  await recompute(ctx, {}, 'requirement.changed');
  return { version: next.version };
}

function parseItems(raw: unknown, validIds: Set<string>): TemplateItem[] {
  if (!Array.isArray(raw) || raw.length > 80) throw bad('Template items must be a list (max 80)');
  const seen = new Set<string>();
  return raw.map((it: any) => {
    const rid = id(it?.requirementId, 'Requirement');
    if (!validIds.has(rid)) throw bad('Template references an unknown requirement');
    if (seen.has(rid)) throw bad('A requirement appears twice in the template');
    seen.add(rid);
    return { requirementId: rid, mandatory: it?.mandatory !== false };
  });
}

export async function saveTemplate(ctx: Ctx, input: any) {
  need(ctx, 'requirements.manage');
  const reqs = await ctx.db.list<RequirementDefinition>(C.col(ctx.org.id, 'requirements'));
  const valid = new Set(reqs.map((r) => r.id));
  const now = ctx.svc.now().toISOString();
  if (!input.templateId) {
    const t: RequirementTemplate = {
      id: ctx.db.newId(), name: reqStr(input.name, 'Template name', 120), description: str(input.description, 'Description', { max: 1000 }) ?? '',
      items: parseItems(input.items ?? [], valid), version: 1, active: true, createdAt: now, updatedAt: now,
    };
    await ctx.db.set(C.doc(ctx.org.id, 'templates', t.id), t as any);
    await ctx.db.set(C.doc(ctx.org.id, 'templateVersions', `${t.id}@1`), { ...t, templateId: t.id } as any);
    await audit(ctx, { action: 'template.created', entity: { type: 'template', id: t.id, label: t.name }, after: t });
    return { templateId: t.id, version: 1 };
  }
  const tid = id(input.templateId, 'Template');
  const cur = await ctx.db.get<RequirementTemplate>(C.doc(ctx.org.id, 'templates', tid));
  if (!cur) throw notFound('Template not found');
  const next: RequirementTemplate = {
    ...cur,
    name: input.name !== undefined ? reqStr(input.name, 'Template name', 120) : cur.name,
    description: input.description !== undefined ? str(input.description, 'Description', { max: 1000 }) ?? '' : cur.description,
    items: input.items !== undefined ? parseItems(input.items, valid) : cur.items,
    active: input.active !== undefined ? !!input.active : cur.active,
  };
  const d = diff(cur as any, next as any);
  if (!d.changed) return { templateId: tid, version: cur.version };
  // Projects keep the version they applied until someone re-applies the template.
  next.version = cur.version + 1;
  next.updatedAt = now;
  await ctx.db.set(C.doc(ctx.org.id, 'templates', tid), next as any);
  await ctx.db.set(C.doc(ctx.org.id, 'templateVersions', `${tid}@${next.version}`), { ...next, templateId: tid } as any);
  await audit(ctx, { action: 'template.changed', entity: { type: 'template', id: tid, label: next.name }, before: { ...d.before, version: cur.version }, after: { ...d.after, version: next.version } });
  return { templateId: tid, version: next.version };
}

// --- Per-subcontractor decisions -------------------------------------------------

export async function setOverride(ctx: Ctx, input: any) {
  const type = oneOf(input.type, ['not_applicable', 'manual_confirmation'] as const, 'Decision type');
  need(ctx, type === 'not_applicable' ? 'requirements.override' : 'documents.review');
  const s = await loadSub(ctx, input.subcontractorId);
  const rid = id(input.requirementId, 'Requirement');
  const def = await ctx.db.get<RequirementDefinition>(C.doc(ctx.org.id, 'requirements', rid));
  if (!def) throw notFound('Requirement not found');
  const scope = input.projectId ? id(input.projectId, 'Project') : 'all';
  const reason = reqStr(input.reason, type === 'not_applicable' ? 'Reason' : 'Confirmation note', 1000);
  if (type === 'manual_confirmation' && def.kind === 'document') throw bad('Document requirements are satisfied by an approved document, not a manual confirmation');
  let validUntil: string | undefined;
  if (input.validUntil) { if (!isISODate(input.validUntil)) throw bad('Valid-until date is invalid'); validUntil = input.validUntil; }
  else if (type === 'manual_confirmation' && def.renewalPeriodDays) validUntil = addDays(todayIn(ctx.org.settings.timezone, ctx.svc.now()), def.renewalPeriodDays);
  const oid = `${scope}__${s.id}__${rid}__${type}`;
  const o: RequirementOverride = {
    id: oid, scope, subcontractorId: s.id, requirementId: rid, type, reason, validUntil,
    decidedBy: { uid: ctx.member.uid, name: ctx.member.name }, decidedAt: ctx.svc.now().toISOString(),
  };
  const prev = await ctx.db.get<RequirementOverride>(C.doc(ctx.org.id, 'overrides', oid));
  await ctx.db.set(C.doc(ctx.org.id, 'overrides', oid), o as any);
  await audit(ctx, {
    action: type === 'not_applicable' ? 'requirement.marked_not_applicable' : 'requirement.manually_confirmed',
    entity: { type: 'subcontractor', id: s.id, label: s.legalName }, before: prev && !prev.revoked ? prev : undefined,
    after: { requirement: def.name, scope, reason, validUntil }, refs: [rid, ...(scope !== 'all' ? [scope] : [])],
  });
  await recompute(ctx, { subcontractorId: s.id }, `override.${type}`);
  return { ok: true };
}

export async function revokeOverride(ctx: Ctx, input: any) {
  const oid = id(input.overrideId, 'Decision');
  const o = await ctx.db.get<RequirementOverride>(C.doc(ctx.org.id, 'overrides', oid));
  if (!o || o.revoked) throw notFound('Decision not found');
  need(ctx, o.type === 'not_applicable' ? 'requirements.override' : 'documents.review');
  await loadSub(ctx, o.subcontractorId);
  await ctx.db.update(C.doc(ctx.org.id, 'overrides', oid), { revoked: true });
  await audit(ctx, { action: 'requirement.decision_revoked', entity: { type: 'subcontractor', id: o.subcontractorId }, before: o, refs: [o.requirementId] });
  await recompute(ctx, { subcontractorId: o.subcontractorId }, 'override.revoked');
  return { ok: true };
}
