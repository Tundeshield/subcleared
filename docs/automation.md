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

## Email intake through Resend (`server/intake.ts`)

Each organisation can create a private address, `docs-<key>@<INBOUND_EMAIL_DOMAIN>`, from the Emailed documents page. The address alone decides the organisation, so nothing can be filed across tenants. Keys can be rotated.

The flow:

1. Resend receives the email and sends an `email.received` webhook to `/webhooks/inbound-email`. The webhook carries metadata only: sender, recipients, subject, email id and attachment names.
2. SubCleared verifies the Svix signature with `RESEND_WEBHOOK_SECRET`. Events older than five minutes are rejected, and several `v1,` signatures are accepted during secret rotation. Repeats are ignored, because Resend delivers at least once and the email id is used as a key.
3. The recipient address is mapped to an organisation and the work is handed to a background function. Unknown addresses get a 200 response and are dropped, so senders can't probe for valid keys.
4. The background function lists the attachments through Resend's Attachments API and downloads each one from its temporary URL. It also fetches the email text and the sender's display name for provenance.
5. Only PDF, JPG and PNG are kept; tiny images (signatures, tracking pixels) are skipped. Each file goes through the same structural checks and antivirus scan as uploads (`MALWARE_SCAN_URL`), is stored, read, and matched:
   - **Subcontractor:** exact contact email, or the named company on the document. A matching company domain counts only as a suggestion.
   - **Requirement:** the outstanding request it fits by document type, or the requirement whose last copy failed its checks.
6. It is attached automatically **only** when exactly one subcontractor and exactly one outstanding requirement fit. Otherwise it waits on the *Emailed documents* page with its reasons and a suggestion. An identical copy of a file already held is recorded as a duplicate.

Because attachments are fetched separately, large files never pass through a webhook request, so Netlify's request-size limit doesn't apply.

### Setting up Resend receiving

1. In Resend, open **Emails → Receiving**. Either use the `<id>.resend.app` domain Resend gives you, or add a **subdomain** (for example `in.subcleared.app`) and point its MX record at Resend as shown there. Don't use the root domain: all its mail would go to Resend.
2. In Resend, open **Webhooks → Add webhook**. Use the URL `https://subcleared.netlify.app/webhooks/inbound-email` (or your custom domain) and select the event `email.received`. Copy the signing secret (`whsec_…`).
3. In Netlify, set:
   - `INBOUND_EMAIL_DOMAIN`: the receiving domain from step 1.
   - `RESEND_WEBHOOK_SECRET`: the signing secret from step 2.
   - `RESEND_API_KEY`: already used for sending. It must be allowed to read received emails; a full-access key is.
4. Redeploy, then create the address on the Emailed documents page and send a test email with a PDF.

Resend stores received emails even if the webhook is down, and retries delivery, so nothing is lost during an outage.

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
| `INBOUND_EMAIL_DOMAIN`, `RESEND_WEBHOOK_SECRET`, `RESEND_API_KEY` | Email intake through Resend | For intake |
| `MALWARE_SCAN_URL`, `MALWARE_SCAN_TOKEN` | Antivirus engine for uploads and email | Recommended |

Without these, the product still works and says so plainly: reviewers enter details by hand, emailed documents are unavailable, and the Ask box is hidden. No feature pretends to be working.

## Local development

Run with `DEV_AI=mock npm run dev:api` to use an offline reader. It only parses "Label: value" lines from uncompressed test PDFs, and production never wires it. The dev server simulates a Resend delivery at `POST /api/_dev/inbound` (it stores the message in memory and calls the real webhook with a correctly signed event); the domain is `in.subcleared.test`.

## Deliberately not built

- Automatic approval of any kind.
- AI-generated risk scores.
- A separate AI dashboard, or several overlapping agents.
- Sharing documents between contractors. A future subcontractor "wallet" would need explicit consent and revocation.
- Integrations that haven't been asked for.
