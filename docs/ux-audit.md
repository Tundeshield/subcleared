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

---

# Simplification audit (brief 4: "Know who's ready, who's not, and what needs to happen next")

## System inventory

- **Data (Firestore, per organisation):** `projects`, `subcontractors` (with contacts and notes), `assignments` (subcontractor ↔ project), `requirements` (versioned definitions), `templates` (versioned), `documents` and `versions` (every upload is a new, immutable version), `reviews`, `verifications`, `overrides` (N/A and manual confirmations), `evaluations` (rule snapshots) and `readiness` (current result per project × subcontractor), `requests`, `links` (hashed portal tokens), `reminders`, `notifications`, `members`, `invitations`, `audit` (append-only), `billing`.
- **Backend:** Netlify Functions — `api` (every action, server-side authorisation), `extract-background` (optional AI extraction), `renewals-scheduled` (every 6 h: expiry, reminders, escalation), `jobs-run` (manual trigger), `stripe-webhook`.
- **Auth and permissions:** Firebase email/password with verification; roles owner, admin, compliance manager, project manager (scoped to their projects), reviewer, viewer; tenant scoping on every read and write; deny-all client rules.
- **Integrations:** Firebase Auth/Firestore/Storage, Stripe, Resend (email), Anthropic (extraction, optional), malware-scan URL (optional).
- **Broken or incomplete:** nothing found broken in tests or E2E. Email, billing, extraction and scanning are inactive until their keys are set; the UI says so where it matters. The live site cannot sign anyone up until the Firebase console steps are completed.

## What works well
Per-project readiness with reasons; secure no-account portal; immutable versions and audit; renewals automation; the new readiness view on projects.

## What is still confusing
1. **Eight equal destinations** in the main navigation (plus configuration and administration). Daily work uses four.
2. **Twelve requirement statuses** with internal names ("Re-review needed", "Missing" vs "Requested" vs "Overdue", "Rejected").
3. **The workflow is implicit.** After creating a project nothing says "now add subcontractors", then "now request paperwork".
4. **Assigning only picks existing companies.** A new subcontractor means leaving the project, creating it in the directory and coming back.
5. **Requests are per subcontractor.** Requesting paperwork from five new companies takes five dialogs.
6. **Overview shows aggregate counts** ("5 subcontractors with missing requirements") rather than the specific items to act on.
7. **The review queue has no filters** by project, subcontractor or date.

## Decisions
- **Primary navigation:** Overview · Projects · Subcontractors · Documents to review. Everything else (All documents, Renewals, Reports, Requirements & templates, Team, Settings, Billing) moves to a secondary "More" group: still one click away, just not competing with daily work.
- **Combine:** renewal alerts and review items surface in Overview and on each project, so most users never need the Renewals page.
- **Plain status model:** Not requested · Requested · Submitted · Needs review · Approved · Changes needed · Expiring soon · Expired · Not applicable. Readiness: Ready · Not ready · Needs review · Action required. Internal states are unchanged.
- **Primary journey made explicit:** every project shows its next step (choose paperwork → add subcontractors → request paperwork → review submissions) until everyone is ready.
- **Add subcontractors in place:** pick existing companies or add new ones (with a contact) from the same panel; duplicates are prevented by name.
- **Request paperwork in one step** for every subcontractor on a project that has outstanding items.
- **Overview** leads with a "Needs your attention" list: item, issue, action, each row a direct link.

---

# Refocus audit (brief 5: "make the administrative work disappear into the background")

Most of this brief was already in place after the simplification round: one visible workflow per project, one-step requests, the review inbox, plain statuses, and automatic readiness, reminders and expiry tracking. Remaining gaps:

1. **The sidebar still showed eleven links at once** (four main, four under "More", three under Administration). → Three always-visible items (Overview, Projects, Subcontractors), then collapsible **Work to do** (Documents to review, Renewals — each with a count), **Records & tools** (All documents, Requirements & templates, Reports) and **Administration** (Team and permissions, Settings, Billing). Each person's collapsed state is remembered on their device, and a group always opens when it contains the current page.
2. **Readiness labels didn't match the brief's meanings.** A rejected or expired document showed as "Not ready". → Display rule: *Not ready* = mandatory paperwork not yet submitted; *Action required* = something was rejected, expired or is about to; *Needs review* = everything is in and waiting for a decision; *Ready* = all mandatory items approved and valid. Each comes with its reason, and the engine's internal states are unchanged.
3. **The project's subcontractor list had no column headings**, so "6 of 8 approved" and the action column had to be inferred. → Headed table: Subcontractor · Paperwork · Status · Next action.
4. **Typeface.** Third request to replace it; switched from IBM Plex Sans to Inter (variable). Reasons: the clearest figures in dense tables (tabular numbers), the widest language coverage for a product used in many countries, and it renders well at the small sizes used in tables.
5. **Renewals counts weren't visible** without opening the page. → The "Work to do" group shows the number of expired and soon-expiring documents next to Renewals; they also already appear on the Overview and project pages.
