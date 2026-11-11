import { isISODate } from '../../src/domain/dates';
import { canSeeProject } from '../../src/domain/permissions';
import type { Assignment, Member, Project, ProjectRequirement, ProjectStatus, RequirementTemplate } from '../../src/domain/types';
import { audit, bad, C, type Ctx, diff, id, ids, need, notFound, oneOf, reqStr, requireProjectAccess, str } from '../core';
import { loadOrgData, recompute } from '../data';
import { enforceLimit } from './billing';

const STATUSES: ProjectStatus[] = ['planning', 'active', 'on_hold', 'completed', 'archived'];

async function getProject(ctx: Ctx, projectId: unknown): Promise<Project> {
  const pid = id(projectId, 'Project');
  const p = await ctx.db.get<Project>(C.doc(ctx.org.id, 'projects', pid));
  if (!p) throw notFound('Project not found');
  requireProjectAccess(ctx, p);
  return p;
}

/** PMs/project admins may only edit projects they are assigned to. */
function needProjectEdit(ctx: Ctx, p: Project) {
  need(ctx, 'projects.edit');
  if (!canSeeProject(ctx.member, p)) throw notFound('Project not found');
}

async function validateFields(ctx: Ctx, input: any, partial: boolean) {
  const out: Partial<Project> = {};
  const members = await ctx.db.list<Member>(C.col(ctx.org.id, 'members'), [['status', '==', 'active']]);
  const memberIds = new Set(members.map((m) => m.uid));
  if (!partial || input.name !== undefined) out.name = reqStr(input.name, 'Project name', 140);
  if (!partial || input.code !== undefined) out.code = str(input.code, 'Project code', { max: 40 }) ?? '';
  if (input.description !== undefined) out.description = str(input.description, 'Description', { max: 2000 }) ?? '';
  if (input.location !== undefined) out.location = str(input.location, 'Location', { max: 140 }) ?? '';
  if (input.address !== undefined) out.address = str(input.address, 'Address', { max: 300 }) ?? '';
  if (input.startDate !== undefined) { if (input.startDate && !isISODate(input.startDate)) throw bad('Start date is invalid'); out.startDate = input.startDate || undefined; }
  if (input.endDate !== undefined) { if (input.endDate && !isISODate(input.endDate)) throw bad('Expected completion date is invalid'); out.endDate = input.endDate || undefined; }
  if (input.status !== undefined) out.status = oneOf(input.status, STATUSES.filter((s) => s !== 'archived'), 'Status');
  if (input.managerUid !== undefined) {
    if (input.managerUid && !memberIds.has(input.managerUid)) throw bad('Project manager must be an active member');
    out.managerUid = input.managerUid || undefined;
  }
  if (input.adminUids !== undefined) {
    const a = ids(input.adminUids, 'Project administrators');
    if (a.some((u) => !memberIds.has(u))) throw bad('Project administrators must be active members');
    out.adminUids = a;
  }
  const s = out.startDate ?? input.__existing?.startDate; const e = out.endDate ?? input.__existing?.endDate;
  if (s && e && e < s) throw bad('Expected completion must be after the start date');
  return out;
}

export async function listProjects(ctx: Ctx) {
  const data = await loadOrgData(ctx.db, ctx.org.id, ['projects', 'assignments', 'readiness', 'projectRequirements', 'subs']);
  const projects = data.projects.filter((p) => canSeeProject(ctx.member, p));
  const members = await ctx.db.list<Member>(C.col(ctx.org.id, 'members'));
  return {
    items: projects.map((p) => {
      const assigned = data.assignments.filter((a) => a.active && a.projectId === p.id).map((a) => a.subcontractorId);
      const rd = data.readiness.filter((r) => r.projectId === p.id && assigned.includes(r.subcontractorId));
      const last = [p.updatedAt, ...rd.map((r) => r.evaluatedAt), ...data.subs.filter((x) => assigned.includes(x.id)).map((x) => x.lastActivityAt ?? '')].filter(Boolean).sort().pop();
      const m = members.find((x) => x.uid === p.managerUid);
      return {
        ...p,
        manager: m ? m.name || m.email : null,
        lastActivityAt: last,
        readyPct: rd.length ? Math.round((rd.filter((r) => r.readiness === 'ready').length / rd.length) * 100) : null,
        assigned: assigned.length,
        requirements: data.projectRequirements.filter((r) => r.projectId === p.id && r.active).length,
        ready: rd.filter((r) => r.readiness === 'ready').length,
        action: rd.filter((r) => r.readiness === 'action_required').length,
        notReady: rd.filter((r) => r.readiness === 'not_ready').length,
      };
    }).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getProjectDetail(ctx: Ctx, input: any) {
  const p = await getProject(ctx, input.projectId);
  const data = await loadOrgData(ctx.db, ctx.org.id);
  const assigned = data.assignments.filter((a) => a.active && a.projectId === p.id);
  const defs = new Map(data.requirements.map((r) => [r.id, r]));
  const subs = assigned.map((a) => {
    const s = data.subs.find((x) => x.id === a.subcontractorId);
    const r = data.readiness.find((x) => x.id === `${p.id}__${a.subcontractorId}`);
    if (!s) return null;
    const applicable = r?.results.filter((x) => x.status !== 'not_applicable') ?? [];
    const primary = s.contacts.find((c) => c.primary) ?? s.contacts[0];
    return {
      id: s.id, legalName: s.legalName, trade: s.trade, status: s.status, contact: primary ? { name: primary.name, email: primary.email } : null,
      required: applicable.filter((x) => x.mandatory).length,
      submitted: applicable.filter((x) => !['missing', 'requested', 'overdue', 'not_requested'].includes(x.status)).length,
      missing: applicable.filter((x) => x.mandatory && ['missing', 'requested', 'overdue', 'rejected'].includes(x.status)).map((x) => x.requirementName),
      expiring: applicable.filter((x) => x.status === 'expiring_soon').map((x) => ({ name: x.requirementName, date: x.expiryDate })),
      expired: applicable.filter((x) => x.status === 'expired').map((x) => x.requirementName),
      pending: applicable.filter((x) => x.status === 'awaiting_review').length,
      readiness: r?.readiness ?? 'not_evaluated', summary: r?.summary ?? 'Not evaluated yet', reasons: r?.reasons ?? [],
      results: r?.results ?? [],
      lastActivityAt: s.lastActivityAt ?? s.updatedAt, assignedAt: a.assignedAt,
    };
  }).filter(Boolean);
  const reqs = data.projectRequirements.filter((r) => r.projectId === p.id && r.active).map((r) => ({ ...r, definition: defs.get(r.requirementId) }));
  const templates = data.templates.filter((t) => t.active).map((t) => {
    const applied = p.templateRefs.find((x) => x.templateId === t.id);
    return { id: t.id, name: t.name, version: t.version, items: t.items.length, appliedVersion: applied?.version, outdated: !!applied && applied.version < t.version };
  });
  const members = await ctx.db.list<Member>(C.col(ctx.org.id, 'members'));
  const name = (uid?: string) => { const m = members.find((x) => x.uid === uid); return m ? m.name || m.email : null; };
  return {
    project: { ...p, managerName: name(p.managerUid), adminNames: p.adminUids.map(name).filter(Boolean) },
    subcontractors: subs, requirements: reqs, templates,
    counts: {
      total: subs.length,
      ready: subs.filter((s: any) => s.readiness === 'ready').length,
      awaitingReview: subs.reduce((n: number, s: any) => n + s.pending, 0),
      action: subs.filter((s: any) => s.readiness === 'action_required').length,
      notReady: subs.filter((s: any) => s.readiness === 'not_ready').length,
      notEvaluated: subs.filter((s: any) => s.readiness === 'not_evaluated').length,
      pending: subs.reduce((n: number, s: any) => n + s.pending, 0),
      expiring: subs.reduce((n: number, s: any) => n + s.expiring.length, 0),
    },
    available: data.subs.filter((s) => !['archived'].includes(s.status) && !assigned.some((a) => a.subcontractorId === s.id)).map((s) => ({ id: s.id, legalName: s.legalName, trade: s.trade })),
    allRequirements: data.requirements.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name, category: r.category, defaultMandatory: r.defaultMandatory })),
  };
}

export async function createProject(ctx: Ctx, input: any) {
  need(ctx, 'projects.create');
  await enforceLimit(ctx, 'projects');
  const fields = await validateFields(ctx, input, false);
  const now = ctx.svc.now().toISOString();
  const p: Project = {
    id: ctx.db.newId(), name: fields.name!, code: fields.code ?? '', description: fields.description ?? '', location: fields.location ?? '',
    address: fields.address ?? '', status: fields.status ?? 'planning', startDate: fields.startDate, endDate: fields.endDate,
    managerUid: fields.managerUid, adminUids: fields.adminUids ?? [], templateRefs: [], createdAt: now, updatedAt: now,
  };
  await ctx.db.set(C.doc(ctx.org.id, 'projects', p.id), p as any);
  await audit(ctx, { action: 'project.created', entity: { type: 'project', id: p.id, label: p.name }, after: p });
  if (input.templateId) await applyTemplate(ctx, { projectId: p.id, templateId: input.templateId });
  return { projectId: p.id };
}

export async function updateProject(ctx: Ctx, input: any) {
  const p = await getProject(ctx, input.projectId);
  needProjectEdit(ctx, p);
  if (p.status === 'archived') throw bad('Restore the project before editing it');
  const fields = await validateFields(ctx, { ...input, __existing: p }, true);
  const next = { ...p, ...fields, updatedAt: ctx.svc.now().toISOString() };
  const d = diff(p as any, next as any);
  if (!d.changed) return { ok: true };
  await ctx.db.set(C.doc(ctx.org.id, 'projects', p.id), next as any);
  await audit(ctx, { action: 'project.updated', entity: { type: 'project', id: p.id, label: next.name }, before: d.before, after: d.after });
  return { ok: true };
}

export async function setProjectArchived(ctx: Ctx, input: any) {
  need(ctx, 'projects.archive');
  const p = await getProject(ctx, input.projectId);
  const archive = !!input.archived;
  const status: ProjectStatus = archive ? 'archived' : 'completed';
  await ctx.db.update(C.doc(ctx.org.id, 'projects', p.id), { status, updatedAt: ctx.svc.now().toISOString() });
  await audit(ctx, { action: archive ? 'project.archived' : 'project.restored', entity: { type: 'project', id: p.id, label: p.name }, before: { status: p.status }, after: { status } });
  if (!archive) await recompute({ ...ctx }, { projectId: p.id }, 'project.restored');
  return { ok: true };
}

export async function assignSubcontractors(ctx: Ctx, input: any) {
  const p = await getProject(ctx, input.projectId);
  needProjectEdit(ctx, p);
  if (p.status === 'archived') throw bad('Archived projects cannot take new assignments');
  const subIds = ids(input.subcontractorIds, 'Subcontractors', 200);
  if (!subIds.length) throw bad('Choose at least one subcontractor');
  const now = ctx.svc.now().toISOString();
  for (const sid of subIds) {
    const s = await ctx.db.get<any>(C.doc(ctx.org.id, 'subcontractors', sid));
    if (!s) throw bad('Unknown subcontractor');
    if (s.status === 'archived') throw bad(`${s.legalName} is archived`);
    const aid = `${p.id}__${sid}`;
    const a: Assignment = { id: aid, projectId: p.id, subcontractorId: sid, active: true, assignedAt: now, assignedBy: ctx.member.uid };
    await ctx.db.set(C.doc(ctx.org.id, 'assignments', aid), a as any);
    await audit(ctx, { action: 'project.subcontractor_assigned', entity: { type: 'assignment', id: aid, label: `${s.legalName} → ${p.name}` }, refs: [p.id, sid] });
  }
  await recompute(ctx, { projectId: p.id }, 'assignment.added');
  return { ok: true };
}

export async function removeSubcontractor(ctx: Ctx, input: any) {
  const p = await getProject(ctx, input.projectId);
  needProjectEdit(ctx, p);
  const sid = id(input.subcontractorId, 'Subcontractor');
  const aid = `${p.id}__${sid}`;
  const a = await ctx.db.get<Assignment>(C.doc(ctx.org.id, 'assignments', aid));
  if (!a?.active) throw notFound('Assignment not found');
  await ctx.db.update(C.doc(ctx.org.id, 'assignments', aid), { active: false, removedAt: ctx.svc.now().toISOString() });
  await audit(ctx, { action: 'project.subcontractor_removed', entity: { type: 'assignment', id: aid }, refs: [p.id, sid] });
  return { ok: true };
}

export async function applyTemplate(ctx: Ctx, input: any) {
  const p = await getProject(ctx, input.projectId);
  need(ctx, 'requirements.manage');
  const t = await ctx.db.get<RequirementTemplate>(C.doc(ctx.org.id, 'templates', id(input.templateId, 'Template')));
  if (!t || !t.active) throw notFound('Template not found');
  const existing = await ctx.db.list<ProjectRequirement>(C.col(ctx.org.id, 'projectRequirements'), [['projectId', '==', p.id]]);
  const now = ctx.svc.now().toISOString();
  let added = 0; let updated = 0;
  for (const item of t.items) {
    const prId = `${p.id}__${item.requirementId}`;
    const cur = existing.find((e) => e.id === prId);
    const next: ProjectRequirement = {
      id: prId, projectId: p.id, requirementId: item.requirementId, mandatory: item.mandatory,
      source: { type: 'template', templateId: t.id, version: t.version }, active: true, addedAt: cur?.addedAt ?? now, addedBy: cur?.addedBy ?? ctx.member.uid,
    };
    // A manual project-level adjustment wins over a template re-application.
    if (cur?.active && cur.source.type === 'manual') continue;
    if (!cur || !cur.active) added++; else if (cur.mandatory !== next.mandatory) updated++;
    await ctx.db.set(C.doc(ctx.org.id, 'projectRequirements', prId), next as any);
  }
  const refs = p.templateRefs.filter((r) => r.templateId !== t.id).concat([{ templateId: t.id, version: t.version, appliedAt: now }]);
  await ctx.db.update(C.doc(ctx.org.id, 'projects', p.id), { templateRefs: refs, updatedAt: now });
  await audit(ctx, { action: 'project.template_applied', entity: { type: 'project', id: p.id, label: p.name }, after: { template: t.name, version: t.version, added, updated }, refs: [t.id] });
  await recompute(ctx, { projectId: p.id }, 'template.applied');
  return { added, updated };
}

export async function setProjectRequirement(ctx: Ctx, input: any) {
  const p = await getProject(ctx, input.projectId);
  need(ctx, 'requirements.manage');
  const rid = id(input.requirementId, 'Requirement');
  const def = await ctx.db.get<any>(C.doc(ctx.org.id, 'requirements', rid));
  if (!def) throw notFound('Requirement not found');
  const prId = `${p.id}__${rid}`;
  const cur = await ctx.db.get<ProjectRequirement>(C.doc(ctx.org.id, 'projectRequirements', prId));
  const now = ctx.svc.now().toISOString();
  if (input.remove) {
    if (!cur?.active) return { ok: true };
    await ctx.db.update(C.doc(ctx.org.id, 'projectRequirements', prId), { active: false });
    await audit(ctx, { action: 'project.requirement_removed', entity: { type: 'project', id: p.id, label: p.name }, before: { requirement: def.name, mandatory: cur.mandatory }, refs: [rid] });
  } else {
    const mandatory = input.mandatory === undefined ? (cur?.mandatory ?? def.defaultMandatory) : !!input.mandatory;
    const next: ProjectRequirement = { id: prId, projectId: p.id, requirementId: rid, mandatory, source: { type: 'manual' }, active: true, addedAt: cur?.addedAt ?? now, addedBy: cur?.addedBy ?? ctx.member.uid };
    await ctx.db.set(C.doc(ctx.org.id, 'projectRequirements', prId), next as any);
    await audit(ctx, { action: cur?.active ? 'project.requirement_changed' : 'project.requirement_added', entity: { type: 'project', id: p.id, label: p.name }, before: cur?.active ? { requirement: def.name, mandatory: cur.mandatory } : undefined, after: { requirement: def.name, mandatory }, refs: [rid] });
  }
  await recompute(ctx, { projectId: p.id }, 'project.requirements_changed');
  return { ok: true };
}
