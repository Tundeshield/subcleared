// "Ask SubCleared": answers questions from the organisation's actual records.
//
// The model only ever sees a bounded snapshot of records this member may see,
// and must cite them as [[sub:id|Name]] / [[project:id|Name]] / [[review:id|Title]].
// Citations to anything not in the snapshot are stripped, so it can't invent
// records. It can propose one action, sending reminders, which a person must
// confirm; the confirmation runs the normal, deterministic request path.
import { displayReadiness, readinessReason, READINESS_LABELS } from '../../src/domain/compliance';
import { daysBetween, todayIn } from '../../src/domain/dates';
import { canSeeProject } from '../../src/domain/permissions';
import { allowance, monthKey, parseAiJson, recordUsage } from '../ai';
import { bad, C, type Ctx, HttpError, need, rateLimit, reqStr } from '../core';
import { loadOrgData } from '../data';
import { requestForProject } from './requests';
import { visibleSubIds } from './subs';

const SHOWN: Record<string, string> = { ...READINESS_LABELS, needs_review: 'Needs review' };
const OPEN = new Set(['missing', 'not_requested', 'requested', 'overdue', 'rejected', 'expired', 'expiring_soon']);

export async function aiUsage(ctx: Ctx) {
  need(ctx, 'settings.manage');
  const months = (await ctx.db.list<any>(C.col(ctx.org.id, 'aiUsage'))).sort((a, b) => b.id.localeCompare(a.id)).slice(0, 6);
  const al = await allowance(ctx.svc, ctx.org);
  return { configured: !!ctx.svc.ai, fastModel: ctx.svc.env.aiFastModel, model: ctx.svc.env.anthropicModel, month: months.find((m) => m.id === monthKey(ctx.svc.now())) ?? { documents: 0, calls: 0, inputTokens: 0, outputTokens: 0 }, history: months, limit: al.limit, pricesConfigured: !!ctx.svc.env.aiPrices };
}

async function snapshot(ctx: Ctx, projectId?: string) {
  const data = await loadOrgData(ctx.db, ctx.org.id);
  const today = todayIn(ctx.org.settings.timezone, ctx.svc.now());
  const visible = visibleSubIds(ctx, data);
  const projects = data.projects.filter((p) => p.status !== 'archived' && canSeeProject(ctx.member, p) && (!projectId || p.id === projectId));
  const pids = new Set(projects.map((p) => p.id));
  const subs = new Map(data.subs.filter((s) => !visible || visible.has(s.id)).map((s) => [s.id, s]));
  const pairs = data.readiness.filter((r) => pids.has(r.projectId) && subs.has(r.subcontractorId) && data.assignments.some((a) => a.active && a.projectId === r.projectId && a.subcontractorId === r.subcontractorId)).slice(0, 300).map((r) => {
    const shown = displayReadiness(r.readiness, r.results);
    return {
      projectId: r.projectId, project: projects.find((p) => p.id === r.projectId)!.name, subcontractorId: r.subcontractorId, subcontractor: subs.get(r.subcontractorId)!.legalName,
      status: SHOWN[shown] ?? shown, reason: readinessReason(r.results, shown),
      outstanding: r.results.filter((x) => x.mandatory && OPEN.has(x.status)).map((x) => ({ requirementId: x.requirementId, name: x.requirementName, status: x.status, detail: x.reason })),
    };
  });
  const docs = new Map(data.documents.map((d) => [d.id, d]));
  const expiring = data.versions.filter((v) => v.reviewStatus === 'approved' && subs.has(v.subcontractorId) && docs.get(v.documentId)?.approvedVersionId === v.id && v.metadata.expiryDate)
    .map((v) => ({ subcontractorId: v.subcontractorId, subcontractor: subs.get(v.subcontractorId)!.legalName, document: docs.get(v.documentId)?.title, expiryDate: v.metadata.expiryDate, daysLeft: daysBetween(today, v.metadata.expiryDate!) }))
    .filter((x) => x.daysLeft <= 90).sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 100);
  const reviews = data.versions.filter((v) => subs.has(v.subcontractorId) && ['submitted', 'awaiting_review', 'under_review'].includes(v.reviewStatus)).slice(0, 100)
    .map((v) => ({ reviewId: v.id, subcontractor: subs.get(v.subcontractorId)!.legalName, document: docs.get(v.documentId)?.title ?? v.fileName, submitted: v.uploadedAt.slice(0, 10), check: v.assessment?.summary ?? 'Not read automatically' }));
  const weekAgo = new Date(ctx.svc.now().getTime() - 7 * 86_400_000).toISOString();
  const changes = (await ctx.db.list<any>(C.col(ctx.org.id, 'audit'))).filter((e) => e.at >= weekAgo && /^(document\.|request\.|compliance\.status_changed|intake\.attached|project\.subcontractor_assigned)/.test(e.action))
    .filter((e) => !projectId || (e.refs ?? []).includes(projectId) || (e.refs ?? []).some((x: string) => pairs.some((p) => p.subcontractorId === x)))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80).map((e) => ({ at: e.at.slice(0, 16).replace('T', ' '), what: e.action, item: e.entity.label, by: e.actor?.name }));
  return { today, projects: projects.map((p) => ({ projectId: p.id, name: p.name, status: p.status, start: p.startDate, end: p.endDate })), pairs, expiringWithin90Days: expiring, awaitingReview: reviews, changesLast7Days: changes };
}

const SYSTEM = `You are the assistant inside SubCleared, which tracks subcontractor paperwork and project readiness for a construction business.
Answer ONLY from the DATA provided. If the data doesn't contain the answer, say so plainly. Never invent records, statuses, dates or events. Never claim you sent, changed or approved anything.
Refer to records with links in exactly this form: [[sub:<subcontractorId>|<name>]], [[project:<projectId>|<name>]], [[review:<reviewId>|<document>]]. Use only ids present in DATA.
Be brief and practical: lead with the answer, then a short list if helpful. Plain English, no compliance jargon.
If the user asks you to prepare, send or chase reminders, propose them as an action; the person will confirm before anything is sent.
Return ONLY JSON: {"answer": "<markdown>", "action": null | {"type": "send_reminders", "items": [{"projectId": "...", "subcontractorId": "..."}]}}`;

export async function ask(ctx: Ctx, input: any) {
  if (!ctx.svc.ai) throw new HttpError(503, 'Ask SubCleared needs an AI provider. Set ANTHROPIC_API_KEY for this deployment.', 'not_configured');
  const question = reqStr(input.question, 'Question', 500);
  await rateLimit(ctx.db, `assistant:${ctx.member.uid}`, 40, 3600, ctx.svc.now());
  const snap = await snapshot(ctx, typeof input.projectId === 'string' ? input.projectId : undefined);
  const r = await ctx.svc.ai.call({ model: ctx.svc.env.anthropicModel, system: SYSTEM, maxTokens: 1200, content: [{ type: 'text', text: `QUESTION: ${question}\n\nDATA: ${JSON.stringify(snap)}` }] });
  await recordUsage(ctx.svc, ctx.org.id, { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, purpose: 'assistant' });
  let out: any;
  try { out = parseAiJson(r.text); } catch { out = { answer: r.text, action: null }; }
  const known = {
    sub: new Map(snap.pairs.map((p) => [p.subcontractorId, p.subcontractor])),
    project: new Map(snap.projects.map((p) => [p.projectId, p.name])),
    review: new Map(snap.awaitingReview.map((v) => [v.reviewId, v.document])),
  } as Record<string, Map<string, string>>;
  for (const e of snap.expiringWithin90Days) known.sub.set(e.subcontractorId, e.subcontractor);
  // Keep only citations to real, visible records; anything else becomes plain text.
  const answer = String(out.answer ?? '').slice(0, 6000).replace(/\[\[(sub|project|review):([^|\]]+)\|([^\]]+)\]\]/g, (_m, t, id, label) => (known[t]?.has(id) ? `[[${t}:${id}|${label}]]` : label));
  let action = null;
  if (out.action?.type === 'send_reminders' && Array.isArray(out.action.items)) {
    const items = out.action.items
      .map((i: any) => snap.pairs.find((p) => p.projectId === i?.projectId && p.subcontractorId === i?.subcontractorId))
      .filter((p: any) => p && p.outstanding.length)
      .slice(0, 50)
      .map((p: any) => ({ projectId: p.projectId, project: p.project, subcontractorId: p.subcontractorId, subcontractor: p.subcontractor, documents: p.outstanding.map((o: any) => o.name) }));
    if (items.length) action = { type: 'send_reminders', items };
  }
  return { answer, action };
}

/** Runs a confirmed assistant proposal through the normal request path. */
export async function confirm(ctx: Ctx, input: any) {
  need(ctx, 'requests.send');
  if (input?.type !== 'send_reminders' || !Array.isArray(input.items) || !input.items.length) throw bad('Nothing to confirm');
  const byProject = new Map<string, string[]>();
  for (const i of input.items.slice(0, 50)) {
    if (typeof i?.projectId !== 'string' || typeof i?.subcontractorId !== 'string') throw bad('Invalid item');
    byProject.set(i.projectId, [...(byProject.get(i.projectId) ?? []), i.subcontractorId]);
  }
  const results: any[] = [];
  for (const [projectId, subcontractorIds] of byProject) {
    const p = await ctx.db.get<any>(C.doc(ctx.org.id, 'projects', projectId));
    if (!p || !canSeeProject(ctx.member, p)) throw new HttpError(404, 'Project not found', 'not_found');
    results.push(...(await requestForProject(ctx, { projectId, subcontractorIds })).results);
  }
  return { results };
}
