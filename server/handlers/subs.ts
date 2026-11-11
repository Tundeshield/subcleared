import { readinessRank } from '../../src/domain/compliance';
import { isISODate } from '../../src/domain/dates';
import { parseSubcontractorCsv, guessSubTypes, type ImportRow } from '../../src/domain/importCsv';
import { SUB_TYPES } from '../../src/domain/library';
import { canSeeProject, isProjectScoped, permissionsFor } from '../../src/domain/permissions';
import type { Contact, ContactRole, Subcontractor, SubStatus } from '../../src/domain/types';
import { audit, bad, C, type Ctx, diff, EMAIL_RE, id, need, notFound, oneOf, reqStr, str } from '../core';
import { loadOrgData, recompute, type OrgData } from '../data';
import { enforceLimit } from './billing';

const CONTACT_ROLES: ContactRole[] = ['owner', 'administrator', 'compliance', 'project', 'submission'];

export function visibleSubIds(ctx: Ctx, data: Pick<OrgData, 'projects' | 'assignments'>): Set<string> | null {
  if (!isProjectScoped(ctx.member)) return null; // everything
  const pids = new Set(data.projects.filter((p) => canSeeProject(ctx.member, p)).map((p) => p.id));
  return new Set(data.assignments.filter((a) => a.active && pids.has(a.projectId)).map((a) => a.subcontractorId));
}

export async function loadSub(ctx: Ctx, subId: unknown, data?: Pick<OrgData, 'projects' | 'assignments'>) {
  const sid = id(subId, 'Subcontractor');
  const s = await ctx.db.get<Subcontractor>(C.doc(ctx.org.id, 'subcontractors', sid));
  if (!s) throw notFound('Subcontractor not found');
  if (isProjectScoped(ctx.member)) {
    const d = data ?? (await loadOrgData(ctx.db, ctx.org.id, ['projects', 'assignments']));
    if (!visibleSubIds(ctx, d)!.has(sid)) throw notFound('Subcontractor not found');
  }
  return s;
}

function parseContacts(raw: unknown): Contact[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 25) throw bad('Contacts must be a list (max 25)');
  const seen = new Set<string>();
  const contacts = raw.map((c: any, i) => {
    const e = reqStr(c?.email, `Contact ${i + 1} email`, 254).toLowerCase();
    if (!EMAIL_RE.test(e)) throw bad(`Contact ${i + 1} email is invalid`);
    if (seen.has(e)) throw bad(`Contact email ${e} is listed twice`);
    seen.add(e);
    const roles = Array.isArray(c?.roles) ? c.roles.filter((r: any) => CONTACT_ROLES.includes(r)) : [];
    return {
      id: typeof c?.id === 'string' && c.id ? c.id.slice(0, 40) : Math.random().toString(36).slice(2, 12),
      name: reqStr(c?.name, `Contact ${i + 1} name`, 120), email: e, phone: str(c?.phone, 'Phone', { max: 40 }),
      roles: roles.length ? roles : ['submission'], primary: !!c?.primary, portalAccess: !!c?.portalAccess,
    } as Contact;
  });
  if (contacts.length && !contacts.some((c) => c.primary)) contacts[0].primary = true;
  let primarySeen = false;
  for (const c of contacts) { if (c.primary && primarySeen) c.primary = false; if (c.primary) primarySeen = true; }
  return contacts;
}

function parseFields(input: any, partial: boolean): Partial<Subcontractor> {
  const out: Partial<Subcontractor> = {};
  if (!partial || input.legalName !== undefined) out.legalName = reqStr(input.legalName, 'Legal business name', 200);
  if (!partial || input.trade !== undefined) out.trade = reqStr(input.trade, 'Primary trade', 100);
  for (const [k, label, max] of [['tradingName', 'Trading name', 200], ['registrationNumber', 'Registration number', 60], ['companyType', 'Company type', 60], ['address', 'Address', 300], ['country', 'Country', 80], ['jurisdiction', 'Jurisdiction', 80]] as const) {
    if (input[k] !== undefined) (out as any)[k] = str(input[k], label, { max });
  }
  if (input.subTypes !== undefined) {
    if (!Array.isArray(input.subTypes)) throw bad('Subcontractor types must be a list');
    out.subTypes = input.subTypes.filter((t: any) => SUB_TYPES.includes(t));
  } else if (!partial) out.subTypes = guessSubTypes(out.trade ?? '');
  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags) || input.tags.length > 20) throw bad('Tags must be a list (max 20)');
    out.tags = [...new Set(input.tags.map((t: any) => String(t).trim().slice(0, 40)).filter(Boolean))] as string[];
  }
  if (input.contacts !== undefined) out.contacts = parseContacts(input.contacts);
  if (input.onboardingDate !== undefined) { if (input.onboardingDate && !isISODate(input.onboardingDate)) throw bad('Onboarding date is invalid'); out.onboardingDate = input.onboardingDate || undefined; }
  if (input.ownerUid !== undefined) out.ownerUid = input.ownerUid || undefined;
  return out;
}

async function duplicateCheck(ctx: Ctx, legalName: string, registration?: string, exceptId?: string) {
  const all = await ctx.db.list<Subcontractor>(C.col(ctx.org.id, 'subcontractors'));
  const clash = all.find((s) => s.id !== exceptId && (s.legalName.toLowerCase() === legalName.toLowerCase() || (registration && s.registrationNumber && s.registrationNumber.toLowerCase() === registration.toLowerCase())));
  if (clash) throw bad(`A subcontractor called "${clash.legalName}" already exists in your directory`);
}

export async function listSubs(ctx: Ctx, input: any) {
  const data = await loadOrgData(ctx.db, ctx.org.id, ['subs', 'projects', 'assignments', 'readiness']);
  const visible = visibleSubIds(ctx, data);
  const live = new Set(data.projects.filter((p) => p.status !== 'archived').map((p) => p.id));
  let items = data.subs.filter((s) => !visible || visible.has(s.id)).map((s) => {
    const assignments = data.assignments.filter((a) => a.active && a.subcontractorId === s.id && live.has(a.projectId));
    const rs = assignments.map((a) => data.readiness.find((r) => r.id === `${a.projectId}__${s.id}`)).filter(Boolean) as OrgData['readiness'];
    const worst = rs.reduce<string | null>((w, r) => (!w || readinessRank(r.readiness) < readinessRank(w as any) ? r.readiness : w), null);
    const primary = s.contacts.find((c) => c.primary) ?? s.contacts[0];
    return {
      id: s.id, legalName: s.legalName, tradingName: s.tradingName, trade: s.trade, status: s.status, tags: s.tags,
      contact: primary ? { name: primary.name, email: primary.email } : null, projects: assignments.length,
      readiness: worst ?? 'not_evaluated', outstanding: rs.reduce((n, r) => n + r.results.filter((x) => x.blocking).length, 0),
      expiring: rs.reduce((n, r) => n + r.results.filter((x) => x.status === 'expiring_soon').length, 0),
      readyOn: rs.filter((r) => r.readiness === 'ready').length, issues: issueCounts(rs),
      lastActivityAt: s.lastActivityAt ?? s.updatedAt, country: s.country, jurisdiction: s.jurisdiction,
    };
  });
  if (input?.status) items = items.filter((i) => i.status === input.status);
  if (input?.readiness) items = items.filter((i) => i.readiness === input.readiness);
  if (input?.issue) items = items.filter((i) => (i.issues as any)[input.issue] > 0);
  return { items: items.sort((a, b) => a.legalName.localeCompare(b.legalName)) };
}

export async function getSubDetail(ctx: Ctx, input: any) {
  const data = await loadOrgData(ctx.db, ctx.org.id);
  const s = await loadSub(ctx, input.subcontractorId, data);
  const defs = new Map(data.requirements.map((r) => [r.id, r]));
  const projects = data.assignments.filter((a) => a.subcontractorId === s.id && a.active).map((a) => {
    const p = data.projects.find((x) => x.id === a.projectId)!;
    const r = data.readiness.find((x) => x.id === `${a.projectId}__${s.id}`);
    return p && { id: p.id, name: p.name, code: p.code, status: p.status, visible: canSeeProject(ctx.member, p), readiness: r?.readiness ?? 'not_evaluated', summary: r?.summary, reasons: r?.reasons ?? [], results: r?.results ?? [], evaluatedAt: r?.evaluatedAt };
  }).filter(Boolean);
  const documents = data.documents.filter((d) => d.subcontractorId === s.id).map((d) => ({
    ...d, requirementName: d.requirementId ? defs.get(d.requirementId)?.name : undefined,
    versions: data.versions.filter((v) => v.documentId === d.id).sort((a, b) => b.versionNumber - a.versionNumber).map(({ storagePath, ...v }) => v),
  }));
  const requests = data.requests.filter((r) => r.subcontractorId === s.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const links = (await ctx.db.list<any>(C.col(ctx.org.id, 'links'), [['subcontractorId', '==', s.id]])).map(({ tokenHash, ...l }) => l);
  const overrides = data.overrides.filter((o) => o.subcontractorId === s.id && !o.revoked);
  const canNotes = permissionsFor(ctx.member).has('subs.notes');
  const notes = canNotes ? (await ctx.db.list<any>(C.col(ctx.org.id, 'notes'), [['subcontractorId', '==', s.id]])).sort((a, b) => b.at.localeCompare(a.at)) : null;
  const history = (await ctx.db.list<any>(C.col(ctx.org.id, 'evaluations'), [['subcontractorId', '==', s.id]]))
    .sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt)).slice(0, 100)
    .map((e) => ({ id: e.id, projectId: e.projectId, readiness: e.readiness, previousReadiness: e.previousReadiness, summary: e.summary, evaluatedAt: e.evaluatedAt, trigger: e.trigger }));
  return { subcontractor: s, projects, documents, requests, links, overrides, notes, history, requirements: data.requirements.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name, kind: r.kind, category: r.category, instructions: r.instructions, expiryRequired: r.expiryRequired, renewalPeriodDays: r.renewalPeriodDays })) };
}

export async function createSub(ctx: Ctx, input: any) {
  need(ctx, 'subs.manage');
  await enforceLimit(ctx, 'subcontractors');
  const f = parseFields(input, false);
  await duplicateCheck(ctx, f.legalName!, f.registrationNumber);
  const now = ctx.svc.now().toISOString();
  const s: Subcontractor = {
    id: ctx.db.newId(), legalName: f.legalName!, tradingName: f.tradingName, registrationNumber: f.registrationNumber, companyType: f.companyType,
    trade: f.trade!, subTypes: f.subTypes ?? [], address: f.address, country: f.country, jurisdiction: f.jurisdiction, contacts: f.contacts ?? [],
    tags: f.tags ?? [], onboardingDate: f.onboardingDate ?? now.slice(0, 10), status: 'onboarding', ownerUid: f.ownerUid ?? ctx.member.uid,
    createdAt: now, updatedAt: now,
  };
  await ctx.db.set(C.doc(ctx.org.id, 'subcontractors', s.id), s as any);
  await audit(ctx, { action: 'subcontractor.created', entity: { type: 'subcontractor', id: s.id, label: s.legalName }, after: s });
  return { subcontractorId: s.id };
}

export async function updateSub(ctx: Ctx, input: any) {
  need(ctx, 'subs.manage');
  const s = await loadSub(ctx, input.subcontractorId);
  const f = parseFields(input, true);
  if (f.legalName || f.registrationNumber) await duplicateCheck(ctx, f.legalName ?? s.legalName, f.registrationNumber ?? s.registrationNumber, s.id);
  const next = { ...s, ...f, updatedAt: ctx.svc.now().toISOString() };
  const d = diff(s as any, next as any);
  if (!d.changed) return { ok: true };
  await ctx.db.set(C.doc(ctx.org.id, 'subcontractors', s.id), next as any);
  await audit(ctx, { action: 'subcontractor.updated', entity: { type: 'subcontractor', id: s.id, label: next.legalName }, before: d.before, after: d.after });
  if (f.subTypes) await recompute(ctx, { subcontractorId: s.id }, 'subcontractor.types_changed');
  return { ok: true };
}

export async function setSubStatus(ctx: Ctx, input: any) {
  need(ctx, 'subs.manage');
  const s = await loadSub(ctx, input.subcontractorId);
  const status = oneOf(input.status, ['active', 'suspended', 'archived'] as SubStatus[], 'Status');
  const reason = str(input.reason, 'Reason', { max: 500 });
  if (status !== 'active' && !reason) throw bad('Please record a reason');
  if (status === 'active' && s.status !== 'suspended' && s.status !== 'archived') return { ok: true };
  await ctx.db.update(C.doc(ctx.org.id, 'subcontractors', s.id), { status, updatedAt: ctx.svc.now().toISOString() });
  const action = status === 'active' ? 'subcontractor.restored' : `subcontractor.${status}`;
  await audit(ctx, { action, entity: { type: 'subcontractor', id: s.id, label: s.legalName }, before: { status: s.status }, after: { status, reason } });
  if (status !== 'active') {
    // Suspended/archived subcontractors lose external access immediately.
    const links = await ctx.db.list<any>(C.col(ctx.org.id, 'links'), [['subcontractorId', '==', s.id]]);
    for (const l of links.filter((x) => !x.revokedAt)) {
      const at = ctx.svc.now().toISOString();
      await ctx.db.update(C.doc(ctx.org.id, 'links', l.id), { revokedAt: at, revokedBy: ctx.member.uid });
      await ctx.db.update(`portalTokens/${l.tokenHash}`, { revokedAt: at }).catch(() => undefined);
    }
  }
  await recompute(ctx, { subcontractorId: s.id }, action);
  return { ok: true };
}

export async function addNote(ctx: Ctx, input: any) {
  need(ctx, 'subs.notes');
  const s = await loadSub(ctx, input.subcontractorId);
  const text = reqStr(input.text, 'Note', 4000);
  const nid = ctx.db.newId();
  await ctx.db.set(C.doc(ctx.org.id, 'notes', nid), { id: nid, subcontractorId: s.id, text, by: { uid: ctx.member.uid, name: ctx.member.name }, at: ctx.svc.now().toISOString() });
  await audit(ctx, { action: 'subcontractor.note_added', entity: { type: 'subcontractor', id: s.id, label: s.legalName } });
  return { noteId: nid };
}

export async function importSubs(ctx: Ctx, input: any) {
  need(ctx, 'subs.manage');
  const csv = reqStr(input.csv, 'CSV', 2_000_000);
  const parsed = parseSubcontractorCsv(csv);
  const existing = await ctx.db.list<Subcontractor>(C.col(ctx.org.id, 'subcontractors'));
  const names = new Set(existing.map((s) => s.legalName.toLowerCase()));
  const toCreate: ImportRow[] = [];
  const skipped: { line?: number; name: string; reason: string }[] = [];
  for (const r of parsed.rows) {
    if (names.has(r.legalName.toLowerCase())) skipped.push({ name: r.legalName, reason: 'Already in directory' });
    else toCreate.push(r);
  }
  if (input.dryRun) return { preview: toCreate, errors: parsed.errors, skipped };
  await enforceLimit(ctx, 'subcontractors', toCreate.length);
  const now = ctx.svc.now().toISOString();
  const created: string[] = [];
  for (const r of toCreate) {
    const s: Subcontractor = {
      id: ctx.db.newId(), legalName: r.legalName, tradingName: r.tradingName, registrationNumber: r.registrationNumber, trade: r.trade, subTypes: r.subTypes,
      address: r.address, country: r.country, jurisdiction: r.jurisdiction, tags: r.tags, status: 'onboarding', onboardingDate: now.slice(0, 10), ownerUid: ctx.member.uid,
      contacts: r.contactEmail ? [{ id: Math.random().toString(36).slice(2, 12), name: r.contactName || r.contactEmail, email: r.contactEmail, phone: r.contactPhone, roles: ['submission'], primary: true }] : [],
      createdAt: now, updatedAt: now,
    };
    await ctx.db.set(C.doc(ctx.org.id, 'subcontractors', s.id), s as any);
    created.push(s.id);
  }
  await audit({ ...ctx, source: 'import' }, { action: 'subcontractor.imported', entity: { type: 'organisation', id: ctx.org.id }, after: { created: created.length, skipped: skipped.length, errors: parsed.errors.length } });
  return { created: created.length, errors: parsed.errors, skipped };
}

/** Distinct requirements in each problem state across a subcontractor's live projects (a requirement shared by two projects counts once). */
function issueCounts(rs: OrgData['readiness']) {
  const sets: Record<string, Set<string>> = { missing: new Set(), requested: new Set(), expired: new Set(), rejected: new Set(), review: new Set(), expiring: new Set() };
  for (const r of rs) for (const x of r.results) {
    const k = x.mandatory && ['missing', 'not_requested'].includes(x.status) ? 'missing' : x.mandatory && ['requested', 'overdue'].includes(x.status) ? 'requested'
      : x.status === 'expired' ? 'expired' : x.status === 'rejected' ? 'rejected' : ['awaiting_review', 'submitted', 'review_required'].includes(x.status) ? 'review' : x.status === 'expiring_soon' ? 'expiring' : null;
    if (k) sets[k].add(x.requirementId);
  }
  return Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.size])) as Record<'missing' | 'requested' | 'expired' | 'rejected' | 'review' | 'expiring', number>;
}
