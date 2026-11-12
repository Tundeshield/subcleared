// Read-only report: approved documents whose approval relied on a reading from before company and
// tax documents were told apart. Nothing is changed; a person decides whether to look again.
import { expectedKinds } from '../src/domain/extraction';
import type { DocumentVersion, Organisation, RequirementDefinition, Subcontractor } from '../src/domain/types';
import { C } from './core';
import type { Services } from './services';

export async function rereviewCandidates(svc: Services) {
  const orgs = await svc.db.list<Organisation>('orgs');
  const out: { orgId: string; org: string; subcontractor: string; requirement: string; versionId: string; readAs: string; approvedAt?: string }[] = [];
  for (const org of orgs) {
    const [versions, reqs, subs] = await Promise.all([
      svc.db.list<DocumentVersion>(C.col(org.id, 'versions'), [['reviewStatus', '==', 'approved']]),
      svc.db.list<RequirementDefinition>(C.col(org.id, 'requirements')),
      svc.db.list<Subcontractor>(C.col(org.id, 'subcontractors')),
    ]);
    const reqById = new Map(reqs.map((r) => [r.id, r]));
    const subById = new Map(subs.map((s) => [s.id, s]));
    for (const v of versions) {
      const def = v.requirementId ? reqById.get(v.requirementId) : undefined;
      if (!def || v.extraction?.kindScheme) continue;
      const want = expectedKinds(def);
      const affected = want.some((k) => k === 'company_registration' || k === 'tax_registration') && !want.includes('licence_registration');
      if (!affected) continue;
      out.push({ orgId: org.id, org: org.name, subcontractor: subById.get(v.subcontractorId)?.legalName ?? v.subcontractorId, requirement: def.name, versionId: v.id, readAs: v.extraction?.kind ?? 'not read', approvedAt: v.review?.at });
    }
  }
  return { checkedOrganisations: orgs.length, candidates: out };
}
