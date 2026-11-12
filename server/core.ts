import crypto from 'node:crypto';
import { can, canSeeProject } from '../src/domain/permissions';
import type { AuditEvent, InAppNotification, Member, NotificationType, Organisation, Permission, Project } from '../src/domain/types';
import type { Db } from './db';
import type { Identity, Services } from './services';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
export const bad = (m: string) => new HttpError(400, m, 'bad_request');
export const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, m, 'forbidden');
export const notFound = (m = 'Not found') => new HttpError(404, m, 'not_found');
export const conflict = (m: string) => new HttpError(409, m, 'conflict');

export const C = {
  org: (o: string) => `orgs/${o}`,
  col: (o: string, name: string) => `orgs/${o}/${name}`,
  doc: (o: string, name: string, id: string) => `orgs/${o}/${name}/${id}`,
  user: (uid: string) => `users/${uid}`,
};

export const ORG_COLLECTIONS = [
  'members', 'invitations', 'projects', 'subcontractors', 'notes', 'requirements', 'requirementVersions', 'templates',
  'templateVersions', 'projectRequirements', 'assignments', 'overrides', 'documents', 'versions', 'reviews', 'verifications',
  'readiness', 'evaluations', 'requests', 'links', 'notifications', 'deliveryLogs', 'reminders', 'audit', 'billing', 'uploads', 'views',
  'intake', 'aiUsage', 'intakeMessages', 'health', 'emailProblems',
] as const;

export interface Ctx {
  svc: Services;
  db: Db;
  identity: Identity;
  org: Organisation;
  member: Member;
  ip?: string;
  source: AuditEvent['source'];
}

export function need(ctx: Ctx, perm: Permission) {
  if (!can(ctx.member, perm)) throw forbidden();
}

export function requireProjectAccess(ctx: Ctx, project: Project) {
  if (!canSeeProject(ctx.member, project)) throw notFound('Project not found');
}

export function nowIso(ctx: { svc: Services }) { return ctx.svc.now().toISOString(); }

export function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
export function sha256(s: string | Uint8Array) { return crypto.createHash('sha256').update(s).digest('hex'); }

export function str(v: unknown, field: string, { required = false, max = 500 } = {}): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw bad(`${field} must be text`);
  const t = v.trim();
  if (required && !t) throw bad(`${field} is required`);
  if (t.length > max) throw bad(`${field} is too long (max ${max} characters)`);
  return t;
}
export function reqStr(v: unknown, field: string, max = 500): string { return str(v, field, { required: true, max })!; }
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function email(v: unknown, field = 'Email'): string {
  const e = reqStr(v, field, 254).toLowerCase();
  if (!EMAIL_RE.test(e)) throw bad(`${field} is not a valid email address`);
  return e;
}
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(v as T)) throw bad(`${field} must be one of: ${allowed.join(', ')}`);
  return v as T;
}
export function ids(v: unknown, field: string, max = 500): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x.length > 128 || x.includes('/'))) throw bad(`${field} must be a list of ids`);
  if (v.length > max) throw bad(`${field} has too many items`);
  return [...new Set(v as string[])];
}
export function id(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v || v.length > 200 || v.includes('/')) throw bad(`${field} is invalid`);
  return v;
}

export async function audit(ctx: Pick<Ctx, 'db' | 'org' | 'svc'> & Partial<Pick<Ctx, 'member' | 'source' | 'ip'>>, ev: {
  action: string; entity: AuditEvent['entity']; before?: unknown; after?: unknown;
  actor?: AuditEvent['actor']; source?: AuditEvent['source']; refs?: string[];
}) {
  const evId = ctx.db.newId();
  const event: AuditEvent = {
    id: evId,
    at: ctx.svc.now().toISOString(),
    actor: ev.actor ?? (ctx.member ? { type: 'user', id: ctx.member.uid, name: ctx.member.name || ctx.member.email } : { type: 'system', id: 'system', name: 'SubCleared' }),
    action: ev.action,
    entity: ev.entity,
    before: ev.before === undefined ? undefined : pruneForAudit(ev.before),
    after: ev.after === undefined ? undefined : pruneForAudit(ev.after),
    source: ev.source ?? ctx.source ?? 'web',
    ip: ctx.ip,
    refs: [...new Set([ev.entity.id, ...(ev.refs ?? [])])],
  } as AuditEvent & { refs: string[] };
  await ctx.db.create(C.doc(ctx.org.id, 'audit', evId), event as any);
  return event;
}

function pruneForAudit(v: unknown): unknown {
  const s = JSON.stringify(v ?? null);
  if (s.length <= 8000) return JSON.parse(s);
  return { truncated: true, preview: s.slice(0, 2000) };
}

/** Before/after diff of changed top-level fields only. */
export function diff(before: Record<string, any>, after: Record<string, any>) {
  const b: Record<string, any> = {};
  const a: Record<string, any> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (['updatedAt'].includes(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) { b[k] = before[k]; a[k] = after[k]; }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}

/** In-app notification with per-member preferences and idempotency. */
export async function notifyMembers(ctx: Pick<Ctx, 'db' | 'org' | 'svc'>, uids: string[], n: { type: NotificationType; title: string; body: string; link?: string; dedupeKey?: string }) {
  const members = (await ctx.db.getMany<Member>([...new Set(uids)].map((u) => C.doc(ctx.org.id, 'members', u)))).filter(Boolean) as Member[];
  for (const m of members) {
    if (m.status !== 'active') continue;
    const pref = m.notificationPrefs?.[n.type];
    if (pref && pref.inApp === false) continue;
    const nid = n.dedupeKey ? sha256(`${m.uid}:${n.dedupeKey}`).slice(0, 24) : ctx.db.newId();
    const doc: InAppNotification = { id: nid, recipientUid: m.uid, type: n.type, title: n.title, body: n.body, link: n.link, createdAt: ctx.svc.now().toISOString(), dedupeKey: n.dedupeKey };
    try { await ctx.db.create(C.doc(ctx.org.id, 'notifications', nid), doc as any); } catch { /* duplicate — already notified */ }
    if (pref?.email) {
      const { sendEmail } = await import('./email');
      await sendEmail(ctx, { to: m.email, template: `member.${n.type}`, subject: n.title, heading: n.title, body: n.body, cta: n.link ? { label: 'Open in SubCleared', url: `${ctx.svc.env.appUrl}${n.link}` } : undefined, dedupeKey: n.dedupeKey ? `${m.uid}:${n.dedupeKey}` : undefined });
    }
  }
}

export async function membersWith(ctx: Pick<Ctx, 'db' | 'org'>, perm: Permission): Promise<Member[]> {
  const all = await ctx.db.list<Member>(C.col(ctx.org.id, 'members'), [['status', '==', 'active']]);
  return all.filter((m) => can(m, perm));
}

/** Fixed-window rate limiter stored in the database (works across instances). */
export async function rateLimit(db: Db, key: string, limit: number, windowSeconds: number, now: Date) {
  const window = Math.floor(now.getTime() / 1000 / windowSeconds);
  const path = `rateLimits/${sha256(`${key}:${window}`).slice(0, 32)}`;
  const count = await db.transaction(async (tx) => {
    const cur = await tx.get<{ count: number }>(path);
    const next = (cur?.count ?? 0) + 1;
    tx.set(path, { count: next, key: key.slice(0, 80), expiresAt: new Date((window + 1) * windowSeconds * 1000).toISOString() });
    return next;
  });
  if (count > limit) throw new HttpError(429, 'Too many requests. Please wait a moment and try again.', 'rate_limited');
}
