import { READINESS_LABELS, readinessRank, STATUS_LABELS } from '../../src/domain/compliance';
import { daysBetween, todayIn } from '../../src/domain/dates';
import { canSeeProject } from '../../src/domain/permissions';
import { bad, C, type Ctx, need, oneOf } from '../core';
import { loadOrgData } from '../data';
import { visibleSubIds } from './subs';

export const REPORT_TYPES = [
  'subcontractor_compliance', 'project_readiness', 'missing_documents', 'expiring_documents', 'expired_documents', 'rejected_documents',
  'pending_review', 'renewal_activity', 'onboarding', 'historical_compliance', 'audit_trail',
] as const;

export async function runReport(ctx: Ctx, input: any) {
  need(ctx, 'reports.view');
  const type = oneOf(input.type, REPORT_TYPES, 'Report');
  const f = input.filters ?? {};
  if (type === 'audit_trail') need(ctx, 'audit.view');
  const data = await loadOrgData(ctx.db, ctx.org.id);
  const today = todayIn(ctx.org.settings.timezone, ctx.svc.now());
  const visible = visibleSubIds(ctx, data);
  const projects = new Map(data.projects.filter((p) => canSeeProject(ctx.member, p)).map((p) => [p.id, p]));
  const subs = new Map(data.subs.filter((s) => !visible || visible.has(s.id)).map((s) => [s.id, s]));
  const defs = new Map(data.requirements.map((r) => [r.id, r]));
  const docs = new Map(data.documents.map((d) => [d.id, d]));
  const inDate = (iso?: string) => (!f.from || (iso ?? '') >= f.from) && (!f.to || (iso ?? '').slice(0, 10) <= f.to);
  const subOk = (sid: string) => {
    const s = subs.get(sid);
    if (!s) return false;
    if (f.subcontractorId && sid !== f.subcontractorId) return false;
    if (f.trade && !s.trade.toLowerCase().includes(String(f.trade).toLowerCase())) return false;
    if (f.jurisdiction && !(s.jurisdiction ?? '').toLowerCase().includes(String(f.jurisdiction).toLowerCase())) return false;
    if (f.projectId && !data.assignments.some((a) => a.active && a.projectId === f.projectId && a.subcontractorId === sid)) return false;
    return true;
  };
  const activeReadiness = data.readiness.filter((r) => projects.has(r.projectId) && subOk(r.subcontractorId) && (!f.projectId || r.projectId === f.projectId) &&
    data.assignments.some((a) => a.active && a.projectId === r.projectId && a.subcontractorId === r.subcontractorId));
  const subName = (id: string) => subs.get(id)?.legalName ?? '';
  const projName = (id: string) => projects.get(id)?.name ?? '';
  let columns: { key: string; label: string }[] = [];
  let rows: Record<string, any>[] = [];
  let title = '';

  const approvedWithExpiry = () => data.documents.filter((d) => !d.archived && d.approvedVersionId && subOk(d.subcontractorId)).map((d) => {
    const v = data.versions.find((x) => x.id === d.approvedVersionId);
    return v?.metadata.expiryDate ? { d, v, days: daysBetween(today, v.metadata.expiryDate) } : null;
  }).filter(Boolean).filter((x) => !f.documentType || x!.v.metadata.documentType === f.documentType || x!.d.documentType === f.documentType) as { d: any; v: any; days: number }[];

  switch (type) {
    case 'subcontractor_compliance': {
      title = 'Subcontractor compliance';
      columns = [{ key: 'company', label: 'Company' }, { key: 'trade', label: 'Trade' }, { key: 'jurisdiction', label: 'Jurisdiction' }, { key: 'projects', label: 'Projects' }, { key: 'readiness', label: 'Worst readiness' }, { key: 'outstanding', label: 'Blocking issues' }, { key: 'expiring', label: 'Expiring' }, { key: 'status', label: 'Directory status' }];
      rows = [...subs.values()].filter((s) => subOk(s.id)).map((s) => {
        const rs = activeReadiness.filter((r) => r.subcontractorId === s.id);
        const worst = rs.reduce<string | null>((w, r) => (!w || readinessRank(r.readiness) < readinessRank(w as any) ? r.readiness : w), null) ?? 'not_evaluated';
        return { company: s.legalName, trade: s.trade, jurisdiction: s.jurisdiction ?? '', projects: rs.map((r) => projName(r.projectId)).join('; '), readiness: READINESS_LABELS[worst as keyof typeof READINESS_LABELS], _readiness: worst, outstanding: rs.reduce((n, r) => n + r.results.filter((x) => x.blocking).length, 0), expiring: rs.reduce((n, r) => n + r.results.filter((x) => x.status === 'expiring_soon').length, 0), status: s.status };
      }).filter((r) => !f.status || r._readiness === f.status);
      break;
    }
    case 'project_readiness': {
      title = 'Project readiness';
      columns = [{ key: 'project', label: 'Project' }, { key: 'company', label: 'Subcontractor' }, { key: 'trade', label: 'Trade' }, { key: 'readiness', label: 'Readiness' }, { key: 'satisfied', label: 'Mandatory satisfied' }, { key: 'issues', label: 'Outstanding issues' }, { key: 'evaluatedAt', label: 'Evaluated' }];
      rows = activeReadiness.filter((r) => !f.status || r.readiness === f.status).map((r) => ({
        project: projName(r.projectId), company: subName(r.subcontractorId), trade: subs.get(r.subcontractorId)?.trade, readiness: READINESS_LABELS[r.readiness], _readiness: r.readiness,
        satisfied: `${r.counts.satisfied}/${r.counts.required}`, issues: r.reasons.filter(() => r.readiness !== 'ready').join(' | ') || '—', evaluatedAt: r.evaluatedAt.slice(0, 10),
      })).sort((a, b) => a.project.localeCompare(b.project) || readinessRank(a._readiness) - readinessRank(b._readiness));
      break;
    }
    case 'missing_documents': {
      title = 'Missing mandatory documents';
      columns = [{ key: 'company', label: 'Subcontractor' }, { key: 'project', label: 'Project' }, { key: 'requirement', label: 'Requirement' }, { key: 'status', label: 'Status' }, { key: 'detail', label: 'Detail' }];
      rows = activeReadiness.flatMap((r) => r.results.filter((x) => x.mandatory && ['missing', 'requested', 'overdue', 'rejected', 'not_requested'].includes(x.status)).map((x) => ({ company: subName(r.subcontractorId), project: projName(r.projectId), requirement: x.requirementName, status: STATUS_LABELS[x.status], detail: x.reason })));
      break;
    }
    case 'expiring_documents': {
      const days = Math.min(Number(f.days) || 60, 365);
      title = `Documents expiring within ${days} days`;
      columns = [{ key: 'company', label: 'Subcontractor' }, { key: 'document', label: 'Document' }, { key: 'issuer', label: 'Issuer' }, { key: 'reference', label: 'Reference' }, { key: 'expiry', label: 'Expiry date' }, { key: 'days', label: 'Days left' }];
      rows = approvedWithExpiry().filter((x) => x.days >= 0 && x.days <= days).sort((a, b) => a.days - b.days).map((x) => ({ company: subName(x.d.subcontractorId), document: x.d.title, issuer: x.v.metadata.issuer ?? '', reference: x.v.metadata.referenceNumber ?? '', expiry: x.v.metadata.expiryDate, days: x.days }));
      break;
    }
    case 'expired_documents': {
      title = 'Expired documents in force';
      columns = [{ key: 'company', label: 'Subcontractor' }, { key: 'document', label: 'Document' }, { key: 'expiry', label: 'Expired on' }, { key: 'days', label: 'Days overdue' }, { key: 'replacement', label: 'Replacement' }];
      rows = approvedWithExpiry().filter((x) => x.days < 0).sort((a, b) => a.days - b.days).map((x) => {
        const repl = data.versions.find((v) => v.documentId === x.d.id && v.uploadedAt > x.v.uploadedAt && ['awaiting_review', 'under_review', 'submitted'].includes(v.reviewStatus));
        return { company: subName(x.d.subcontractorId), document: x.d.title, expiry: x.v.metadata.expiryDate, days: -x.days, replacement: repl ? 'Awaiting review' : 'None received' };
      });
      break;
    }
    case 'rejected_documents': {
      title = 'Rejected documents';
      columns = [{ key: 'date', label: 'Rejected' }, { key: 'company', label: 'Subcontractor' }, { key: 'document', label: 'Document' }, { key: 'file', label: 'File' }, { key: 'reason', label: 'Reason' }, { key: 'reviewer', label: 'Reviewer' }];
      rows = data.versions.filter((v) => (v.reviewStatus === 'rejected' || v.review?.decision === 'rejected') && subOk(v.subcontractorId) && inDate(v.review?.at)).map((v) => ({ date: v.review?.at.slice(0, 10), company: subName(v.subcontractorId), document: docs.get(v.documentId)?.title, file: v.fileName, reason: v.review?.reason, reviewer: v.review?.reviewerName })).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
      break;
    }
    case 'pending_review': {
      title = 'Documents awaiting review';
      columns = [{ key: 'submitted', label: 'Submitted' }, { key: 'company', label: 'Subcontractor' }, { key: 'document', label: 'Document' }, { key: 'file', label: 'File' }, { key: 'by', label: 'Submitted by' }, { key: 'age', label: 'Waiting (days)' }];
      rows = data.versions.filter((v) => ['submitted', 'awaiting_review', 'under_review'].includes(v.reviewStatus) && subOk(v.subcontractorId)).map((v) => ({ submitted: v.uploadedAt.slice(0, 10), company: subName(v.subcontractorId), document: docs.get(v.documentId)?.title, file: v.fileName, by: v.uploadedBy.name, age: daysBetween(v.uploadedAt.slice(0, 10), today) })).sort((a, b) => b.age - a.age);
      break;
    }
    case 'renewal_activity': {
      title = 'Renewal activity';
      columns = [{ key: 'sent', label: 'Requested' }, { key: 'company', label: 'Subcontractor' }, { key: 'requirement', label: 'Requirement' }, { key: 'contact', label: 'Contact' }, { key: 'status', label: 'Status' }, { key: 'acknowledged', label: 'Acknowledged' }, { key: 'fulfilled', label: 'Fulfilled' }];
      rows = data.requests.filter((r) => r.type === 'renewal' && subOk(r.subcontractorId) && inDate(r.createdAt)).map((r) => ({ sent: r.createdAt.slice(0, 10), company: subName(r.subcontractorId), requirement: r.requirementIds.map((x) => defs.get(x)?.name).join(', '), contact: r.contactEmail, status: r.status.replace('_', ' '), acknowledged: r.acknowledgedAt?.slice(0, 10) ?? '', fulfilled: r.fulfilledAt?.slice(0, 10) ?? '' })).sort((a, b) => b.sent.localeCompare(a.sent));
      break;
    }
    case 'onboarding': {
      title = 'Subcontractor onboarding';
      columns = [{ key: 'company', label: 'Subcontractor' }, { key: 'trade', label: 'Trade' }, { key: 'onboarded', label: 'Onboarding date' }, { key: 'days', label: 'Days since' }, { key: 'status', label: 'Status' }, { key: 'progress', label: 'Mandatory satisfied' }, { key: 'contacts', label: 'Contacts' }];
      rows = [...subs.values()].filter((s) => subOk(s.id) && inDate(s.createdAt)).map((s) => {
        const rs = activeReadiness.filter((r) => r.subcontractorId === s.id);
        const req = rs.reduce((n, r) => n + r.counts.required, 0); const sat = rs.reduce((n, r) => n + r.counts.satisfied, 0);
        return { company: s.legalName, trade: s.trade, onboarded: s.onboardingDate ?? s.createdAt.slice(0, 10), days: daysBetween(s.onboardingDate ?? s.createdAt.slice(0, 10), today), status: s.status, progress: req ? `${sat}/${req}` : 'No requirements', contacts: s.contacts.length };
      }).filter((r) => !f.status || r.status === f.status);
      break;
    }
    case 'historical_compliance': {
      title = 'Historical compliance decisions';
      const evals = await ctx.db.list<any>(C.col(ctx.org.id, 'evaluations'));
      columns = [{ key: 'at', label: 'Evaluated' }, { key: 'project', label: 'Project' }, { key: 'company', label: 'Subcontractor' }, { key: 'from', label: 'Previous' }, { key: 'to', label: 'Readiness' }, { key: 'trigger', label: 'Trigger' }, { key: 'rules', label: 'Rule versions' }, { key: 'summary', label: 'Summary' }];
      rows = evals.filter((e) => projects.has(e.projectId) && subOk(e.subcontractorId) && (!f.projectId || e.projectId === f.projectId) && inDate(e.evaluatedAt) && (!f.status || e.readiness === f.status))
        .sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt)).slice(0, 5000)
        .map((e) => ({ at: e.evaluatedAt.replace('T', ' ').slice(0, 16), project: projName(e.projectId), company: subName(e.subcontractorId), from: e.previousReadiness ? READINESS_LABELS[e.previousReadiness as keyof typeof READINESS_LABELS] : '—', to: READINESS_LABELS[e.readiness as keyof typeof READINESS_LABELS], trigger: e.trigger, rules: e.ruleSnapshot.requirements.map((r: any) => `${defs.get(r.requirementId)?.name ?? r.requirementId} v${r.version}${r.mandatory ? '' : ' (optional)'}`).join('; '), summary: e.summary }));
      break;
    }
    case 'audit_trail': {
      title = 'Audit trail';
      const events = await ctx.db.list<any>(C.col(ctx.org.id, 'audit'));
      columns = [{ key: 'at', label: 'Time (UTC)' }, { key: 'actor', label: 'Actor' }, { key: 'action', label: 'Action' }, { key: 'entity', label: 'Record' }, { key: 'source', label: 'Source' }, { key: 'change', label: 'Change' }];
      rows = events.filter((e) => inDate(e.at) && (!f.subcontractorId || e.refs?.includes(f.subcontractorId)) && (!f.projectId || e.refs?.includes(f.projectId)))
        .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10000)
        .map((e) => ({ at: e.at.replace('T', ' ').slice(0, 19), actor: `${e.actor.name} (${e.actor.type})`, action: e.action, entity: e.entity.label ?? `${e.entity.type} ${e.entity.id}`, source: e.source, change: e.after ? JSON.stringify(e.after).slice(0, 300) : '' }));
      break;
    }
    default: throw bad('Unknown report');
  }
  rows = rows.map(({ _readiness, ...r }) => r);
  const filterSummary = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}: ${k === 'projectId' ? projName(String(v)) : k === 'subcontractorId' ? subName(String(v)) : v}`);
  return { type, title, columns, rows, generatedAt: ctx.svc.now().toISOString(), generatedBy: ctx.member.name, organisation: ctx.org.name, filters: filterSummary, today };
}

/** Matrix view for the Compliance screen. */
export async function complianceOverview(ctx: Ctx, input: any) {
  const data = await loadOrgData(ctx.db, ctx.org.id);
  const visible = visibleSubIds(ctx, data);
  const projects = data.projects.filter((p) => p.status !== 'archived' && canSeeProject(ctx.member, p)).sort((a, b) => a.name.localeCompare(b.name));
  const pids = new Set(projects.map((p) => p.id));
  const assignments = data.assignments.filter((a) => a.active && pids.has(a.projectId) && (!visible || visible.has(a.subcontractorId)));
  const subIds = [...new Set(assignments.map((a) => a.subcontractorId))];
  const subs = data.subs.filter((s) => subIds.includes(s.id)).sort((a, b) => a.legalName.localeCompare(b.legalName));
  const cells: Record<string, any> = {};
  for (const a of assignments) {
    const r = data.readiness.find((x) => x.id === `${a.projectId}__${a.subcontractorId}`);
    cells[`${a.projectId}__${a.subcontractorId}`] = r ? { readiness: r.readiness, summary: r.summary, blocking: r.results.filter((x) => x.blocking).map((x) => `${x.requirementName}: ${STATUS_LABELS[x.status]}`), attention: r.results.filter((x) => !x.blocking && ['expiring_soon', 'awaiting_review', 'review_required'].includes(x.status)).map((x) => `${x.requirementName}: ${STATUS_LABELS[x.status]}`), evaluatedAt: r.evaluatedAt } : { readiness: 'not_evaluated', summary: 'Not evaluated', blocking: [], attention: [] };
  }
  return {
    projects: projects.map((p) => ({ id: p.id, name: p.name, code: p.code })),
    subcontractors: subs.map((s) => ({ id: s.id, legalName: s.legalName, trade: s.trade, status: s.status })),
    cells,
    rule: { expiringSoonDays: ctx.org.settings.expiringSoonDays },
  };
}

export async function evaluationHistory(ctx: Ctx, input: any) {
  const all = await ctx.db.list<any>(C.col(ctx.org.id, 'evaluations'), [['subcontractorId', '==', String(input.subcontractorId)]]);
  const items = all.filter((e) => !input.projectId || e.projectId === input.projectId).sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt)).slice(0, 200);
  const data = await loadOrgData(ctx.db, ctx.org.id, ['projects', 'assignments']);
  const visible = visibleSubIds(ctx, data);
  if (visible && !visible.has(String(input.subcontractorId))) return { items: [] };
  return { items };
}
