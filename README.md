# SubCleared

SUBCONTRACTOR COMPLIANCE & READINESS — **Know who's ready to work.**

SubCleared is a multi-tenant subcontractor compliance and readiness platform for general contractors. It answers one question per project and per subcontractor: *is this subcontractor ready to work on this project, and can we show why?*

Stack: **React 18 + TypeScript + Vite + Tailwind** (frontend), **Netlify Functions** (API, scheduled jobs, webhooks), **Firebase** (Authentication, Firestore, Cloud Storage), **Stripe** (billing), **Resend** (email), **Anthropic API** (optional AI extraction).

---

## Brand and design system

- **Palette — three colours only.** Warm Ivory `#F6F5F0` (canvas), Deep Charcoal `#252B27` (text, structure), Field Green `#52745F` (primary actions, active navigation, positive readiness, progress). Every other tone is one of these at a set opacity. There are no red/amber/blue status colours: status is carried by wording plus a small glyph (filled = done, half = in progress, outline = attention, solid "!" = blocking), so it never relies on colour alone.
- **Type.** IBM Plex Sans (400/500/600, self-hosted via `@fontsource`), Plex Mono for codes. Plex was kept after evaluation: it is legible in dense tables at 15–16 px, has an engineered, construction-appropriate character, and avoids the generic feel of Inter.
- **Mark.** A raised site barrier — a post with a boom lifting clear — meaning "the way is clear to work". No shields, hard hats or checkmarks. Implemented as the `Mark`/`Logo` components and `public/favicon.svg`.
- **Tokens and components** live in `tailwind.config.cjs`, `src/styles.css` and `src/ui/index.tsx` (buttons, inputs, tables, tabs, drawers, dialogs, toasts, status glyphs, filters, pagination, empty states, progress, page headers). Drawers are used for contextual editing; dialogs only for short decisions.
- **Markets.** Organisations are US, UK or other (`settings.market`), which sets terminology (general/principal contractor, COI/insurance certificate, licence/license), date format, currency (USD/GBP pricing and Stripe prices) and a market-specific starter requirement library. Everything stays editable — the library is a starting point, not a legal standard.
- **Sample data.** Settings → Sample data loads a labelled US or UK set (Austin, Dallas, Chicago / London, Manchester, Birmingham) through the real handlers, so readiness, reviews and renewals are genuinely computed. It can be removed in one step; sample subcontractors never receive email.

---

## Implementation report

### Features completed (working end to end, tested)

| Area | What works |
|---|---|
| Accounts | Sign-up, email verification, sign-in, password reset (Firebase Auth), organisation registration, invitation-based onboarding, multiple organisations per user, session revocation on deactivation |
| Roles | Owner, Administrator, Compliance manager, Project manager, Project administrator, Reviewer, Read-only, plus per-user extra/revoked permissions. Enforced server-side on every action. PMs and project admins only see their assigned projects and those projects' subcontractors |
| Projects | Create, edit, archive/restore, assign PM and admins, assign/remove subcontractors, apply versioned templates, add/remove/adjust project-specific requirements, compliance view with search/filter/CSV export, PDF readiness report |
| Subcontractors | Central directory (one record across all projects), manual create, CSV import with preview/validation/de-duplication, multiple contacts with roles, tags, internal owner, suspend/archive/restore with recorded reason, tabs: Overview, Projects, Documents, Requirements, Activity, Notes |
| Requirements engine | Custom requirements (document / periodic declaration / manual check), categories, jurisdiction, subcontractor-type applicability, mandatory default, expiry rules, renewal behaviour, review-required flag, structured criteria (minimum limits, booleans), instructions. Every change is versioned; templates are versioned and never silently change projects. 16 starter requirements + 8 trade templates (editable) |
| External portal | Secure links (256-bit tokens, only SHA-256 hash stored), per-contact, scoped to requirements/projects, expiring (≤30 days; ≤90 for portal invitations), revocable, cut off instantly on suspension. Full-portal invitations require a one-time email code. Mobile-first upload with progress; success shown only after the server confirms. Rejection reasons, history, document library, contact self-service |
| Uploads | Signed, time-limited PUT URLs into a quarantine path → server reads stored bytes, sniffs real type, checks size, extension, truncation, blocks PDFs with JavaScript/Launch/EmbeddedFile/XFA etc., optional external antivirus → moved to permanent storage, SHA-256 recorded. Blocked files are deleted and never count |
| Documents | Repository with filters (subcontractor, project, type, issuer, expiry, status, upload date, jurisdiction, archived), preview, download (5-minute signed URLs, access audited), versions (never overwritten), project association, archive/restore |
| Review | Queue (oldest first), claim lock so two reviewers can't decide at once, optimistic concurrency, metadata entry/correction, AI-proposed values with confidence (never auto-applied), criteria checklist, insurance reviewer checks, approve / reject / request info (reason sent to subcontractor with a fresh upload link), internal comments, supersession of the previous approval |
| Verification levels | *Received* → *Reviewed against requirements* → *Independently verified* (only when a reviewer records who confirmed it, how, and a reference) |
| Compliance engine | Per project × subcontractor: Ready / Action required / Not ready / Not evaluated, with an exact reason per requirement. Statuses: missing, requested, overdue, awaiting review, approved, expiring soon, expired, rejected, not applicable (with who/why), re-review needed when criteria change. Optional never blocks. Timezone-aware dates. Every change appends an immutable evaluation snapshot with the rule versions used |
| Renewals | Expiry pipeline view (not requested → requested → opened → replacement received → renewed), bulk renewal requests, automatic reminders on a configurable schedule (default 90/60/30/14/7/0/−7 days), each sent once, failures retried up to 3×, no reminders for archived/inactive records unless configured |
| Notifications | In-app + email per event type with per-user preferences; escalations to the PM when mandatory items stay missing; project readiness threshold alerts; delivery log |
| Reports | 11 reports (project readiness, subcontractor compliance, missing, expiring, expired, rejected, pending review, renewal activity, onboarding, historical compliance, audit trail) with filters, CSV (formula-injection safe) and PDF export |
| Audit | Append-only events for every meaningful action with actor, source, IP, before/after |
| Search | Global ⌘K search across subcontractors, contacts, projects, documents, reference numbers, requirements |
| Billing | Stripe Checkout, plan switching with proration, customer portal, webhook-driven subscription state, invoice history, 14-day trial, server-enforced plan limits (subcontractors, projects, users). Plans configurable via `PLANS_JSON` |
| Design | Light, three-colour brand system (see above); 4 text sizes saved per user; open layouts with tables for operational data; empty, loading and error states throughout; responsive from 390 px |

### Not completed / known limitations — read before launch

1. **Not yet deployed to your Firebase/Netlify.** Everything was verified against the local backend (below). Firebase's emulators and Google APIs are blocked from my build environment, so the Firestore/Storage adapters (`server/db.ts → FirestoreDb`, `server/storage.ts → GcsFileStore`) are type-checked but **have not run against a real Firebase project yet**. First deploy should include a smoke test of upload → review.
2. **Malware scanning**: structural checks always run; a real antivirus engine only runs if you set `MALWARE_SCAN_URL` (e.g. a ClamAV REST container). Without it, files are not AV-scanned.
3. **AI extraction** runs only with `ANTHROPIC_API_KEY`; not exercised live here. Without it, reviewers enter values manually (the UI says so).
4. **Email** requires `RESEND_API_KEY` and a verified sending domain. Without it, each send is logged as failed in Settings → Delivery logs, and request dialogs still show a copyable link.
5. **Stripe** needs products/prices created and the env vars set; not exercised live.
6. **Integrations** (Procore, M365, e-signature, broker verification): none are implemented, and none are claimed in the UI.
7. **Retention policy**: retention years are stored and evidence is never deleted, but there is no automated purge job yet.
8. **SMS**: notification model supports more channels; only email and in-app exist.
9. **Scale**: handlers load an organisation's data per request — fine for the 20–200 subcontractor target; larger tenants will need indexed queries.
10. **Cross-GC network** (reusable subcontractor profiles shared with consent): data model keeps tenants fully separate today; not built.

### Architecture

```
Browser (React SPA) ── Firebase Auth (ID token) ──► Netlify Function /api/<action>
                                                     │  verify token → load membership → check permission
                                                     │  → handler → audit event → recompute readiness
                                                     ▼
                                     Firestore (Admin SDK)   Cloud Storage (V4 signed URLs)
Subcontractor (no account) ─ secure link ─► /api/portal.* (token hash lookup → HMAC session, re-checked each call)
Scheduled function (every 6 h) ─► reminders, escalations, request expiry, date-driven readiness
Stripe ─► /webhooks/stripe (signature-verified, idempotent)
```

- **All Firestore and Storage access goes through the server.** Client rules deny everything (`firebase/*.rules`). This removes cross-tenant reads, IDOR and unaudited writes by construction.
- `src/domain/` is pure TypeScript shared by client and server: types, permissions, compliance engine, dates, file safety, CSV parsing, plans, starter library.
- `server/` holds handlers, the DB/storage abstractions, email, jobs, portal and the local dev server.
- `netlify/functions/` are thin entry points: `api`, `renewals-scheduled`, `extract-background`, `stripe-webhook`, `jobs-run`.

### Database schema (Firestore)

Top level: `users/{uid}`, `orgs/{orgId}`, `portalTokens/{sha256}`, `invitationTokens/{sha256}`, `portalCodes/{sha256}`, `rateLimits/*`, `stripeCustomers/{id}`, `stripeEvents/{id}`.

Per organisation `orgs/{orgId}/…`: `members`, `invitations`, `projects`, `subcontractors` (contacts embedded), `notes`, `requirements`, `requirementVersions`, `templates`, `templateVersions`, `projectRequirements` (`{projectId}__{requirementId}`), `assignments` (`{projectId}__{subId}`), `overrides` (N/A decisions, manual confirmations), `documents` (logical slot), `versions` (every upload), `reviews` (immutable decisions), `verifications`, `readiness` (current, `{projectId}__{subId}`), `evaluations` (immutable history with rule snapshot), `requests`, `links`, `notifications`, `deliveryLogs`, `reminders` (idempotency keys), `audit` (append-only), `billing`.

### Tests performed

- `npm test` — **51 passing** (Vitest), including US/UK market setup and sample data:
  - Compliance engine: missing ≠ compliant, review required before counting, optional never blocks, expiring window, expired, replacement pending keeps approval in force, uploaded-after-expiry, rejection reasons, per-project readiness, project-scoped documents, N/A with actor, suspended, criteria change after approval (blocking and non-blocking), requested/overdue, type applicability, rule snapshots, declarations, timezone-aware "today", reminder de-duplication.
  - API end to end (real handlers, in-memory DB): unauthenticated/unverified rejection, **tenant isolation**, role enforcement, PM scoping, deactivation, last-owner protection, full request → portal upload → review → readiness → notifications → audit → history → report flow, multi-project readiness, **two reviewers racing**, malicious/disguised/oversized uploads, versioning & supersession, link expiry, revocation, suspension killing live sessions, forged tokens, email codes, reminders sent once / retried after failure / stopped on archive, template versioning, requirement criteria changes, CSV import, plan limits after trial.
  - File safety, permissions, CSV parsing.
- **Redesign E2E (Playwright, 0 console errors)**: US sign-up → onboarding → project from template → subcontractor → assignment → document request → mobile portal upload (390 px) → review with recorded limits → approval → readiness updated → sample data → every app page at desktop (1440), tablet (820) and mobile (390) with no horizontal overflow.
- **Original-build E2E (Playwright, 0 console errors)**: sign-up → email verification → organisation → project from template → subcontractor → CSV import → assignment → request → **mobile portal upload (390 px)** → malicious PDF blocked → review with failing criteria (approve disabled) → approve → readiness, activity, documents, renewals, compliance matrix, requirements, notifications, settings, users, billing, audit, reports, search, larger text, cross-tenant URL blocked.

### Security controls

Server-side authorisation on every action; tenant scoping on every read/write; deny-all Firestore/Storage rules; hashed bearer tokens for invitations and portal links; HMAC portal sessions re-validated each call; email OTP for long-lived portal access (5 attempts, 10-minute expiry); rate limits (per user, per IP, per link, sign-up, code sends); input validation on every field; file type sniffing and active-content blocking; quarantine before acceptance; V4 signed URLs (15 min upload / 5 min read); append-only audit; Stripe webhook signature verification and idempotency; CSP/HSTS/frame-deny headers; `no-referrer` on portal pages (tokens never leak via Referer); CSV formula-injection protection; no tenant enumeration (same 403 for "no org" and "not a member").

Encryption in transit (HTTPS) and at rest (Google-managed) come from Firebase/Netlify. Backups: enable Firestore **Point-in-time recovery** and scheduled exports (`gcloud firestore export gs://<bucket>/backups`) plus Storage object versioning. Error monitoring: Netlify function logs; add Sentry if you want alerting.

---

## Deployment

1. **Firebase** (on tundeshield@gmail.com, Blaze plan): enable Email/Password auth, Firestore (production mode) and Storage. Under Authentication → Templates → *Customise action URL*, set `https://<your-site>/auth/action`. Add your Netlify domain to Authorised domains.
2. Deploy rules: `npx firebase login && npx firebase use <project-id> && npm run deploy:rules`.
3. Storage CORS (for browser uploads): edit `firebase/storage-cors.json` with your domain, then `gsutil cors set firebase/storage-cors.json gs://<bucket>`.
4. Service account: Project settings → Service accounts → Generate key. Paste the JSON (or base64 of it) into `FIREBASE_SERVICE_ACCOUNT`. The service account needs *Service Account Token Creator* on itself for signed URLs.
5. **Netlify**: link the GitHub repo, build `npm run build`, publish `dist`. Set every variable from `.env.example`.
6. **Stripe**: create Starter/Growth/Scale products with monthly and annual prices, set the `STRIPE_PRICE_*` vars, add a webhook to `https://<site>/webhooks/stripe` for `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, and enable the customer portal.
7. **Resend**: verify your sending domain, set `RESEND_API_KEY` and `EMAIL_FROM`.

### Local development (no Firebase needed)

```bash
npm install
npm run dev        # API on :8787 (in-memory, persisted to .data/) + Vite on :5173
```

Emails land in the dev mailbox at `/dev/mailbox`. The dev backend is never deployed.

### Environment variables

See `.env.example` — browser vars are prefixed `VITE_`; everything else is server-only.
