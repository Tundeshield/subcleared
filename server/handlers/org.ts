import { readinessRank } from '../../src/domain/compliance';
import { addDays, daysBetween, todayIn } from '../../src/domain/dates';
import { STARTER_REQUIREMENTS, STARTER_TEMPLATES } from '../../src/domain/library';
import { canAssignRole, canSeeProject, isProjectScoped, permissionsFor, ROLE_PERMISSIONS } from '../../src/domain/permissions';
import { getPlan, TRIAL_DAYS } from '../../src/domain/plans';
import type {
  AuditEvent, InAppNotification, Invitation, Member, NotificationType, Organisation, OrgSettings, Permission, Project, RequirementDefinition,
  RequirementTemplate, Role,
} from '../../src/domain/types';
import {
  audit, bad, C, conflict, type Ctx, diff, email, forbidden, HttpError, id, ids, need, notFound, oneOf, randomToken, reqStr, sha256, str,
} from '../core';
import { loadOrgData } from '../data';
import type { Db } from '../db';
import { sendEmail } from '../email';
import type { Identity, Services } from '../services';

const ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];
const ALL_PERMS = ROLE_PERMISSIONS.owner;

export const DEFAULT_SETTINGS = (timezone: string): OrgSettings => ({
  timezone, expiringSoonDays: 30, reminderSchedule: [90, 60, 30, 14, 7, 0, -7], escalationDays: 14,
  retentionYears: 7, remindArchived: false, defaultLinkExpiryDays: 14,
});

export interface UserDoc { uid: string; email: string; name: string; orgIds: string[]; defaultOrgId?: string; createdAt: string; textScale?: number; theme?: string; views?: any[] }

export async function me(svc: Services, db: Db, identity: Identity, orgId?: string) {
  const user = await db.get<UserDoc>(C.user(identity.uid));
  const orgIds = user?.orgIds ?? [];
  const memberships = [];
  for (const oid of orgIds) {
    const [org, member] = await db.getMany<any>([C.org(oid), C.doc(oid, 'members', identity.uid)]);
    if (org && member) memberships.push({ orgId: oid, orgName: org.name, role: member.role, status: member.status });
  }
  const active = memberships.find((m) => m.orgId === orgId && m.status === 'active') ?? memberships.find((m) => m.status === 'active');
  let org: Organisation | null = null;
  let member: Member | null = null;
  if (active) {
    [org, member] = await db.getMany<any>([C.org(active.orgId), C.doc(active.orgId, 'members', identity.uid)]);
  }
  return {
    user: { uid: identity.uid, email: identity.email, emailVerified: identity.emailVerified, name: user?.name || identity.name || '', textScale: user?.textScale, theme: user?.theme, views: user?.views ?? [] },
    memberships, org, member,
    permissions: member ? [...permissionsFor(member)] : [],
    projectScoped: member ? isProjectScoped(member) : false,
    plans: svc.env.plans,
    billingConfigured: !!svc.env.stripeSecret,
    emailConfigured: svc.mail.configured,
    extractionConfigured: !!svc.env.anthropicKey,
    mode: svc.mode,
  };
}

export async function updateProfile(svc: Services, db: Db, identity: Identity, input: any) {
  const patch: Partial<UserDoc> = {};
  if (input.name !== undefined) patch.name = reqStr(input.name, 'Name', 120);
  if (input.textScale !== undefined) { const n = Number(input.textScale); if (![1, 1.125, 1.25, 1.375].includes(n)) throw bad('Unsupported text size'); patch.textScale = n; }
  if (input.theme !== undefined) patch.theme = oneOf(input.theme, ['dark', 'light', 'system'] as const, 'Theme');
  if (input.views !== undefined) {
    if (!Array.isArray(input.views) || input.views.length > 30) throw bad('Invalid saved views');
    patch.views = input.views.map((v: any) => ({ id: id(v.id, 'View id'), name: reqStr(v.name, 'View name', 60), path: reqStr(v.path, 'View path', 300) }));
    if (patch.views!.some((v: any) => !v.path.startsWith('/app/'))) throw bad('Invalid view path');
  }
  const existing = await db.get<UserDoc>(C.user(identity.uid));
  await db.set(C.user(identity.uid), { uid: identity.uid, email: identity.email, orgIds: existing?.orgIds ?? [], createdAt: existing?.createdAt ?? svc.now().toISOString(), name: existing?.name ?? '', ...patch }, { merge: true });
  if (patch.name) {
    for (const oid of existing?.orgIds ?? []) {
      const m = await db.get<Member>(C.doc(oid, 'members', identity.uid));
      if (m) await db.update(C.doc(oid, 'members', identity.uid), { name: patch.name });
    }
  }
  return { ok: true };
}

export async function seedLibrary(db: Db, orgId: string, now: string) {
  const keyToId = new Map<string, string>();
  for (const r of STARTER_REQUIREMENTS) {
    const rid = db.newId();
    keyToId.set(r.key, rid);
    const { key, ...rest } = r;
    const def: RequirementDefinition = { ...rest, id: rid, active: true, version: 1, createdAt: now, updatedAt: now };
    await db.set(C.doc(orgId, 'requirements', rid), def as any);
    await db.set(C.doc(orgId, 'requirementVersions', `${rid}@1`), { ...def, requirementId: rid } as any);
  }
  for (const t of STARTER_TEMPLATES) {
    const tid = db.newId();
    const tpl: RequirementTemplate = {
      id: tid, name: t.name, description: t.description, version: 1, active: true, createdAt: now, updatedAt: now,
      items: t.items.map(([k, mandatory]) => ({ requirementId: keyToId.get(k)!, mandatory })),
    };
    await db.set(C.doc(orgId, 'templates', tid), tpl as any);
    await db.set(C.doc(orgId, 'templateVersions', `${tid}@1`), { ...tpl, templateId: tid } as any);
  }
}

export async function registerOrg(svc: Services, db: Db, identity: Identity, input: any) {
  if (!identity.emailVerified) throw new HttpError(403, 'Please verify your email address before creating an organisation.', 'email_unverified');
  const name = reqStr(input.orgName, 'Organisation name', 120);
  const country = reqStr(input.country, 'Country', 80);
  const timezone = reqStr(input.timezone, 'Timezone', 64);
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw bad('Unknown timezone'); }
  const personName = str(input.name, 'Your name', { max: 120 }) || identity.name || identity.email.split('@')[0];
  const now = svc.now();
  const orgId = db.newId();
  const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 86_400_000).toISOString();
  const org: Organisation = {
    id: orgId, name, country, createdAt: now.toISOString(), ownerUid: identity.uid, settings: DEFAULT_SETTINGS(timezone),
    subscription: { plan: 'growth', interval: 'month', status: 'trialing', trialEndsAt: trialEnds },
  };
  const member: Member = { uid: identity.uid, email: identity.email, name: personName, role: 'owner', status: 'active', joinedAt: now.toISOString() };
  await db.set(C.org(orgId), org as any);
  await db.set(C.doc(orgId, 'members', identity.uid), member as any);
  const user = await db.get<UserDoc>(C.user(identity.uid));
  await db.set(C.user(identity.uid), {
    uid: identity.uid, email: identity.email, name: personName, createdAt: user?.createdAt ?? now.toISOString(),
    orgIds: [...new Set([...(user?.orgIds ?? []), orgId])], defaultOrgId: orgId,
  }, { merge: true });
  if (input.seedLibrary !== false) await seedLibrary(db, orgId, now.toISOString());
  await audit({ db, svc, org, member, source: 'web' }, { action: 'organisation.created', entity: { type: 'organisation', id: orgId, label: name }, after: { name, country, timezone } });
  return { orgId };
}

export async function getSettings(ctx: Ctx) {
  return { org: ctx.org };
}

export async function updateSettings(ctx: Ctx, input: any) {
  need(ctx, 'settings.manage');
  const s = { ...ctx.org.settings };
  const n = (v: any, f: string, min: number, max: number) => { const x = Number(v); if (!Number.isInteger(x) || x < min || x > max) throw bad(`${f} must be between ${min} and ${max}`); return x; };
  if (input.timezone !== undefined) { try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }); s.timezone = input.timezone; } catch { throw bad('Unknown timezone'); } }
  if (input.expiringSoonDays !== undefined) s.expiringSoonDays = n(input.expiringSoonDays, 'Expiring-soon window', 0, 180);
  if (input.escalationDays !== undefined) s.escalationDays = n(input.escalationDays, 'Escalation period', 1, 120);
  if (input.retentionYears !== undefined) s.retentionYears = n(input.retentionYears, 'Retention', 1, 30);
  if (input.defaultLinkExpiryDays !== undefined) s.defaultLinkExpiryDays = n(input.defaultLinkExpiryDays, 'Link expiry', 1, 30);
  if (input.remindArchived !== undefined) s.remindArchived = !!input.remindArchived;
  if (input.reminderSchedule !== undefined) {
    if (!Array.isArray(input.reminderSchedule) || !input.reminderSchedule.length || input.reminderSchedule.length > 12) throw bad('Reminder schedule needs 1–12 entries');
    s.reminderSchedule = [...new Set(input.reminderSchedule.map((x: any) => n(x, 'Reminder offset', -90, 365)))].sort((a: any, b: any) => b - a) as number[];
  }
  const patch: any = { settings: s };
  if (input.name !== undefined) patch.name = reqStr(input.name, 'Organisation name', 120);
  if (input.country !== undefined) patch.country = reqStr(input.country, 'Country', 80);
  const d = diff({ settings: ctx.org.settings, name: ctx.org.name, country: ctx.org.country }, { settings: s, name: patch.name ?? ctx.org.name, country: patch.country ?? ctx.org.country });
  await ctx.db.update(C.org(ctx.org.id), patch);
  if (d.changed) await audit(ctx, { action: 'organisation.settings_changed', entity: { type: 'organisation', id: ctx.org.id, label: ctx.org.name }, before: d.before, after: d.after });
  return { ok: true };
}

// --- Members & invitations ---------------------------------------------------

export async function listMembers(ctx: Ctx) {
  const [members, invitations] = await Promise.all([
    ctx.db.list<Member>(C.col(ctx.org.id, 'members')),
    can(ctx, 'users.manage') ? ctx.db.list<Invitation>(C.col(ctx.org.id, 'invitations')) : Promise.resolve([]),
  ]);
  return {
    members: members.sort((a, b) => a.name.localeCompare(b.name)),
    invitations: invitations.filter((i) => i.status === 'pending').map(({ tokenHash, ...i }) => i),
  };
}

function can(ctx: Ctx, p: Permission) { return permissionsFor(ctx.member).has(p) && ctx.member.status === 'active'; }

export async function inviteMember(ctx: Ctx, input: any) {
  need(ctx, 'users.manage');
  const to = email(input.email);
  const role = oneOf(input.role, ROLES, 'Role');
  if (!canAssignRole(ctx.member, role)) throw forbidden('Only an owner can invite another owner');
  const { enforceLimit } = await import('./billing');
  await enforceLimit(ctx, 'users');
  const existing = (await ctx.db.list<Member>(C.col(ctx.org.id, 'members'))).find((m) => m.email === to);
  if (existing) throw conflict(`${to} is already a member`);
  const pending = (await ctx.db.list<Invitation>(C.col(ctx.org.id, 'invitations'), [['email', '==', to]])).filter((i) => i.status === 'pending');
  for (const p of pending) await ctx.db.update(C.doc(ctx.org.id, 'invitations', p.id), { status: 'revoked' });
  const token = randomToken();
  const now = ctx.svc.now();
  const inv: Invitation = {
    id: ctx.db.newId(), email: to, role, status: 'pending', invitedBy: ctx.member.uid, createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(), tokenHash: sha256(token),
  };
  await ctx.db.set(C.doc(ctx.org.id, 'invitations', inv.id), inv as any);
  await ctx.db.set(`invitationTokens/${inv.tokenHash}`, { orgId: ctx.org.id, invitationId: inv.id });
  const url = `${ctx.svc.env.appUrl}/accept-invite?token=${token}`;
  const log = await sendEmail(ctx, {
    to, template: 'member.invite', subject: `${ctx.member.name} invited you to ${ctx.org.name} on SubCleared`,
    heading: `Join ${ctx.org.name} on SubCleared`,
    body: `${ctx.member.name} has invited you to join ${ctx.org.name} as ${role.replace('_', ' ')}.\n\nThis invitation expires in 7 days.`,
    cta: { label: 'Accept invitation', url },
  });
  await audit(ctx, { action: 'member.invited', entity: { type: 'invitation', id: inv.id, label: to }, after: { email: to, role } });
  return { invitationId: inv.id, emailStatus: log.status, emailError: log.error, inviteUrl: url };
}

export async function revokeInvitation(ctx: Ctx, input: any) {
  need(ctx, 'users.manage');
  const iid = id(input.invitationId, 'Invitation');
  const inv = await ctx.db.get<Invitation>(C.doc(ctx.org.id, 'invitations', iid));
  if (!inv) throw notFound();
  await ctx.db.update(C.doc(ctx.org.id, 'invitations', iid), { status: 'revoked' });
  await ctx.db.delete(`invitationTokens/${inv.tokenHash}`);
  await audit(ctx, { action: 'member.invitation_revoked', entity: { type: 'invitation', id: iid, label: inv.email } });
  return { ok: true };
}

export async function acceptInvitation(svc: Services, db: Db, identity: Identity, input: any) {
  const token = reqStr(input.token, 'Token', 200);
  const ref = await db.get<{ orgId: string; invitationId: string }>(`invitationTokens/${sha256(token)}`);
  if (!ref) throw notFound('This invitation link is invalid or has been revoked.');
  const [org, inv] = await db.getMany<any>([C.org(ref.orgId), C.doc(ref.orgId, 'invitations', ref.invitationId)]) as [Organisation, Invitation];
  if (!org || !inv || inv.status !== 'pending') throw notFound('This invitation is no longer valid.');
  if (new Date(inv.expiresAt) < svc.now()) throw new HttpError(410, 'This invitation has expired. Ask your administrator to send a new one.');
  if (inv.email !== identity.email) throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that email address to accept it.`);
  if (!identity.emailVerified) throw new HttpError(403, 'Please verify your email address first.', 'email_unverified');
  const user = await db.get<UserDoc>(C.user(identity.uid));
  const member: Member = { uid: identity.uid, email: identity.email, name: user?.name || identity.name || identity.email.split('@')[0], role: inv.role, status: 'active', joinedAt: svc.now().toISOString() };
  await db.transaction(async (tx) => {
    const cur = await tx.get<Invitation>(C.doc(ref.orgId, 'invitations', inv.id));
    if (cur?.status !== 'pending') throw conflict('Invitation already used');
    tx.set(C.doc(ref.orgId, 'members', identity.uid), member as any);
    tx.update(C.doc(ref.orgId, 'invitations', inv.id), { status: 'accepted' });
    tx.set(C.user(identity.uid), { uid: identity.uid, email: identity.email, name: member.name, createdAt: user?.createdAt ?? svc.now().toISOString(), orgIds: [...new Set([...(user?.orgIds ?? []), ref.orgId])], defaultOrgId: ref.orgId }, { merge: true });
  });
  await db.delete(`invitationTokens/${inv.tokenHash}`);
  await audit({ db, svc, org, member, source: 'web' }, { action: 'member.joined', entity: { type: 'member', id: identity.uid, label: identity.email }, after: { role: inv.role } });
  return { orgId: ref.orgId };
}

export async function updateMember(ctx: Ctx, input: any) {
  need(ctx, 'users.manage');
  const uid = id(input.uid, 'Member');
  const path = C.doc(ctx.org.id, 'members', uid);
  const target = await ctx.db.get<Member>(path);
  if (!target) throw notFound('Member not found');
  if (target.role === 'owner' && ctx.member.role !== 'owner') throw forbidden('Only an owner can change another owner');
  const patch: Partial<Member> = {};
  if (input.role !== undefined) {
    const role = oneOf(input.role, ROLES, 'Role');
    if (!canAssignRole(ctx.member, role)) throw forbidden('Only an owner can grant the owner role');
    patch.role = role;
  }
  if (input.status !== undefined) {
    patch.status = oneOf(input.status, ['active', 'deactivated'] as const, 'Status');
    if (uid === ctx.member.uid && patch.status === 'deactivated') throw bad('You cannot deactivate yourself');
  }
  if (input.extraPermissions !== undefined) patch.extraPermissions = ids(input.extraPermissions, 'Permissions').filter((p) => ALL_PERMS.includes(p as Permission)) as Permission[];
  if (input.revokedPermissions !== undefined) patch.revokedPermissions = ids(input.revokedPermissions, 'Permissions').filter((p) => ALL_PERMS.includes(p as Permission)) as Permission[];
  const losingOwner = target.role === 'owner' && ((patch.role && patch.role !== 'owner') || patch.status === 'deactivated');
  if (losingOwner) {
    const owners = (await ctx.db.list<Member>(C.col(ctx.org.id, 'members'))).filter((m) => m.role === 'owner' && m.status === 'active');
    if (owners.length <= 1) throw bad('An organisation must keep at least one active owner');
  }
  const d = diff(target as any, { ...target, ...patch } as any);
  await ctx.db.update(path, patch as any);
  if (patch.status === 'deactivated') await ctx.svc.auth.revokeSessions?.(uid).catch(() => undefined);
  if (d.changed) await audit(ctx, { action: 'member.access_changed', entity: { type: 'member', id: uid, label: target.email }, before: d.before, after: d.after });
  return { ok: true };
}

// --- Notifications -------------------------------------------------------------

export async function listNotifications(ctx: Ctx, input: any) {
  const all = await ctx.db.list<InAppNotification>(C.col(ctx.org.id, 'notifications'), [['recipientUid', '==', ctx.member.uid]]);
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = all.filter((n) => !n.readAt).length;
  const items = input?.unreadOnly ? all.filter((n) => !n.readAt) : all;
  return { items: items.slice(0, Math.min(Number(input?.limit) || 100, 300)), unread };
}

export async function markNotifications(ctx: Ctx, input: any) {
  const all = await ctx.db.list<InAppNotification>(C.col(ctx.org.id, 'notifications'), [['recipientUid', '==', ctx.member.uid]]);
  const want = input.all ? null : new Set(ids(input.ids, 'Notifications'));
  const now = ctx.svc.now().toISOString();
  for (const n of all) if (!n.readAt && (!want || want.has(n.id))) await ctx.db.update(C.doc(ctx.org.id, 'notifications', n.id), { readAt: now });
  return { ok: true };
}

export const NOTIFICATION_TYPES: NotificationType[] = ['request_sent', 'document_submitted', 'awaiting_review', 'document_approved', 'document_rejected', 'info_requested', 'expiring', 'expired', 'status_changed', 'became_non_compliant', 'project_threshold', 'escalation'];

export async function updateNotificationPrefs(ctx: Ctx, input: any) {
  const prefs: Member['notificationPrefs'] = {};
  for (const t of NOTIFICATION_TYPES) {
    const v = input?.prefs?.[t];
    if (v) prefs[t] = { inApp: v.inApp !== false, email: !!v.email };
  }
  await ctx.db.update(C.doc(ctx.org.id, 'members', ctx.member.uid), { notificationPrefs: prefs });
  return { ok: true };
}

export async function deliveryLogs(ctx: Ctx) {
  need(ctx, 'settings.manage');
  const logs = await ctx.db.list<any>(C.col(ctx.org.id, 'deliveryLogs'));
  return { items: logs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 300) };
}

// --- Audit -----------------------------------------------------------------------

export async function listAudit(ctx: Ctx, input: any) {
  const ref = input?.ref ? id(input.ref, 'Reference') : undefined;
  if (!ref) need(ctx, 'audit.view');
  // Entity-scoped history (e.g. a subcontractor's Activity tab) only needs visibility of that record.
  let events = ref
    ? await ctx.db.list<AuditEvent & { refs: string[] }>(C.col(ctx.org.id, 'audit'), [['refs', 'array-contains', ref]])
    : await ctx.db.list<AuditEvent & { refs: string[] }>(C.col(ctx.org.id, 'audit'));
  if (input?.action) events = events.filter((e) => e.action.startsWith(String(input.action)));
  if (input?.actor) events = events.filter((e) => e.actor.id === input.actor);
  if (input?.from) events = events.filter((e) => e.at >= String(input.from));
  if (input?.to) events = events.filter((e) => e.at <= String(input.to) + 'T23:59:59.999Z');
  if (input?.q) { const q = String(input.q).toLowerCase(); events = events.filter((e) => `${e.action} ${e.entity.label ?? ''} ${e.actor.name}`.toLowerCase().includes(q)); }
  events.sort((a, b) => b.at.localeCompare(a.at));
  return { items: events.slice(0, Math.min(Number(input?.limit) || 200, 2000)), total: events.length };
}

// --- Search ----------------------------------------------------------------------

export async function search(ctx: Ctx, input: any) {
  const q = reqStr(input.q, 'Search', 100).toLowerCase();
  const data = await loadOrgData(ctx.db, ctx.org.id, ['projects', 'subs', 'documents', 'versions', 'requirements']);
  const visibleProjects = data.projects.filter((p) => canSeeProject(ctx.member, p));
  const has = (...v: (string | undefined)[]) => v.some((x) => x?.toLowerCase().includes(q));
  const subs = data.subs.filter((s) => has(s.legalName, s.tradingName, s.trade, s.registrationNumber, ...s.contacts.flatMap((c) => [c.name, c.email, c.phone]))).slice(0, 8);
  const projects = visibleProjects.filter((p) => has(p.name, p.code, p.location)).slice(0, 8);
  const subName = new Map(data.subs.map((s) => [s.id, s.legalName]));
  const versionsByDoc = new Map<string, any>();
  for (const v of data.versions) versionsByDoc.set(v.documentId, [...(versionsByDoc.get(v.documentId) ?? []), v]);
  const documents = data.documents.filter((d) => has(d.title, ...(versionsByDoc.get(d.id) ?? []).map((v: any) => v.metadata?.referenceNumber), ...(versionsByDoc.get(d.id) ?? []).map((v: any) => v.fileName))).slice(0, 8)
    .map((d) => ({ id: d.id, title: d.title, subcontractorId: d.subcontractorId, subcontractor: subName.get(d.subcontractorId) }));
  const requirements = data.requirements.filter((r) => has(r.name, r.category)).slice(0, 6).map((r) => ({ id: r.id, name: r.name, category: r.category }));
  return {
    subcontractors: subs.map((s) => ({ id: s.id, name: s.legalName, trade: s.trade, match: s.contacts.find((c) => has(c.name, c.email))?.email })),
    projects: projects.map((p) => ({ id: p.id, name: p.name, code: p.code })),
    documents, requirements,
  };
}

// --- Dashboard ---------------------------------------------------------------------

export async function dashboard(ctx: Ctx, input: any) {
  const data = await loadOrgData(ctx.db, ctx.org.id);
  const today = todayIn(ctx.org.settings.timezone, ctx.svc.now());
  let projects = data.projects.filter((p) => p.status !== 'archived' && canSeeProject(ctx.member, p));
  if (input?.projectId) projects = projects.filter((p) => p.id === input.projectId);
  const projectIds = new Set(projects.map((p) => p.id));
  let rows = data.readiness.filter((r) => projectIds.has(r.projectId) && data.assignments.some((a) => a.active && a.projectId === r.projectId && a.subcontractorId === r.subcontractorId));
  if (input?.subcontractorId) rows = rows.filter((r) => r.subcontractorId === input.subcontractorId);
  if (input?.status) rows = rows.filter((r) => r.readiness === input.status);

  const subIdsInScope = new Set(data.assignments.filter((a) => a.active && projectIds.has(a.projectId)).map((a) => a.subcontractorId));
  const scopedSubs = data.subs.filter((s) => s.status !== 'archived' && (isProjectScoped(ctx.member) || input?.projectId ? subIdsInScope.has(s.id) : true))
    .filter((s) => !input?.subcontractorId || s.id === input.subcontractorId);

  // A subcontractor's overall position = its worst project readiness.
  const worst = new Map<string, string>();
  for (const r of rows) {
    const cur = worst.get(r.subcontractorId);
    if (!cur || readinessRank(r.readiness) < readinessRank(cur as any)) worst.set(r.subcontractorId, r.readiness);
  }
  const subStatus = scopedSubs.map((s) => worst.get(s.id) ?? 'not_evaluated');
  const scopedSubIds = new Set(scopedSubs.map((s) => s.id));
  const currentVersions = data.versions.filter((v) => scopedSubIds.has(v.subcontractorId));
  const docById = new Map(data.documents.map((d) => [d.id, d]));
  const approvedCurrent = currentVersions.filter((v) => v.reviewStatus === 'approved' && docById.get(v.documentId)?.approvedVersionId === v.id && !docById.get(v.documentId)?.archived);
  const horizon = Number(input?.days) || 60;
  const upcoming = approvedCurrent.filter((v) => v.metadata.expiryDate).map((v) => ({ v, days: daysBetween(today, v.metadata.expiryDate!) }))
    .filter((x) => x.days <= horizon).sort((a, b) => a.days - b.days);
  const expired = upcoming.filter((x) => x.days < 0);
  const pending = currentVersions.filter((v) => ['submitted', 'awaiting_review', 'under_review'].includes(v.reviewStatus));
  const subName = new Map(data.subs.map((s) => [s.id, s.legalName]));

  const projectSummary = projects.map((p) => {
    const pr = rows.filter((r) => r.projectId === p.id);
    const issues = pr.reduce((n, r) => n + r.results.filter((x) => x.blocking).length, 0);
    return {
      id: p.id, name: p.name, code: p.code, status: p.status,
      assigned: data.assignments.filter((a) => a.active && a.projectId === p.id).length,
      ready: pr.filter((r) => r.readiness === 'ready').length,
      action: pr.filter((r) => r.readiness === 'action_required').length,
      notReady: pr.filter((r) => r.readiness === 'not_ready').length,
      notEvaluated: pr.filter((r) => r.readiness === 'not_evaluated').length,
      issues,
    };
  }).sort((a, b) => b.issues - a.issues || b.notReady - a.notReady);

  // Outstanding actions: the concrete next steps, worst first.
  const actions: any[] = [];
  for (const v of pending) actions.push({ kind: 'review', priority: 1, title: `Review ${v.fileName}`, detail: subName.get(v.subcontractorId), link: `/app/reviews/${v.id}`, at: v.uploadedAt });
  for (const r of rows) {
    const p = projects.find((x) => x.id === r.projectId);
    for (const x of r.results.filter((x) => x.blocking)) {
      actions.push({
        kind: x.status, priority: x.status === 'expired' ? 0 : x.status === 'overdue' ? 0 : 2,
        title: `${x.requirementName} — ${x.status.replace('_', ' ')}`, detail: `${subName.get(r.subcontractorId)} · ${p?.name}`,
        link: `/app/subcontractors/${r.subcontractorId}?tab=requirements&project=${r.projectId}`, subcontractorId: r.subcontractorId, requirementId: x.requirementId, projectId: r.projectId,
      });
    }
  }
  for (const x of upcoming.filter((u) => u.days >= 0 && u.days <= ctx.org.settings.expiringSoonDays)) {
    const hasRenewal = data.requests.some((q) => q.renewalOfVersionId === x.v.id && ['sent', 'acknowledged'].includes(q.status));
    if (!hasRenewal) actions.push({ kind: 'renewal', priority: 3, title: `Request renewal: ${docById.get(x.v.documentId)?.title}`, detail: `${subName.get(x.v.subcontractorId)} · expires in ${x.days} days`, link: `/app/renewals` });
  }
  actions.sort((a, b) => a.priority - b.priority);
  // Merge duplicates of the same requirement across projects.
  const seen = new Set<string>();
  const deduped = actions.filter((a) => { const k = `${a.kind}:${a.subcontractorId ?? ''}:${a.requirementId ?? a.link}`; if (seen.has(k)) return false; seen.add(k); return true; });

  const recent = (await ctx.db.list<AuditEvent>(C.col(ctx.org.id, 'audit'))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  return {
    today,
    metrics: {
      totalSubcontractors: scopedSubs.length,
      ready: subStatus.filter((s) => s === 'ready').length,
      attention: subStatus.filter((s) => s === 'action_required').length,
      notReady: subStatus.filter((s) => s === 'not_ready').length,
      notEvaluated: subStatus.filter((s) => s === 'not_evaluated').length,
      pendingReviews: pending.length,
      expiringSoon: upcoming.filter((x) => x.days >= 0 && x.days <= ctx.org.settings.expiringSoonDays).length,
      expired: new Set(expired.map((x) => x.v.subcontractorId)).size,
      expiredDocuments: expired.length,
      outstandingRequirements: rows.reduce((n, r) => n + r.results.filter((x) => x.blocking).length, 0),
      subsWithOutstanding: new Set(rows.filter((r) => r.results.some((x) => x.blocking)).map((r) => r.subcontractorId)).size,
    },
    projects: projectSummary,
    upcoming: upcoming.filter((x) => x.days >= 0).slice(0, 10).map((x) => ({ versionId: x.v.id, documentId: x.v.documentId, title: docById.get(x.v.documentId)?.title, subcontractor: subName.get(x.v.subcontractorId), subcontractorId: x.v.subcontractorId, expiryDate: x.v.metadata.expiryDate, days: x.days })),
    actions: deduped.slice(0, 25),
    actionsTotal: deduped.length,
    recent: ctx.member && permissionsFor(ctx.member).has('audit.view') ? recent : recent.filter((e) => !e.action.startsWith('member.')),
    hasRequirements: data.requirements.length > 0,
    hasProjects: data.projects.length > 0,
    hasSubs: data.subs.length > 0,
  };
}

export { addDays };
