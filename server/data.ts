import { evaluate } from '../src/domain/compliance';
import type {
  Assignment, DocumentRecord, DocumentRequest, DocumentVersion, Evaluation, Member, Organisation, Project, ProjectRequirement,
  RequirementDefinition, RequirementOverride, RequirementTemplate, Subcontractor,
} from '../src/domain/types';
import { audit, C, membersWith, notifyMembers } from './core';
import type { Db } from './db';
import type { Services } from './services';

export interface OrgData {
  projects: Project[];
  subs: Subcontractor[];
  requirements: RequirementDefinition[];
  templates: RequirementTemplate[];
  projectRequirements: ProjectRequirement[];
  assignments: Assignment[];
  overrides: RequirementOverride[];
  documents: DocumentRecord[];
  versions: DocumentVersion[];
  requests: DocumentRequest[];
  readiness: (Evaluation & { id: string })[];
}

export async function loadOrgData(db: Db, orgId: string, only?: (keyof OrgData)[]): Promise<OrgData> {
  const want = (k: keyof OrgData) => !only || only.includes(k);
  const l = <T>(k: keyof OrgData, name: string) => (want(k) ? db.list<T>(C.col(orgId, name)) : Promise.resolve([] as T[]));
  const [projects, subs, requirements, templates, projectRequirements, assignments, overrides, documents, versions, requests, readiness] = await Promise.all([
    l<Project>('projects', 'projects'), l<Subcontractor>('subs', 'subcontractors'), l<RequirementDefinition>('requirements', 'requirements'),
    l<RequirementTemplate>('templates', 'templates'), l<ProjectRequirement>('projectRequirements', 'projectRequirements'),
    l<Assignment>('assignments', 'assignments'), l<RequirementOverride>('overrides', 'overrides'), l<DocumentRecord>('documents', 'documents'),
    l<DocumentVersion>('versions', 'versions'), l<DocumentRequest>('requests', 'requests'), l<Evaluation & { id: string }>('readiness', 'readiness'),
  ]);
  return { projects, subs, requirements, templates, projectRequirements, assignments, overrides, documents, versions, requests, readiness };
}

export function evaluatePair(org: Organisation, data: OrgData, project: Project, sub: Subcontractor, now: Date): Evaluation {
  return evaluate({
    project, subcontractor: sub,
    projectRequirements: data.projectRequirements.filter((p) => p.projectId === project.id),
    definitions: new Map(data.requirements.map((r) => [r.id, r])),
    documents: data.documents.filter((d) => d.subcontractorId === sub.id),
    versions: data.versions.filter((v) => v.subcontractorId === sub.id),
    overrides: data.overrides.filter((o) => o.subcontractorId === sub.id),
    requests: data.requests.filter((r) => r.subcontractorId === sub.id),
    settings: org.settings, now,
  });
}

/**
 * Recomputes readiness for affected project/subcontractor pairs. Writes the
 * current state to `readiness/` and appends an immutable snapshot to
 * `evaluations/` whenever the outcome changes, so every historical decision
 * stays reproducible with the rules that produced it.
 */
export async function recompute(
  ctx: { db: Db; svc: Services; org: Organisation; member?: Member },
  scope: { projectId?: string; subcontractorId?: string },
  trigger: string,
  source: 'web' | 'portal' | 'scheduler' | 'webhook' | 'import' = 'web',
) {
  const data = await loadOrgData(ctx.db, ctx.org.id);
  const now = ctx.svc.now();
  const pairs = data.assignments.filter((a) => a.active &&
    (!scope.projectId || a.projectId === scope.projectId) && (!scope.subcontractorId || a.subcontractorId === scope.subcontractorId));
  const changes: { project: Project; sub: Subcontractor; from?: string; to: string; ev: Evaluation }[] = [];
  const projectsById = new Map(data.projects.map((p) => [p.id, p]));
  const subsById = new Map(data.subs.map((s) => [s.id, s]));
  const prevById = new Map(data.readiness.map((r) => [r.id, r]));

  for (const a of pairs) {
    const project = projectsById.get(a.projectId);
    const sub = subsById.get(a.subcontractorId);
    if (!project || !sub) continue;
    if (project.status === 'archived') continue; // archived projects keep their final recorded state
    const ev = evaluatePair(ctx.org, data, project, sub, now);
    const rid = `${project.id}__${sub.id}`;
    const prev = prevById.get(rid);
    if (prev && prev.hash === ev.hash) continue;
    await ctx.db.set(C.doc(ctx.org.id, 'readiness', rid), { id: rid, ...ev } as any);
    const evId = ctx.db.newId();
    await ctx.db.create(C.doc(ctx.org.id, 'evaluations', evId), { id: evId, ...ev, trigger, previousReadiness: prev?.readiness ?? null } as any);
    if (!prev || prev.readiness !== ev.readiness) changes.push({ project, sub, from: prev?.readiness, to: ev.readiness, ev });
  }

  for (const c of changes) {
    await audit({ ...ctx, source }, {
      action: 'compliance.status_changed',
      entity: { type: 'readiness', id: `${c.project.id}__${c.sub.id}`, label: `${c.sub.legalName} on ${c.project.name}` },
      before: { readiness: c.from ?? 'none' }, after: { readiness: c.to, summary: c.ev.summary, trigger },
      actor: { type: 'system', id: 'compliance-engine', name: 'Compliance engine' }, refs: [c.project.id, c.sub.id],
    });
    if (c.to === 'not_ready' && c.from && c.from !== 'not_ready') {
      const recipients = [c.project.managerUid, ...c.project.adminUids, c.sub.ownerUid].filter(Boolean) as string[];
      const cms = (await membersWith(ctx, 'requirements.manage')).map((m) => m.uid);
      await notifyMembers(ctx, [...recipients, ...cms], {
        type: 'became_non_compliant', title: `${c.sub.legalName} is no longer ready for ${c.project.name}`,
        body: c.ev.reasons.slice(0, 3).join('\n'), link: `/app/projects/${c.project.id}`,
        dedupeKey: `nc:${c.project.id}:${c.sub.id}:${c.ev.hash}`,
      });
    }
  }

  // Keep the directory-level status in step with project readiness.
  const affectedSubs = new Set(pairs.map((p) => p.subcontractorId));
  for (const sid of affectedSubs) {
    const sub = subsById.get(sid);
    if (!sub || !['active', 'attention', 'onboarding'].includes(sub.status)) continue;
    const results = data.assignments.filter((a) => a.active && a.subcontractorId === sid).map((a) => {
      const fresh = changes.find((c) => c.sub.id === sid && c.project.id === a.projectId);
      return fresh?.to ?? prevById.get(`${a.projectId}__${sid}`)?.readiness;
    }).filter(Boolean) as string[];
    let next = sub.status;
    if (results.some((r) => r === 'not_ready' || r === 'action_required')) next = sub.status === 'onboarding' ? 'onboarding' : 'attention';
    else if (results.length && results.every((r) => r === 'ready' || r === 'not_evaluated')) next = 'active';
    if (next !== sub.status) {
      await ctx.db.update(C.doc(ctx.org.id, 'subcontractors', sid), { status: next, updatedAt: now.toISOString() });
      await audit({ ...ctx, source }, {
        action: 'subcontractor.status_changed', entity: { type: 'subcontractor', id: sid, label: sub.legalName },
        before: { status: sub.status }, after: { status: next }, actor: { type: 'system', id: 'compliance-engine', name: 'Compliance engine' },
      });
    }
  }
  return { evaluated: pairs.length, changed: changes.length };
}
