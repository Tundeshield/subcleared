import type { Member, Permission, Project, Role } from './types';

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  compliance_manager: 'Compliance manager',
  project_manager: 'Project manager',
  project_admin: 'Project administrator',
  reviewer: 'Reviewer',
  read_only: 'Read-only',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Full organisation access, including billing and ownership.',
  admin: 'Organisation configuration and user management.',
  compliance_manager: 'Runs the full compliance workflow: requirements, requests, reviews.',
  project_manager: 'Sees assigned projects and their subcontractors.',
  project_admin: 'Collects paperwork and chases outstanding items on assigned projects.',
  reviewer: 'Reviews documents and records approval or rejection decisions.',
  read_only: 'Views records and reports without making changes.',
};

const ALL: Permission[] = [
  'org.manage', 'users.manage', 'billing.manage', 'projects.create', 'projects.edit', 'projects.archive',
  'projects.view_all', 'subs.manage', 'subs.notes', 'requirements.manage', 'requirements.override',
  'documents.upload', 'documents.review', 'documents.verify', 'documents.archive', 'requests.send',
  'reports.view', 'audit.view', 'settings.manage',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  // Subscription ownership stays with the owner.
  admin: ALL.filter((p) => p !== 'billing.manage'),
  compliance_manager: [
    'projects.create', 'projects.edit', 'projects.view_all', 'subs.manage', 'subs.notes',
    'requirements.manage', 'requirements.override', 'documents.upload', 'documents.review',
    'documents.verify', 'documents.archive', 'requests.send', 'reports.view', 'audit.view',
  ],
  project_manager: ['projects.edit', 'subs.notes', 'documents.upload', 'requests.send', 'reports.view'],
  project_admin: ['subs.manage', 'subs.notes', 'documents.upload', 'requests.send', 'reports.view'],
  reviewer: ['projects.view_all', 'subs.notes', 'documents.review', 'documents.verify', 'reports.view'],
  read_only: ['projects.view_all', 'reports.view'],
};

/** Roles whose visibility is limited to projects they are assigned to. */
export const PROJECT_SCOPED_ROLES: Role[] = ['project_manager', 'project_admin'];

export function permissionsFor(member: Pick<Member, 'role' | 'extraPermissions' | 'revokedPermissions'>): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[member.role] ?? []);
  for (const p of member.extraPermissions ?? []) set.add(p);
  for (const p of member.revokedPermissions ?? []) set.delete(p);
  return set;
}

export function can(member: Pick<Member, 'role' | 'extraPermissions' | 'revokedPermissions' | 'status'> | null | undefined, perm: Permission): boolean {
  if (!member || member.status !== 'active') return false;
  return permissionsFor(member).has(perm);
}

export function isProjectScoped(member: Pick<Member, 'role' | 'extraPermissions' | 'revokedPermissions'>): boolean {
  return !permissionsFor(member).has('projects.view_all') && PROJECT_SCOPED_ROLES.includes(member.role);
}

export function canSeeProject(member: Member, project: Pick<Project, 'managerUid' | 'adminUids'>): boolean {
  if (member.status !== 'active') return false;
  if (!isProjectScoped(member)) return true;
  return project.managerUid === member.uid || (project.adminUids ?? []).includes(member.uid);
}

/** Only owners can grant ownership; admins cannot promote to owner. */
export function canAssignRole(actor: Member, role: Role): boolean {
  if (!can(actor, 'users.manage')) return false;
  if (role === 'owner') return actor.role === 'owner';
  return true;
}
