# SubCleared — implementation audit (before the "refocus" changes)

Purpose: confirm what the product depends on before simplifying it, so the redesign changes presentation, not capability. Done against the repository at commit `a4ba711` plus the uncommitted sidebar work, on 11 Nov 2026.

## Verdict

- **No database change is needed** for the refocus brief. Every requirement is met by presentation changes plus two read-only or composing server actions.
- **No route is removed.** Every route is reachable from the sidebar, an in-page link, an email or a redirect.
- **No capability has been lost** across the five redesign rounds:
  - every server action from the original build still exists
  - every action the original interface called is still called by the current one
  - the data model has only gained optional fields
  - security rules, indexes, scheduled jobs and Netlify functions are unchanged since the original build.
- **One real regression found and fixed:** the old billing address `/app/settings/billing` redirected without its query string, so customers returning from Stripe Checkout never saw "Payment received". Redirects now keep the query, and Stripe returns to `/app/billing` directly.

## 1. Routes

| Route | Reached from | Notes |
|---|---|---|
| `/`, `/pricing`, `/design` | Public nav, footer | Marketing; `/design` is the live design kit |
| `/login`, `/signup`, `/forgot-password`, `/verify-email`, `/onboarding`, `/accept-invite` | Public nav, auth flow, invitation emails | Firebase Auth |
| `/auth/action` | **Firebase emails** (verify, reset) | Must stay; set as the action URL in Firebase |
| `/portal/:token` | **Request emails** | External, no account; must stay |
| `/dev/mailbox` | Dev only | Never deployed with data |
| `/app/overview` | Sidebar (main) | |
| `/app/projects`, `/app/projects/:id` | Sidebar (main), Overview, emails/notifications | `?tab=`, `?show=` filters; old `?tab=overview|subcontractors` map to Readiness |
| `/app/subcontractors`, `/app/subcontractors/:id` | Sidebar (main), many in-page links, notifications | `?readiness=`, `?issue=`, `?project=`, `?tab=` |
| `/app/reviews`, `/app/reviews/:versionId` | Sidebar (Work to do), Overview, project next step, notifications | |
| `/app/renewals` | Sidebar (Work to do), Overview, notifications | `?window=expired|7|30|60|90|…` |
| `/app/documents`, `/app/documents/:id` | Sidebar (Records & tools), project tab, profile | |
| `/app/requirements` | Sidebar (Records & tools), project "Change required paperwork" | |
| `/app/reports` | Sidebar (Records & tools) | |
| `/app/compliance` | Reports → "Subcontractor × project matrix" | Kept; breadcrumbed under Reports |
| `/app/notifications` | Bell in the top bar | |
| `/app/team`, `/app/settings/:section`, `/app/billing` | Sidebar (Administration) | |
| `/app/settings/users`, `/app/settings/billing` | **Old links, Stripe return URLs** | Redirects, now query-preserving |

## 2. Server actions (76, all kept)

Grouped by job; each was traced to its caller in the interface.

- **Organise projects and subcontractors:** `projects.*` (create, update, get, list, assign, unassign, archive, setRequirement, applyTemplate), `subs.*` (create, update, get, list, import, setStatus, addNote).
- **Request paperwork:** `requests.create`, `requests.forProject` (added last round; composes `requests.create`), `requests.resend`, `links.revoke`, `renewals.request`.
- **Collect documents:** `uploads.create/finalize` (internal), `portal.open/state/uploadCreate/uploadFinalize/fileUrl/updateContact` (external), `files.url`.
- **Review:** `reviews.queue/get/claim/decide/verify`, `documents.get/list/update`.
- **Track:** `dashboard`, `renewals.list`, `compliance.overview/history`, `notifications.*`, `audit.list`, `reports.run`, `search`, `nav.counts` (new, read-only).
- **Configure and administer:** `requirements.*`, `templates.save`, `overrides.set/revoke`, `members.*`, `invitations.*`, `org.*` (including sample data), `billing.*`, `me`.
- **Without a caller in the interface (kept deliberately):**
  - `org.settings` (read-only settings fetch)
  - `requests.list` (covered by tests; the profile gets requests through `subs.get`)
  - `reviews.saveMetadata` (saves reviewer edits without deciding; useful for a future "save draft").

  None is reachable without authorisation, and removing them gains nothing.

## 3. Data (Firestore, per organisation under `orgs/{orgId}/…`)

`projects`, `projectRequirements`, `subcontractors`, `notes`, `assignments`, `requirements` + `requirementVersions`, `templates` + `templateVersions`, `documents` + `versions` (immutable uploads), `reviews`, `verifications`, `overrides`, `evaluations` (rule snapshots), `readiness` (current result per project × subcontractor), `requests`, `links` (hashed tokens), `reminders`, `notifications`, `deliveryLogs`, `members`, `invitations`, `audit` (append-only), `billing`. Client access is denied by rules; all access goes through the server with tenant scoping.

Changes to stored data across all redesign rounds, all backwards compatible:
- `OrgSettings.market`, `locale`, `currency` — optional; missing values fall back to neutral defaults.
- `Organisation.hasSample`, `Project.sample`, `Subcontractor.sample` — optional flags for labelled sample data.
- Readiness *reason text* is generated when readiness is evaluated. After the plain-language label change, records evaluated earlier keep their original wording until they are next recalculated, which happens on any change. Historical evaluation snapshots intentionally keep the words used at the time.
- The removed dark theme left an unused `theme` preference on some user records; it is ignored and harmless.

## 4. Jobs, integrations, permissions

- **Netlify functions:**
  - `api` (`/api/*`)
  - `renewals-scheduled` (cron `17 */6 * * *`: expiry, reminders, escalation, de-duplicated)
  - `jobs-run` (`/internal/jobs/run`, needs `CRON_SECRET`)
  - `extract-background` (optional AI reading)
  - `stripe-webhook` (`/webhooks/stripe`, signature-checked, idempotent).
- **Integrations:** Firebase Auth/Firestore/Storage, Stripe, Resend (email, now with reply-to the requester), Anthropic (optional extraction), malware-scan URL (optional).
- **Roles:** owner, admin, compliance manager, project manager (scoped to their projects), project admin, reviewer, read-only. Sidebar items respect the same permissions as the server (Documents to review needs `documents.review`, Reports needs `reports.view`), so hiding an item is never the only protection.

## 5. Dependencies to protect while simplifying

- Readiness depends on project requirements → requirement *versions* → document decisions → overrides. Template edits create new versions and never rewrite past evaluations.
- Renewals depend on the scheduled job, the expiry date confirmed at review, and reminder de-duplication keys. Removing the Renewals *page* would not stop reminders, but it would remove the only bulk renewal-request screen, so it stays (now under "Work to do").
- The portal depends on `links` (hashed, expiring, revocable), `requests` and upload safety checks; its URL format is in emails already sent.
- Billing depends on the Stripe return URLs and webhook path above.

## 6. What the refocus changes, and what it doesn't

| Change | Layer | Data or route impact |
|---|---|---|
| Sidebar: 3 main items + collapsible Work to do / Records & tools / Administration, remembered per device | Interface | None; same routes |
| Counts beside Documents to review and Renewals | New read-only `nav.counts` | None |
| Readiness wording (Not ready / Needs review / Action required / Ready) with reasons | Display rule over existing results | None; engine unchanged |
| Headed project table (Subcontractor · Paperwork · Status · Next action) | Interface | None |
| Typeface | Styles | None |
| Billing redirect fix | Router + Stripe return URL | Old URL still works |
