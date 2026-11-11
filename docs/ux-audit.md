# SubCleared — product and UX audit

Audited from the repository and the running application (dev backend with empty and sample organisations). The project-page screenshots referenced in the brief were not attached, so the assessment of that page is based on the live code and our own captures.

## Route inventory

| Area | Route | Purpose |
|---|---|---|
| Public | `/`, `/pricing` | Landing, pricing |
| Auth | `/login`, `/signup`, `/forgot-password`, `/verify-email`, `/auth/action`, `/onboarding`, `/accept-invite` | Firebase email/password, verification, organisation set-up, team invitations |
| Portal | `/portal/:token` | Subcontractor submission (no account; hashed, expiring, revocable link + email code) |
| App | `/app/overview` | Dashboard |
| | `/app/projects`, `/app/projects/:id?tab=` | Project list and detail |
| | `/app/subcontractors`, `/app/subcontractors/:id?tab=` | Directory and profile |
| | `/app/requirements` | Requirement library and templates |
| | `/app/documents`, `/app/documents/:id` | Document library and detail |
| | `/app/reviews`, `/app/reviews/:versionId` | Review queue and review workspace |
| | `/app/renewals?window=` | Expiry buckets and renewal requests |
| | `/app/reports`, `/app/compliance` | Reports and the subcontractor × project matrix |
| | `/app/notifications` | In-app notifications |
| | `/app/team`, `/app/settings/:section`, `/app/billing` | Administration |
| Dev only | `/dev/mailbox` | Local email capture (never deployed) |

## Feature inventory (all working end to end, covered by tests)

Projects (create, edit, archive/restore, templates, project-specific requirements) · subcontractor directory (create, CSV import, bulk assign, suspend, contacts, notes) · requirement library with versioning and criteria · templates with versions and "outdated" detection · document requests with reminders · secure portal (scoped links, OTP, revocation, expiry) · upload safety checks and quarantine · review with criteria, claim/locking, approve/reject/request replacement, internal notes · optional AI extraction with confidence (never auto-approves) · per-project readiness evaluation with rule snapshots · renewals and reminder scheduling · notifications · reports (PDF/CSV) · audit trail · team roles and project-scoped permissions · Stripe billing · sample data.

Partially configured, not broken: email delivery, Stripe, AI extraction and malware scanning depend on environment keys; the UI states this where it matters.

## Navigation assessment

- Requirements sat in the main workspace list although it is configuration that most users touch rarely. It is moved into its own **Configuration** group as "Requirements & templates".
- "Compliance" (the matrix) existed as a separate route but was only reachable from Reports. It is kept under Reports, with breadcrumbs.
- Active state, breadcrumbs and global search already existed and are kept.

## UX problems found

1. **Project page split the answer across two tabs.** "Overview" listed blockers as long prose; "Subcontractors" listed the same people in a table. Users had to compare the two to know what to do.
2. **Five large project metrics** took a full band of the screen and none of them was actionable.
3. **The subcontractor table on a project showed comma-separated lists** of outstanding requirements, which wrapped into paragraphs.
4. **"Request outstanding documents" was hidden** inside an expanded row, so the most common next step was not visible.
5. **Blockers were not clickable.** A document awaiting review did not link to the review; a missing document did not offer a request.
6. **Status relied on reading long reason text** ("Nothing submitted and no request sent yet") repeated many times.
7. **Directory "Outstanding" was a bare count** with no hint of whether the problem was missing, expired or waiting on us.
8. **The landing page and set-up assumed the US or UK.** Other countries received the US library (ACORD forms, US dollar limits).
9. **Colour carried almost no meaning.** With only ivory, charcoal and green, "expired" and "awaiting review" looked identical apart from the glyph shape.

## Changes made

- Project page: one **Readiness** view replaces Overview + Subcontractors. A one-line readiness strip with clickable filters replaces the metric band; every subcontractor shows a concise summary ("2 missing · 1 awaiting review · 1 expiring") and a specific next action (Review, Request documents); expanding shows each requirement with a direct link to its review or document.
- Directory: issue summary instead of a bare count; filter by issue type.
- Navigation: Workspace / Configuration / Administration.
- Design system: new restrained colour system with meaningful status colours (always paired with an icon and words), documented at `/design` and in `docs/design-system.md`.
- Country-agnostic: broader country list, locale-correct dates and currency per organisation, a neutral starter library for countries without a tailored one, and no market claims in brand messaging.
