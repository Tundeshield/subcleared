// SubCleared core domain types. Shared by the web client and the server.
// Dates that come from documents (issue/expiry) are stored as plain calendar
// dates ("YYYY-MM-DD") exactly as supplied, never shifted through timezones.
// System timestamps are ISO-8601 UTC strings.

export type ISODate = string; // YYYY-MM-DD
export type Timestamp = string; // ISO-8601 UTC

export type Role =
  | 'owner'
  | 'admin'
  | 'compliance_manager'
  | 'project_manager'
  | 'project_admin'
  | 'reviewer'
  | 'read_only';

export interface OrgSettings {
  timezone: string; // IANA, e.g. "Europe/London"
  expiringSoonDays: number; // documents expiring within N days need attention
  reminderSchedule: number[]; // days before expiry (negative = after expiry)
  escalationDays: number; // notify PM when a mandatory item stays missing this long
  retentionYears: number; // minimum retention for superseded evidence
  remindArchived: boolean;
  defaultLinkExpiryDays: number;
  market?: Market; // drives terminology and starter templates
  locale?: string; // BCP 47, e.g. en-US, en-GB, en-AU — date format and spelling
  currency?: string; // ISO 4217, used for coverage limits
}

export type Market = 'US' | 'UK' | 'OTHER';

export interface Subscription {
  plan: string;
  interval: 'month' | 'year';
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
  trialEndsAt?: Timestamp;
  currentPeriodEnd?: Timestamp;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  cancelAtPeriodEnd?: boolean;
}

export interface Organisation {
  id: string;
  name: string;
  country: string;
  createdAt: Timestamp;
  ownerUid: string;
  settings: OrgSettings;
  subscription: Subscription;
  demo?: boolean;
  hasSample?: boolean;
}

export interface Member {
  uid: string;
  email: string;
  name: string;
  role: Role;
  status: 'active' | 'deactivated';
  extraPermissions?: Permission[];
  revokedPermissions?: Permission[];
  joinedAt: Timestamp;
  notificationPrefs?: Partial<Record<NotificationType, { inApp: boolean; email: boolean }>>;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invitedBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  tokenHash: string;
}

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'archived';

export interface Project {
  id: string;
  name: string;
  code: string;
  description: string;
  location: string;
  address: string;
  status: ProjectStatus;
  startDate?: ISODate;
  endDate?: ISODate;
  managerUid?: string;
  adminUids: string[];
  templateRefs: { templateId: string; version: number; appliedAt: Timestamp }[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  sample?: boolean;
}

export type SubStatus = 'invited' | 'onboarding' | 'active' | 'attention' | 'suspended' | 'archived';

export type ContactRole = 'owner' | 'administrator' | 'compliance' | 'project' | 'submission';

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone?: string;
  roles: ContactRole[];
  primary?: boolean;
  portalAccess?: boolean;
}

export interface Subcontractor {
  id: string;
  legalName: string;
  tradingName?: string;
  registrationNumber?: string;
  companyType?: string;
  trade: string;
  subTypes: string[]; // used to match requirement applicability (e.g. "electrical")
  address?: string;
  country?: string;
  jurisdiction?: string;
  contacts: Contact[];
  tags: string[];
  onboardingDate?: ISODate;
  status: SubStatus;
  ownerUid?: string; // internal person responsible
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastActivityAt?: Timestamp;
  sample?: boolean;
}

export type RequirementKind = 'document' | 'declaration' | 'manual_check';

export type CriterionType = 'min_amount' | 'boolean' | 'text_present' | 'text_equals';

export interface Criterion {
  key: string; // metadata field, e.g. "glEachOccurrence"
  label: string;
  type: CriterionType;
  value?: number | string | boolean;
  currency?: string;
}

export interface RequirementDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  kind: RequirementKind;
  jurisdiction?: string;
  subTypes: string[]; // empty = all
  defaultMandatory: boolean;
  documentType?: string;
  expiryRequired: boolean;
  renewal: 'none' | 'on_expiry' | 'annual' | 'periodic';
  renewalPeriodDays?: number; // for declarations / periodic checks
  reviewRequired: boolean;
  criteria: Criterion[];
  instructions?: string;
  active: boolean;
  version: number;
  updatedAt: Timestamp;
  createdAt: Timestamp;
}

export interface TemplateItem {
  requirementId: string;
  mandatory: boolean;
}

export interface RequirementTemplate {
  id: string;
  name: string;
  description: string;
  items: TemplateItem[];
  version: number;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProjectRequirement {
  id: string;
  projectId: string;
  requirementId: string;
  mandatory: boolean;
  source: { type: 'template'; templateId: string; version: number } | { type: 'manual' };
  active: boolean;
  addedAt: Timestamp;
  addedBy: string;
}

export interface Assignment {
  id: string; // `${projectId}__${subcontractorId}`
  projectId: string;
  subcontractorId: string;
  active: boolean;
  assignedAt: Timestamp;
  assignedBy: string;
  removedAt?: Timestamp;
}

/** Per-subcontractor requirement decisions (not applicable, manual confirmations). */
export interface RequirementOverride {
  id: string; // `${scope}__${subcontractorId}__${requirementId}` (scope = projectId or "all")
  scope: string;
  subcontractorId: string;
  requirementId: string;
  type: 'not_applicable' | 'manual_confirmation';
  reason: string;
  decidedBy: { uid: string; name: string };
  decidedAt: Timestamp;
  validUntil?: ISODate; // for periodic declarations
  revoked?: boolean;
  value?: Record<string, string | number | boolean>;
}

export type ReviewStatus =
  | 'uploading'
  | 'submitted'
  | 'awaiting_review'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'info_requested'
  | 'superseded'
  | 'archived'
  | 'quarantined';

export type VerificationLevel = 'received' | 'reviewed' | 'independently_verified';

export interface DocumentMetadata {
  title?: string;
  documentType?: string;
  namedInsured?: string;
  issuer?: string;
  referenceNumber?: string;
  issueDate?: ISODate;
  expiryDate?: ISODate;
  jurisdiction?: string;
  coverageType?: string;
  // structured values used by criteria (e.g. limits)
  values?: Record<string, number | string | boolean>;
}

export interface ExtractedField {
  value: string | number | boolean | null;
  confidence: number; // 0..1
  note?: string;
}

export interface Extraction {
  status: 'not_started' | 'queued' | 'processing' | 'completed' | 'failed' | 'not_configured';
  fields?: Record<string, ExtractedField>;
  error?: string;
  model?: string;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
}

/** A logical document slot: one subcontractor + one requirement (or ad-hoc type). */
export interface DocumentRecord {
  id: string;
  subcontractorId: string;
  requirementId?: string;
  title: string;
  documentType?: string;
  projectIds: string[]; // empty = applies to every project that needs it
  currentVersionId?: string; // latest submitted version
  approvedVersionId?: string; // latest approved version (the evidence in force)
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  subcontractorId: string;
  requirementId?: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  size: number;
  sha256?: string;
  storagePath?: string;
  uploadedAt: Timestamp;
  uploadedBy: { type: 'user' | 'portal'; id: string; name: string };
  scan: { status: 'pending' | 'clean' | 'rejected'; method?: string; detail?: string };
  extraction: Extraction;
  metadata: DocumentMetadata; // confirmed (official) metadata
  reviewStatus: ReviewStatus;
  verification: VerificationLevel;
  lock?: { uid: string; name: string; at: Timestamp };
  review?: {
    decision: 'approved' | 'rejected' | 'info_requested';
    reason?: string;
    reviewerUid: string;
    reviewerName: string;
    at: Timestamp;
    requirementVersion?: number;
  };
  supersededBy?: string;
  revision: number; // optimistic concurrency counter
}

export interface ReviewRecord {
  id: string;
  versionId: string;
  documentId: string;
  subcontractorId: string;
  decision: 'approved' | 'rejected' | 'info_requested' | 'comment';
  reason?: string;
  internalComment?: string;
  checklist?: { key: string; label: string; passed: boolean | null }[];
  metadataBefore?: DocumentMetadata;
  metadataAfter?: DocumentMetadata;
  requirementId?: string;
  requirementVersion?: number;
  reviewerUid: string;
  reviewerName: string;
  at: Timestamp;
}

export interface VerificationRecord {
  id: string;
  versionId: string;
  method: 'broker_confirmation' | 'insurer_confirmation' | 'register_lookup' | 'other';
  source: string; // who confirmed: e.g. broker name / register URL
  reference: string; // confirmation reference
  notes?: string;
  verifiedBy: { uid: string; name: string };
  at: Timestamp;
}

export type RequirementStatus =
  | 'not_requested'
  | 'missing'
  | 'requested'
  | 'submitted'
  | 'awaiting_review'
  | 'approved'
  | 'expiring_soon'
  | 'expired'
  | 'rejected'
  | 'overdue'
  | 'not_applicable'
  | 'review_required';

export type Readiness = 'ready' | 'action_required' | 'not_ready' | 'not_evaluated';

export interface RequirementResult {
  requirementId: string;
  requirementName: string;
  requirementVersion: number;
  mandatory: boolean;
  status: RequirementStatus;
  blocking: boolean;
  reason: string;
  documentId?: string;
  versionId?: string;
  expiryDate?: ISODate;
  daysToExpiry?: number;
}

export interface Evaluation {
  projectId: string;
  subcontractorId: string;
  readiness: Readiness;
  summary: string;
  reasons: string[];
  results: RequirementResult[];
  counts: { required: number; satisfied: number; missing: number; expiring: number; pending: number };
  evaluatedAt: Timestamp;
  ruleSnapshot: {
    requirements: { requirementId: string; version: number; mandatory: boolean; criteria: Criterion[] }[];
    expiringSoonDays: number;
    today: ISODate;
    timezone: string;
  };
  hash: string;
}

export type RequestStatus = 'sent' | 'acknowledged' | 'partially_fulfilled' | 'fulfilled' | 'cancelled' | 'expired';

export interface DocumentRequest {
  id: string;
  type: 'request' | 'renewal' | 'portal_access';
  subcontractorId: string;
  contactId?: string;
  contactEmail: string;
  contactName?: string;
  projectIds: string[];
  requirementIds: string[];
  message?: string;
  dueDate?: ISODate;
  status: RequestStatus;
  linkId: string;
  createdBy: { uid: string; name: string };
  createdAt: Timestamp;
  acknowledgedAt?: Timestamp;
  fulfilledAt?: Timestamp;
  renewalOfVersionId?: string;
}

/** Visible mirror of an external link; the secret token itself is never stored. */
export interface PortalLink {
  id: string;
  tokenHash: string;
  requestId?: string;
  subcontractorId: string;
  contactEmail: string;
  scope: { requirementIds: string[]; projectIds: string[]; fullPortal: boolean };
  requireEmailCode: boolean;
  expiresAt: Timestamp;
  revokedAt?: Timestamp;
  revokedBy?: string;
  createdAt: Timestamp;
  createdBy: string;
  lastUsedAt?: Timestamp;
  useCount: number;
}

export type NotificationType =
  | 'request_sent'
  | 'document_submitted'
  | 'awaiting_review'
  | 'document_approved'
  | 'document_rejected'
  | 'info_requested'
  | 'expiring'
  | 'expired'
  | 'status_changed'
  | 'became_non_compliant'
  | 'project_threshold'
  | 'escalation';

export interface InAppNotification {
  id: string;
  recipientUid: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  createdAt: Timestamp;
  readAt?: Timestamp;
  dedupeKey?: string;
}

export interface DeliveryLog {
  id: string;
  channel: 'email' | 'in_app' | 'sms';
  to: string;
  template: string;
  subject?: string;
  status: 'queued' | 'sent' | 'failed' | 'skipped' | 'dev_logged';
  error?: string;
  providerId?: string;
  attempts: number;
  dedupeKey?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AuditEvent {
  id: string;
  at: Timestamp;
  actor: { type: 'user' | 'subcontractor' | 'system'; id: string; name: string };
  action: string;
  entity: { type: string; id: string; label?: string };
  before?: unknown;
  after?: unknown;
  source: 'web' | 'portal' | 'api' | 'scheduler' | 'webhook' | 'import';
  ip?: string;
}

export type Permission =
  | 'org.manage'
  | 'users.manage'
  | 'billing.manage'
  | 'projects.create'
  | 'projects.edit'
  | 'projects.archive'
  | 'projects.view_all'
  | 'subs.manage'
  | 'subs.notes'
  | 'requirements.manage'
  | 'requirements.override'
  | 'documents.upload'
  | 'documents.review'
  | 'documents.verify'
  | 'documents.archive'
  | 'requests.send'
  | 'reports.view'
  | 'audit.view'
  | 'settings.manage';
