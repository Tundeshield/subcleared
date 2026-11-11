# Automation and document intelligence

What SubCleared now does on its own, what it never does on its own, and what a deployment needs switched on.

## The principle

Software handles routine work; people handle decisions. Concretely:

| Done automatically | Always left to a person |
| --- | --- |
| Reading each document (type, names, dates, limits, policy numbers) with page and source text | Approving or rejecting a document |
| Comparing what was read with the project's actual requirement | Deciding that coverage is adequate (it is never claimed) |
| Pre-filling the confirmed details when the reading is confident | Confirming low-confidence values |
| Following up unanswered requests, then telling the requester | Contacting anyone outside the configured schedule |
| Filing emailed documents when sender and requirement are both certain | Matching anything less certain |
| Spotting identical files and reusing earlier readings | Changing requirements or readiness rules |

Readiness stays deterministic (`src/domain/compliance.ts`). Nothing an AI model returns changes a readiness status; only approved, in-date documents and recorded decisions do.

## Document reading (`server/ai.ts`)

The same pipeline runs for every route a document can arrive by (staff upload, subcontractor link, email):

1. **Identical file?** If a file with the same SHA-256 has already been read for this organisation, that reading is reused. No AI call is made. If the same subcontractor already submitted it, the reviewer is told.
2. **Limits.** Files over `AI_MAX_BYTES` (10 MB by default) or PDFs over `AI_MAX_PAGES` (12 by default) are not read. Neither are documents beyond the plan's monthly allowance (`limits.aiDocuments`: Starter 150, Growth 750, Scale 3,000). In all these cases the reviewer is told why and enters the details by hand.
3. **Fast model first.** `ANTHROPIC_MODEL_FAST` (default `claude-haiku-5-5`) identifies the document type and fills the schema for that type (`src/domain/extraction.ts`). There are separate schemas for insurance certificates, endorsements, licences, method statements, training cards, agreements and other documents. Each field carries a value, a confidence, a page number and the exact printed text it came from.
4. **Second look only when needed.** If the type or a critical field (named holder, expiry date, signatures on agreements) comes back below 0.6 confidence, `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`) reads the document once more.
5. **Validation.** Output that doesn't fit the schema is dropped, not coerced. That covers malformed dates, impossible amounts and unknown fields. A missing value stays missing.
6. **Comparison** (`src/domain/assessment.ts`, deterministic) checks:
   - the right kind of document
   - the subcontractor's name (allowing for legal-suffix and punctuation differences, and trading names)
   - whether it is in date today and already in effect
   - whether it lasts to each project's end date
   - each configured limit or endorsement
   
   Any reading below 0.75 confidence counts as "check by eye", never as a pass. The result is triaged as *looks good*, *check* or *problem* for the overview and review queue.

The review screen keeps four layers visibly separate:

1. What the document says
2. Compared with what you asked for
3. Your decision
4. Independent verification

The wording never presents a certificate as proof of cover.

### Cost

Every model call is metered per organisation per month in `orgs/{org}/aiUsage/{yyyy-mm}`: documents, calls, input and output tokens, by model and purpose. Settings → Reminders and automation shows it to administrators. A cost estimate is shown only when `AI_PRICES_JSON` is set, for example `{"claude-haiku-5-5":{"in":1,"out":5}}` in dollars per million tokens. Check current provider prices before setting it; no prices are assumed in code.

Nothing reads documents on page load. A document is read once, when it arrives.

## Automatic chasing (`server/jobs.ts`, `src/domain/automation.ts`)

- The scheduler now runs **hourly** (`netlify/functions/renewals-scheduled.mts`). Heavier steps run once per local day: recompute, escalations and project alerts.
- **Follow-ups for unanswered requests** default to days 3, 7 and 14 after the request. After day 16 the requester, the subcontractor's owner and the project manager are notified in the app. All of this is configurable in Settings → Reminders and automation, and can be switched off.
- **Stops** as soon as everything requested has arrived. Nobody is chased within two days of opening their link or uploading something.
- **Working hours.** Messages to subcontractors, including expiry reminders, only go out inside the organisation's working hours and days, in its timezone. The default is 08:00–18:00, Monday to Friday.
- Each reminder carries a fresh link, so a reminder never contains an expired one. It is marked as automatic in its footer and replies go to the person who made the request. Every send is recorded in delivery logs and the audit trail, and keyed so retries never duplicate.
- AI doesn't write or decide these messages; they are templates sent by rules.

## Email intake (`server/intake.ts`)

Each organisation can create a private address, `docs-<key>@<INBOUND_EMAIL_DOMAIN>`, from the Emailed documents page or Settings. The address alone decides the organisation, so nothing can be filed across tenants. Keys can be rotated.

When an email arrives:

1. The webhook checks the shared secret.
2. It keeps PDF, JPG and PNG attachments. Tiny images (signatures, tracking pixels) are skipped.
3. Each attachment goes through the same structural checks and antivirus scan as uploads (`MALWARE_SCAN_URL`), then into storage. Sender, subject, message ID and a text preview are recorded as provenance.
4. A background function reads it and matches it:
   - **Subcontractor:** exact contact email, or the named company on the document. A matching company domain counts only as a suggestion.
   - **Requirement:** the outstanding request it fits by document type.
5. It is attached automatically **only** when exactly one subcontractor and exactly one outstanding requirement fit. Otherwise it waits in *Emailed documents* with its reasons and a suggestion. An identical copy of a file already held is recorded as a duplicate and not added.

### Setting up a provider (not yet done for production)

Any inbound-email service that can POST JSON will work. Postmark's inbound webhook format is supported directly. Other services can post the generic shape documented at the top of `server/intake.ts`.

For Postmark:

1. Create an inbound server.
2. Point an MX record for a subdomain (for example `in.subcleared.app`) at Postmark's inbound host, or use its forwarding address.
3. Set the inbound webhook URL to `https://<site>/webhooks/inbound-email?token=<INBOUND_EMAIL_SECRET>`.
4. In Netlify, set `INBOUND_EMAIL_DOMAIN` (for example `in.subcleared.app`) and `INBOUND_EMAIL_SECRET` (32+ random characters).

**Limit:** Netlify synchronous functions accept request bodies of about 6 MB. Emails whose attachments total more than about 4.5 MB (after base64) are refused before reaching SubCleared. For larger files, ask senders to use their upload link.

## Ask SubCleared (`server/handlers/assistant.ts`)

This is a question box on the overview and on each project, not a separate AI area.

- The model receives a bounded snapshot of records the member is allowed to see: readiness per project and subcontractor with plain reasons, expiring documents, documents awaiting review, and changes in the last seven days.
- It must cite records as links. Citations to anything not in the snapshot are removed.
- Its only action is to *propose* reminders. The person sees exactly who and what, and confirms. The confirmation runs the normal request path and requires the `requests.send` permission.
- Rate limit: 40 questions per member per hour. Usage is metered like document reading.

## Environment variables

| Variable | Purpose | Required |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Turns on document reading and Ask SubCleared | For automation |
| `ANTHROPIC_MODEL_FAST` | First-pass reader (default `claude-haiku-5-5`) | No |
| `ANTHROPIC_MODEL` | Second looks and the assistant (default `claude-sonnet-5-5`) | No |
| `AI_PRICES_JSON` | Per-million-token prices, for cost estimates | No |
| `AI_MAX_PAGES`, `AI_MAX_BYTES` | Reading limits | No |
| `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_SECRET` | Email intake | For intake |
| `MALWARE_SCAN_URL`, `MALWARE_SCAN_TOKEN` | Antivirus engine for uploads and email | Recommended |

Without these, the product still works and says so plainly: reviewers enter details by hand, emailed documents are unavailable, and the Ask box is hidden. No feature pretends to be working.

## Local development

Run with `DEV_AI=mock npm run dev:api` to use an offline reader. It only parses "Label: value" lines from uncompressed test PDFs, and production never wires it. The dev server accepts inbound email at `/webhooks/inbound-email?token=dev-inbound`, with domain `in.subcleared.test`.

## Deliberately not built

- Automatic approval of any kind.
- AI-generated risk scores.
- A separate AI dashboard, or several overlapping agents.
- Sharing documents between contractors. A future subcontractor "wallet" would need explicit consent and revocation.
- Integrations that haven't been asked for.
