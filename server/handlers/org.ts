import { currentTriage } from '../../src/domain/assessment';
import { readinessRank } from '../../src/domain/compliance';
import { addDays, daysBetween, todayIn } from '../../src/domain/dates';
import { starterRequirements, STARTER_TEMPLATES } from '../../src/domain/library';
import { countryDefaults, MARKETS, marketFromCountry, validCurrency, validLocale } from '../../src/domain/locale';
import { canAssignRole, canSeeProject, isProjectScoped, permissionsFor, ROLE_PERMISSIONS } from '../../src/domain/permissions';
import { getPlan, TRIAL_DAYS } from '../../src/domain/plans';
import type {
  AuditEvent, InAppNotification, Invitation, Market, Member, NotificationType, Organisation, OrgSettings, Permission, Project, RequirementDefinition,
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

export const DEFAULT_SETTINGS = (timezone: string, market: Market = 'OTHER', country?: string): OrgSettings => {
  const m = MARKETS.find((x) => x.id === market)!;
  const c = country ? countryDefaults(country) : null;
  const local = c && c.name !== 'Other';
  return {
    timezone, expiringSoonDays: 30, reminderSchedule: [90, 60, 30, 14, 7, 0, -7], escalationDays: 14,
    retentionYears: 7, remindArchived: false, defaultLinkExpiryDays: 14, market, locale: local ? c!.locale : m.locale, currency: local ? c!.currency : m.currency,
  };
};

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
    emailFrom: svc.mail.from,
    extractionConfigured: !!svc.ai,
    intakeConfigured: !!svc.env.resendWebhookSecret && !!svc.inbound && !!svc.env.inboundDomain,
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

export async function seedLibrary(db: Db, orgId: string, now: string, market: Market = 'OTHER') {
  const keyToId = new Map<string, string>();
  for (const r of starterRequirements(market)) {
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
  const market: Market = input.market ? oneOf(input.market, ['US', 'UK', 'OTHER'] as const, 'Market') : marketFromCountry(country);
  const timezone = reqStr(input.timezone, 'Timezone', 64);
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw bad('Unknown timezone'); }
  const personName = str(input.name, 'Your name', { max: 120 }) || identity.name || identity.email.split('@')[0];
  const now = svc.now();
  const orgId = db.newId();
  const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 86_400_000).toISOString();
  const org: Organisation = {
    id: orgId, name, country, createdAt: now.toISOString(), ownerUid: identity.uid, settings: DEFAULT_SETTINGS(timezone, market, country),
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
  if (input.seedLibrary !== false) await seedLibrary(db, orgId, now.toISOString(), market);
  await audit({ db, svc, org, member, source: 'web' }, { action: 'organisation.created', entity: { type: 'organisation', id: orgId, label: name }, after: { name, country, timezone } });
  // Email submission works from day one: the organisation gets its own intake address now.
  const { provisionIntake } = await import('../intake');
  await provisionIntake(svc, org).catch((e) => console.error('intake provisioning failed', orgId, e));
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
  if (input.market !== undefined) s.market = oneOf(input.market, ['US', 'UK', 'OTHER'] as const, 'Market');
  if (input.locale !== undefined) { if (typeof input.locale !== 'string' || !validLocale(input.locale)) throw bad('Choose a supported date format'); s.locale = input.locale; }
  if (input.currency !== undefined) { const cur = String(input.currency).toUpperCase(); if (!validCurrency(cur)) throw bad('Choose a valid currency'); s.currency = cur; }
  if (input.reminderSchedule !== undefined) {
    if (!Array.isArray(input.reminderSchedule) || !input.reminderSchedule.length || input.reminderSchedule.length > 12) throw bad('Reminder schedule needs 1–12 entries');
    s.reminderSchedule = [...new Set(input.reminderSchedule.map((x: any) => n(x, 'Reminder offset', -90, 365)))].sort((a: any, b: any) => b - a) as number[];
  }
  if (input.chasing !== undefined) {
    const c = input.chasing ?? {};
    const after = Array.isArray(c.afterDays) ? [...new Set(c.afterDays.map((x: any) => n(x, 'Follow-up day', 1, 60)))].sort((a: any, b: any) => a - b) as number[] : (s.chasing?.afterDays ?? [3, 7, 14]);
    if (!after.length || after.length > 6) throw bad('Choose between 1 and 6 follow-ups');
    s.chasing = { enabled: c.enabled !== false, afterDays: after, escalateAfterDays: c.escalateAfterDays !== undefined ? n(c.escalateAfterDays, 'Escalation', after[after.length - 1] + 1, 90) : Math.max(after[after.length - 1] + 2, s.chasing?.escalateAfterDays ?? 16) };
  }
  if (input.workingHours !== undefined) {
    const w = input.workingHours ?? {};
    const start = n(w.start, 'Start hour', 0, 23); const end = n(w.end, 'End hour', 1, 24);
    if (end <= start) throw bad('Working hours must end after they start');
    const days = Array.isArray(w.days) ? [...new Set(w.days.map((x: any) => n(x, 'Day', 0, 6)))] as number[] : [1, 2, 3, 4, 5];
    if (!days.length) throw bad('Choose at least one working day');
    s.workingHours = { start, end, days };
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
  // In parallel: marking many as read used to take a database round trip each, one after another.
  const todo = all.filter((n) => !n.readAt && (!want || want.has(n.id)));
  for (let i = 0; i < todo.length; i += 50) await Promise.all(todo.slice(i, i + 50).map((n) => ctx.db.update(C.doc(ctx.org.id, 'notifications', n.id), { readAt: now })));
  return { ok: true };
}

export const NOTIFICATION_TYPES: NotificationType[] = ['request_sent', 'document_submitted', 'awaiting_review', 'document_approved', 'document_rejected', 'info_requested', 'expiring', 'expired', 'status_changed', 'became_non_compliant', 'project_threshold', 'escalation'];

export async function updateNotificationPrefs(ctx: Ctx, input: any) {
  if (input?.digest !== undefined) await ctx.db.update(C.doc(ctx.org.id, 'members', ctx.member.uid), { digest: !!input.digest });
  if (!input?.prefs) return { ok: true };
  const prefs: Member['notificationPrefs'] = {};
  for (const t of NOTIFICATION_TYPES) {
    const v = input?.prefs?.[t];
    if (v) prefs[t] = { inApp: v.inApp !== false, email: !!v.email };
  }
  await ctx.db.update(C.doc(ctx.org.id, 'members', ctx.member.uid), { notificationPrefs: prefs });
  return { ok: true };
}

export async function deliveryLogs(ctx: Ctx) {
  const health = await ctx.db.get<any>(C.doc(ctx.org.id, 'health', 'mail'));
  need(ctx, 'settings.manage');
  const logs = await ctx.db.list<any>(C.col(ctx.org.id, 'deliveryLogs'));
  const problems = await ctx.db.list<any>(C.col(ctx.org.id, 'emailProblems'));
  return { items: logs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 300), health, problems, from: ctx.svc.mail.from, configured: ctx.svc.mail.configured };
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

const MEANINGFUL = /^(document\.(uploaded|replaced|approved|rejected|info_requested|archived)|request\.(sent|portal_invited)|subcontractor\.(created|imported|suspended|archived|restored)|project\.(created|template_applied|subcontractor_assigned)|requirement\.(created|changed|marked_not_applicable)|template\.(created|changed)|member\.(joined|invited)|compliance\.status_changed|notification\.renewal_reminder)$/;

export async function dashboard(ctx: Ctx, input: any) {
  // All independent reads at once (they used to run one after another). Recent activity reads the
  // newest audit entries only, not the whole history.
  const [data, members, emailProblems, intakeWaiting, recentAudit, escalations] = await Promise.all([
    loadOrgData(ctx.db, ctx.org.id),
    ctx.db.list<Member>(C.col(ctx.org.id, 'members')),
    ctx.db.list<any>(C.col(ctx.org.id, 'emailProblems')),
    can(ctx, 'documents.upload') ? ctx.db.list<any>(C.col(ctx.org.id, 'intake'), [['status', '==', 'needs_match']]) : Promise.resolve([]),
    ctx.db.list<AuditEvent>(C.col(ctx.org.id, 'audit'), [], { orderBy: ['at', 'desc'], limit: 300 }),
    ctx.db.list<any>(C.col(ctx.org.id, 'reminders'), [['type', '==', 'escalation']]),
  ]);
  const today = todayIn(ctx.org.settings.timezone, ctx.svc.now());
  const soon = ctx.org.settings.expiringSoonDays;
  let projects = data.projects.filter((p) => !['archived', 'completed'].includes(p.status) && canSeeProject(ctx.member, p));
  if (input?.projectId) projects = projects.filter((p) => p.id === input.projectId);
  const projectIds = new Set(projects.map((p) => p.id));
  const live = (pid: string, sid: string) => data.assignments.some((a) => a.active && a.projectId === pid && a.subcontractorId === sid);
  let rows = data.readiness.filter((r) => projectIds.has(r.projectId) && live(r.projectId, r.subcontractorId));
  if (input?.subcontractorId) rows = rows.filter((r) => r.subcontractorId === input.subcontractorId);

  const assignedSubIds = new Set(data.assignments.filter((a) => a.active && projectIds.has(a.projectId)).map((a) => a.subcontractorId));
  const scopedSubs = data.subs.filter((s) => !['archived'].includes(s.status) && (isProjectScoped(ctx.member) || input?.projectId ? assignedSubIds.has(s.id) : true))
    .filter((s) => !input?.subcontractorId || s.id === input.subcontractorId);
  const worst = new Map<string, string>();
  for (const r of rows) { const c = worst.get(r.subcontractorId); if (!c || readinessRank(r.readiness) < readinessRank(c as any)) worst.set(r.subcontractorId, r.readiness); }
  const subName = new Map(data.subs.map((s) => [s.id, s.legalName]));
  const docById = new Map(data.documents.map((d) => [d.id, d]));
  const defs = new Map(data.requirements.map((r) => [r.id, r]));
  const scopedSubIds = new Set(scopedSubs.map((s) => s.id));

  // Evidence in force and its expiry.
  const inForce = data.versions.filter((v) => v.reviewStatus === 'approved' && scopedSubIds.has(v.subcontractorId) && docById.get(v.documentId)?.approvedVersionId === v.id && !docById.get(v.documentId)?.archived && v.metadata.expiryDate)
    .map((v) => ({ v, days: daysBetween(today, v.metadata.expiryDate!) }));
  const pending = data.versions.filter((v) => scopedSubIds.has(v.subcontractorId) && ['submitted', 'awaiting_review', 'under_review'].includes(v.reviewStatus) && !docById.get(v.documentId)?.archived);
  const isInsurance = (docId: string) => { const d = docById.get(docId); const def = d?.requirementId ? defs.get(d.requirementId) : undefined; return /insur|endorse|indemnity/i.test(`${def?.category ?? ''} ${def?.name ?? ''} ${d?.documentType ?? ''}`); };
  const expired = inForce.filter((x) => x.days < 0);
  const expiring30 = inForce.filter((x) => x.days >= 0 && x.days <= 30);
  const missingSubs = new Set(rows.filter((r) => r.results.some((x) => x.blocking && ['missing', 'requested', 'overdue', 'rejected'].includes(x.status))).map((r) => r.subcontractorId));
  const projectsNotReady = projects.filter((p) => rows.some((r) => r.projectId === p.id && r.readiness === 'not_ready'));

  const projectNamesForSub = (sid: string, docProjectIds: string[]) => {
    const ids = docProjectIds.length ? docProjectIds : data.assignments.filter((a) => a.active && a.subcontractorId === sid).map((a) => a.projectId);
    return ids.map((id) => data.projects.find((p) => p.id === id)).filter((p) => p && p.status !== 'archived').map((p) => p!.name);
  };
  const renewalStage = (v: DocumentVersionLite) => {
    const repl = data.versions.find((x) => x.documentId === v.documentId && x.uploadedAt > v.uploadedAt && ['submitted', 'awaiting_review', 'under_review'].includes(x.reviewStatus));
    if (repl) return { stage: 'replacement_received', replacementVersionId: repl.id };
    const req = data.requests.find((q) => q.renewalOfVersionId === v.id && ['sent', 'acknowledged', 'partially_fulfilled'].includes(q.status));
    return { stage: req ? (req.status === 'acknowledged' ? 'acknowledged' : 'requested') : 'not_requested' };
  };

  const projectSummary = projects.map((p) => {
    const pr = rows.filter((r) => r.projectId === p.id);
    const ready = pr.filter((r) => r.readiness === 'ready').length;
    const manager = undefined as string | undefined;
    return {
      id: p.id, name: p.name, code: p.code, location: p.location, status: p.status, managerUid: p.managerUid, manager,
      assigned: pr.length, ready, action: pr.filter((r) => r.readiness === 'action_required').length, notReady: pr.filter((r) => r.readiness === 'not_ready').length,
      notEvaluated: pr.filter((r) => r.readiness === 'not_evaluated').length, readyPct: pr.length ? Math.round((ready / pr.length) * 100) : null,
      issues: pr.reduce((n, r) => n + r.results.filter((x) => x.blocking).length, 0),
    };
  }).sort((a, b) => (a.readyPct ?? 101) - (b.readyPct ?? 101) || b.notReady - a.notReady);
  for (const p of projectSummary) p.manager = members.find((m) => m.uid === p.managerUid)?.name;

  const attention = [
    { key: 'reviews', label: 'Documents awaiting review', count: pending.length, link: '/app/reviews', action: 'Review' },
    { key: 'missing', label: 'Subcontractors with missing requirements', count: missingSubs.size, link: '/app/subcontractors?issue=outstanding', action: 'Request documents' },
    { key: 'expired', label: 'Expired insurance documents', count: expired.filter((x) => isInsurance(x.v.documentId)).length, link: '/app/renewals?window=expired', action: 'Request renewal' },
    { key: 'expiring', label: 'Documents expiring within 30 days', count: expiring30.length, link: '/app/renewals?window=30', action: 'Plan renewals' },
    { key: 'projects', label: 'Projects with subcontractors not ready', count: projectsNotReady.length, link: '/app/projects?readiness=not_ready', action: 'Open projects' },
  ];

  // Concrete next steps, most urgent first.
  const actions: any[] = [];
  for (const v of pending.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)).slice(0, 5)) actions.push({ kind: 'review', title: `Review ${docById.get(v.documentId)?.title ?? v.fileName}`, detail: subName.get(v.subcontractorId), link: `/app/reviews/${v.id}`, at: v.uploadedAt });
  for (const x of expired.slice(0, 5)) actions.push({ kind: 'expired', title: `${docById.get(x.v.documentId)?.title} expired`, detail: `${subName.get(x.v.subcontractorId)} · ${-x.days} days ago`, link: '/app/renewals?window=expired' });
  const seen = new Set<string>();
  for (const r of rows) for (const x of r.results.filter((y) => y.blocking && ['missing', 'requested', 'overdue', 'rejected'].includes(y.status))) {
    const k = `${r.subcontractorId}:${x.requirementId}`; if (seen.has(k)) continue; seen.add(k);
    actions.push({ kind: x.status, title: `${x.requirementName} ${x.status === 'rejected' ? 'rejected' : x.status === 'overdue' ? 'overdue' : 'outstanding'}`, detail: `${subName.get(r.subcontractorId)} · ${projects.find((p) => p.id === r.projectId)?.name}`, link: `/app/subcontractors/${r.subcontractorId}?tab=requirements&project=${r.projectId}` });
  }

  // "Needs your attention": one row per thing to do — item, issue, action — most urgent first.
  type Need = { tone: 'progress' | 'blocked' | 'attention'; item: string; itemLink: string; context?: string; issue: string; action: string; link: string; rank: number };
  const needs: Need[] = [];
  const pname = (id: string) => projects.find((p) => p.id === id)?.name;
  // Addresses that bounced or complained: chasing has stopped, so a person must act.
  for (const p of emailProblems) {
    const s = data.subs.find((x) => x.contacts.some((c) => c.email.toLowerCase() === p.email));
    needs.push({ tone: 'blocked', item: s?.legalName ?? p.email, itemLink: s ? `/app/subcontractors/${s.id}` : '/app/settings/delivery', context: p.email, issue: p.kind === 'bounced' ? 'Email to this address bounced — reminders have stopped' : 'This address marked our email as spam — reminders have stopped', action: 'Fix contact', link: s ? `/app/subcontractors/${s.id}` : '/app/settings/delivery', rank: 0 });
  }
  // Emailed documents that couldn't be matched with confidence.
  const inbox = intakeWaiting;
  for (const i of inbox.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
    needs.push({ tone: 'attention', item: i.fileName, itemLink: '/app/inbox', context: `from ${i.from}`, issue: i.suggestion?.subcontractorId ? (i.suggestion?.requirementId ? 'Emailed in — confirm where it belongs' : 'Emailed in — choose which document it is') : 'Emailed in from an unknown sender — choose who it’s from', action: 'Match document', link: '/app/inbox', rank: 1 });
  }
  // Documents waiting for a decision, triaged by the automatic comparison.
  const triage = (v: any) => currentTriage(v.assessment, v.extraction?.status);
  // One row per subcontractor, so a batch of uploads reads as one job, not twelve.
  const bySub = new Map<string, any[]>();
  for (const v of [...pending].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))) bySub.set(v.subcontractorId, [...(bySub.get(v.subcontractorId) ?? []), v]);
  for (const [sid, vs] of bySub) {
    const probs = vs.filter((v) => triage(v) === 'problem');
    const good = vs.filter((v) => triage(v) === 'looks_good');
    const other = vs.length - probs.length - good.length;
    const title = (v: any) => docById.get(v.documentId)?.title ?? v.fileName;
    let issue: string;
    if (vs.length === 1) {
      const v = vs[0]; const t = triage(v); const firstFail = v.assessment?.checks.find((c: any) => c.outcome === 'fail');
      issue = t === 'looks_good' ? `${title(v)}: checks passed — confirm to approve` : t === 'problem' ? `${title(v)}: ${firstFail ? firstFail.detail.replace(/\.$/, '') : 'doesn’t meet the requirement'}` : `${title(v)} needs review`;
    } else {
      issue = [probs.length && `${probs.length} ${probs.length === 1 ? 'doesn’t' : 'don’t'} match what you asked for`, good.length && `${good.length} passed the checks`, other && `${other} to check by eye`].filter(Boolean).join(' · ');
      issue = `${vs.length} documents submitted: ${issue}`;
    }
    const first = probs[0] ?? vs.find((v) => triage(v) !== 'looks_good') ?? vs[0];
    needs.push({
      tone: probs.length ? 'blocked' : 'progress', item: subName.get(sid) ?? 'Subcontractor', itemLink: `/app/subcontractors/${sid}`, issue,
      action: !probs.length && !other ? (vs.length === 1 ? 'Confirm' : 'Confirm all') : 'Review', link: !probs.length && !other && vs.length > 1 ? '/app/reviews?confirm=1' : `/app/reviews/${first.id}`, rank: probs.length ? 0 : 1,
    });
  }
  // Only what the user can act on goes in the list. Anything SubCleared is already chasing becomes one quiet line.
  const escalatedRequests = new Set(escalations.map((e: any) => e.requestId).filter(Boolean));
  const waitingSubs = new Set<string>();
  // One line per subcontractor: a check like CIS verification is recorded once and covers every project.
  const checks = new Map<string, { r: typeof rows[number]; names: string[]; first: string; projects: string[] }>();
  const stuck = new Map<string, { r: typeof rows[number]; names: string[] }>();
  for (const r of rows) for (const x of r.results) {
    if (!x.mandatory) continue;
    const def = defs.get(x.requirementId);
    const k = `${r.projectId}:${r.subcontractorId}`;
    if (def && def.kind !== 'document') {
      const ck = r.subcontractorId;
      // A check your team makes: nothing to ask the subcontractor for.
      if (['missing', 'requested', 'overdue', 'expired', 'expiring_soon'].includes(x.status)) { const e = checks.get(ck) ?? { r, names: [], first: x.requirementId, projects: [] }; if (!e.names.includes(x.requirementName)) e.names.push(x.requirementName); const pn = pname(r.projectId); if (pn && !e.projects.includes(pn)) e.projects.push(pn); checks.set(ck, e); }
      continue;
    }
    if (['requested', 'overdue', 'rejected'].includes(x.status)) {
      const open = data.requests.filter((q) => q.subcontractorId === r.subcontractorId && q.requirementIds.includes(x.requirementId) && ['sent', 'acknowledged', 'partially_fulfilled'].includes(q.status));
      if (open.some((q) => escalatedRequests.has(q.id))) { const e = stuck.get(r.subcontractorId) ?? { r, names: [] }; if (!e.names.includes(x.requirementName)) e.names.push(x.requirementName); stuck.set(r.subcontractorId, e); }
      else waitingSubs.add(r.subcontractorId);
    }
  }
  for (const { r, names, first, projects: ps } of checks.values()) needs.push({ tone: 'attention', item: subName.get(r.subcontractorId) ?? '', itemLink: `/app/subcontractors/${r.subcontractorId}`, context: ps.length > 1 ? `${ps.length} projects` : ps[0], issue: `${names.join(', ')}: your team’s check`, action: 'Record check', link: `/app/subcontractors/${r.subcontractorId}?tab=requirements&check=${first}`, rank: 2 });
  for (const { r, names } of stuck.values()) needs.push({ tone: 'blocked', item: subName.get(r.subcontractorId) ?? '', itemLink: `/app/subcontractors/${r.subcontractorId}`, issue: `Still hasn’t sent ${names.join(', ')} after every reminder — may need a call`, action: 'View contact', link: `/app/subcontractors/${r.subcontractorId}`, rank: 2 });
  for (const x of expired) {
    const st = renewalStage(x.v);
    needs.push({ tone: 'blocked', item: subName.get(x.v.subcontractorId) ?? '', itemLink: `/app/subcontractors/${x.v.subcontractorId}`, issue: `${docById.get(x.v.documentId)?.title} expired ${-x.days === 0 ? 'today' : `${-x.days} day${-x.days === 1 ? '' : 's'} ago`}${st.stage === 'requested' ? ' — renewal requested' : ''}`, action: st.stage === 'replacement_received' ? 'Review replacement' : st.stage === 'not_requested' ? 'Request renewal' : 'View', link: st.stage === 'replacement_received' ? `/app/reviews/${(st as any).replacementVersionId}` : '/app/renewals?window=expired', rank: 3 });
  }
  for (const p of projects) {
    const pr = rows.filter((r) => r.projectId === p.id);
    const hasReqs = data.projectRequirements.some((x) => x.projectId === p.id && x.active);
    if (!hasReqs && pr.length) { needs.push({ tone: 'blocked', item: p.name, itemLink: `/app/projects/${p.id}`, issue: 'No paperwork chosen, so nothing can be requested', action: 'Choose paperwork', link: `/app/projects/${p.id}?tab=requirements`, rank: 4 }); continue; }
    const toRequest = pr.filter((r) => r.results.some((x) => ['missing', 'not_requested'].includes(x.status) && defs.get(x.requirementId)?.kind === 'document'));
    if (toRequest.length) needs.push({ tone: 'blocked', item: p.name, itemLink: `/app/projects/${p.id}`, issue: `${toRequest.length} subcontractor${toRequest.length === 1 ? ' needs' : 's need'} asking for paperwork`, action: 'Request paperwork', link: `/app/projects/${p.id}`, rank: 4 });
  }
  // Expiring evidence is renewed automatically; only list it when no renewal could be requested.
  let renewing = 0;
  for (const x of [...expiring30].sort((a, b) => a.days - b.days)) {
    const st = renewalStage(x.v);
    if (st.stage === 'not_requested') needs.push({ tone: 'attention', item: subName.get(x.v.subcontractorId) ?? '', itemLink: `/app/subcontractors/${x.v.subcontractorId}`, issue: `${docById.get(x.v.documentId)?.title} expires ${x.days === 0 ? 'today' : `in ${x.days} day${x.days === 1 ? '' : 's'}`}`, action: 'Request renewal', link: '/app/renewals?window=30', rank: 7 });
    else renewing++;
  }
  needs.sort((a, b) => a.rank - b.rank);
  const waiting = { subcontractors: waitingSubs.size, renewals: renewing };

  const recent = recentAudit.filter((e) => MEANINGFUL.test(e.action)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  return {
    today, firstName: (ctx.member.name || '').split(' ')[0] || '',
    metrics: {
      activeProjects: projects.length,
      activeSubcontractors: scopedSubs.length,
      ready: [...scopedSubs].filter((s) => worst.get(s.id) === 'ready').length,
      attention: [...scopedSubs].filter((s) => ['not_ready', 'action_required'].includes(worst.get(s.id) ?? '')).length,
      notReady: [...scopedSubs].filter((s) => worst.get(s.id) === 'not_ready').length,
      notEvaluated: [...scopedSubs].filter((s) => !worst.get(s.id) || worst.get(s.id) === 'not_evaluated').length,
    },
    review: { total: pending.length, looksGood: pending.filter((v) => triage(v) === 'looks_good').length, toCheck: pending.filter((v) => ['check', 'not_read'].includes(triage(v))).length, problems: pending.filter((v) => triage(v) === 'problem').length },
    inbox: inbox.length, readingOn: !!ctx.svc.ai,
    mailHealth: can(ctx, 'settings.manage') ? await ctx.db.get<any>(C.doc(ctx.org.id, 'health', 'mail')) : null,
    attention, actions: actions.slice(0, 8), actionsTotal: actions.length, needs: input?.full ? needs : needs.slice(0, 12), needsTotal: needs.length, waiting,
    projects: projectSummary,
    upcoming: inForce.filter((x) => x.days <= Math.max(Number(input?.days) || 60, soon)).sort((a, b) => a.days - b.days).slice(0, 8).map((x) => ({
      versionId: x.v.id, documentId: x.v.documentId, title: docById.get(x.v.documentId)?.title, subcontractor: subName.get(x.v.subcontractorId), subcontractorId: x.v.subcontractorId,
      projects: projectNamesForSub(x.v.subcontractorId, docById.get(x.v.documentId)?.projectIds ?? []), expiryDate: x.v.metadata.expiryDate, days: x.days, ...renewalStage(x.v),
    })),
    recent,
    hasRequirements: data.requirements.length > 0, hasProjects: data.projects.length > 0, hasSubs: data.subs.length > 0,
    hasAssignments: data.assignments.some((a) => a.active), hasRequests: data.requests.length > 0, hasSample: !!ctx.org.hasSample,
  };
}

type DocumentVersionLite = { id: string; documentId: string; uploadedAt: string };

export { addDays };

/** Small numbers for the sidebar's "Work to do" group: documents waiting for a decision and renewals needing action. */
export async function navCounts(ctx: Ctx) {
  const canIntake = permissionsFor(ctx.member).has('documents.upload');
  const [data, intake, notes] = await Promise.all([
    loadOrgData(ctx.db, ctx.org.id, ['subs', 'projects', 'assignments', 'documents', 'versions']),
    canIntake ? ctx.db.list<any>(C.col(ctx.org.id, 'intake'), [['status', '==', 'needs_match']]) : Promise.resolve([]),
    ctx.db.list<InAppNotification>(C.col(ctx.org.id, 'notifications'), [['recipientUid', '==', ctx.member.uid]]),
  ]);
  const { visibleSubIds } = await import('./subs');
  const visible = visibleSubIds(ctx, data);
  const docs = new Map(data.documents.map((d) => [d.id, d]));
  const today = todayIn(ctx.org.settings.timezone, ctx.svc.now());
  const mine = (sid: string) => !visible || visible.has(sid);
  const reviews = permissionsFor(ctx.member).has('documents.review')
    ? data.versions.filter((v) => mine(v.subcontractorId) && ['submitted', 'awaiting_review', 'under_review'].includes(v.reviewStatus) && !docs.get(v.documentId)?.archived).length
    : 0;
  const renewals = data.versions.filter((v) => {
    const d = docs.get(v.documentId);
    if (!d || d.archived || d.approvedVersionId !== v.id || !v.metadata.expiryDate || !mine(v.subcontractorId)) return false;
    return daysBetween(today, v.metadata.expiryDate) <= ctx.org.settings.expiringSoonDays;
  }).length;
  return { reviews, renewals, inbox: canIntake ? intake.length : 0, unread: notes.filter((n) => !n.readAt).length };
}
