// Single API router used by the Netlify function (production) and the local
// dev server. Every organisation action resolves the caller's membership from
// the verified ID token and the x-org-id header before any handler runs.
import type { Member, Organisation } from '../src/domain/types';
import { C, type Ctx, HttpError, rateLimit } from './core';
import * as billing from './handlers/billing';
import * as docs from './handlers/documents';
import * as org from './handlers/org';
import * as projects from './handlers/projects';
import * as reports from './handlers/reports';
import * as requests from './handlers/requests';
import * as reqs from './handlers/requirements';
import * as subs from './handlers/subs';
import * as portal from './portal';
import type { Identity, Services } from './services';

type OrgHandler = (ctx: Ctx, input: any) => Promise<unknown>;

const ORG_ACTIONS: Record<string, OrgHandler> = {
  'org.settings': org.getSettings, 'org.updateSettings': org.updateSettings, 'members.list': org.listMembers, 'members.invite': org.inviteMember,
  'members.update': org.updateMember, 'invitations.revoke': org.revokeInvitation, 'notifications.list': org.listNotifications,
  'notifications.mark': org.markNotifications, 'notifications.prefs': org.updateNotificationPrefs, 'deliveryLogs.list': org.deliveryLogs,
  'audit.list': org.listAudit, search: org.search, dashboard: org.dashboard,
  'projects.list': projects.listProjects, 'projects.get': projects.getProjectDetail, 'projects.create': projects.createProject,
  'projects.update': projects.updateProject, 'projects.archive': projects.setProjectArchived, 'projects.assign': projects.assignSubcontractors,
  'projects.unassign': projects.removeSubcontractor, 'projects.applyTemplate': projects.applyTemplate, 'projects.setRequirement': projects.setProjectRequirement,
  'subs.list': subs.listSubs, 'subs.get': subs.getSubDetail, 'subs.create': subs.createSub, 'subs.update': subs.updateSub, 'subs.setStatus': subs.setSubStatus,
  'subs.addNote': subs.addNote, 'subs.import': subs.importSubs,
  'requirements.list': reqs.listRequirements, 'requirements.history': reqs.requirementHistory, 'requirements.create': reqs.createRequirement,
  'requirements.update': reqs.updateRequirement, 'templates.save': reqs.saveTemplate, 'overrides.set': reqs.setOverride, 'overrides.revoke': reqs.revokeOverride,
  'uploads.create': docs.createUpload, 'uploads.finalize': docs.finalizeUpload, 'files.url': docs.fileUrl, 'documents.list': docs.listDocuments,
  'documents.get': docs.getDocument, 'documents.update': docs.updateDocument, 'reviews.queue': docs.reviewQueue, 'reviews.get': docs.getReview,
  'reviews.claim': docs.claimReview, 'reviews.saveMetadata': docs.saveMetadata, 'reviews.decide': docs.decideReview, 'reviews.verify': docs.recordVerification,
  'requests.create': requests.createRequest, 'requests.list': requests.listRequests, 'requests.resend': requests.resendRequest, 'links.revoke': requests.revokeLink,
  'renewals.list': requests.listRenewals, 'renewals.request': requests.requestRenewals,
  'reports.run': reports.runReport, 'compliance.overview': reports.complianceOverview, 'compliance.history': reports.evaluationHistory,
  'billing.get': billing.getBilling, 'billing.checkout': billing.createCheckout, 'billing.portal': billing.createPortal,
};

const PORTAL_ACTIONS: Record<string, (svc: Services, db: any, input: any, ip?: string) => Promise<unknown>> = {
  'portal.open': portal.portalOpen, 'portal.state': portal.portalState, 'portal.uploadCreate': portal.portalUploadCreate,
  'portal.uploadFinalize': portal.portalUploadFinalize, 'portal.updateContact': portal.portalUpdateContact, 'portal.fileUrl': portal.portalFileUrl,
};

export interface ApiRequest { action: string; input: any; authorization?: string | null; orgId?: string | null; ip?: string }
export interface ApiResponse { status: number; body: unknown }

export const ACTION_NAMES = [...Object.keys(ORG_ACTIONS), ...Object.keys(PORTAL_ACTIONS), 'me', 'me.update', 'org.register', 'invitations.accept'];

export async function handleApi(svc: Services, req: ApiRequest): Promise<ApiResponse> {
  try {
    const body = await dispatch(svc, req);
    return { status: 200, body: body ?? { ok: true } };
  } catch (e: any) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message, code: e.code } };
    if (e?.code === 'auth/id-token-expired' || e?.code === 'auth/id-token-revoked' || e?.code === 'auth/argument-error') return { status: 401, body: { error: 'Your session has expired. Please sign in again.', code: 'unauthenticated' } };
    console.error(`[api] ${req.action} failed`, e);
    return { status: 500, body: { error: 'Something went wrong on our side. The error has been logged.', code: 'internal' } };
  }
}

async function dispatch(svc: Services, req: ApiRequest) {
  const { action } = req;
  const input = req.input ?? {};
  if (typeof action !== 'string' || action.length > 60) throw new HttpError(400, 'Unknown action');

  if (PORTAL_ACTIONS[action]) {
    if (req.ip) await rateLimit(svc.db, `portal-ip:${req.ip}`, 600, 600, svc.now());
    return PORTAL_ACTIONS[action](svc, svc.db, input, req.ip);
  }

  const token = req.authorization?.startsWith('Bearer ') ? req.authorization.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please sign in', 'unauthenticated');
  let identity: Identity;
  try { identity = await svc.auth.verify(token); } catch (e: any) { throw new HttpError(401, 'Your session has expired. Please sign in again.', 'unauthenticated'); }
  await rateLimit(svc.db, `user:${identity.uid}`, 1200, 300, svc.now());

  if (action === 'me') return org.me(svc, svc.db, identity, req.orgId ?? undefined);
  if (action === 'me.update') return org.updateProfile(svc, svc.db, identity, input);
  if (action === 'org.register') { await rateLimit(svc.db, `register:${identity.uid}`, 5, 3600, svc.now()); return org.registerOrg(svc, svc.db, identity, input); }
  if (action === 'invitations.accept') return org.acceptInvitation(svc, svc.db, identity, input);

  const handler = ORG_ACTIONS[action];
  if (!handler) throw new HttpError(404, 'Unknown action');
  const orgId = req.orgId;
  if (!orgId || orgId.includes('/')) throw new HttpError(400, 'No organisation selected', 'no_org');
  const [o, member] = await svc.db.getMany<any>([C.org(orgId), C.doc(orgId, 'members', identity.uid)]) as [Organisation | null, Member | null];
  // Same response for "no such org" and "not a member": no tenant enumeration.
  if (!o || !member || member.status !== 'active') throw new HttpError(403, 'You do not have access to this organisation', 'no_access');
  const ctx: Ctx = { svc, db: svc.db, identity, org: o, member, ip: req.ip, source: 'web' };
  return handler(ctx, input);
}
