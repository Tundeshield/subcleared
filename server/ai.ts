// The document intelligence layer. One pipeline reads every document,
// whichever way it arrived (staff upload, subcontractor link, email):
//
//   identical file already read?  → reuse that result (no AI call)
//   too large / allowance used?   → skip, reviewer enters details by hand
//   fast, inexpensive model       → classify + extract with page and source text
//   unsure about critical fields? → re-read once with the more capable model
//   deterministic comparison      → against the project's actual requirement
//
// AI only transcribes. It never approves, never changes readiness and never
// decides to message anyone. Usage is metered per organisation per month.
import { assess } from '../src/domain/assessment';
import { todayIn } from '../src/domain/dates';
import { ALL_KINDS, KIND_LABELS, SCHEMAS, type DocumentKind } from '../src/domain/extraction';
import { getPlan } from '../src/domain/plans';
import type { Assignment, DocumentVersion, ExtractedField, Extraction, Organisation, Project, ProjectRequirement, RequirementDefinition, Subcontractor } from '../src/domain/types';
import { C } from './core';
import type { Services } from './services';

export interface AiCall { model: string; system?: string; content: any[]; maxTokens: number; /** Forces a structured answer through a tool, so the reply is always valid JSON. */ tool?: { name: string; description: string; schema: any } }
export interface AiResult { text: string; inputTokens: number; outputTokens: number; model: string; /** The tool input, when a tool was required. */ json?: any }
export interface AiProvider { name: string; call(c: AiCall): Promise<AiResult> }

export class AnthropicProvider implements AiProvider {
  name = 'anthropic';
  constructor(private key: string) {}
  async call(c: AiCall): Promise<AiResult> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': this.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: c.model, max_tokens: c.maxTokens, ...(c.system ? { system: c.system } : {}), messages: [{ role: 'user', content: c.content }],
        ...(c.tool ? { tools: [{ name: c.tool.name, description: c.tool.description, input_schema: c.tool.schema }], tool_choice: { type: 'tool', name: c.tool.name } } : {}),
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || `AI provider responded ${res.status}`);
    const text = (body.content ?? []).filter((x: any) => x.type === 'text').map((x: any) => x.text).join('');
    const json = (body.content ?? []).find((x: any) => x.type === 'tool_use')?.input;
    if (c.tool && body.stop_reason === 'max_tokens') throw new Error('The reading was cut off before it finished');
    return { text, json, inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0, model: body.model ?? c.model };
  }
}

const FIELD_DOCS = ALL_KINDS.map((k) => `- ${k} (${KIND_LABELS[k]}):\n${SCHEMAS[k].map((f) => `    ${f.key} [${f.type}] ${f.label}${f.hint ? ` — ${f.hint}` : ''}`).join('\n')}`).join('\n');

export const EXTRACTION_SYSTEM = `You read construction subcontractor paperwork so a person can check it quickly. You transcribe; you never judge validity or coverage.

Record your reading with the record_reading tool:
kind (one of: ${ALL_KINDS.join(', ')}), kindConfidence (0..1), issues (short strings), and fields: for each key, {value, confidence 0..1, page (1-based), source (the exact printed text you read, max 120 characters)}.

Fields to read for each kind:
${FIELD_DOCS}

Rules:
- Only report what is printed. If a field is absent, illegible or ambiguous, use value null and confidence 0. Never guess, infer or fill gaps.
- "source" must be copied from the document, not paraphrased.
- Dates: YYYY-MM-DD (convert written dates like "1 March 2027"; do not shift timezones). Decide day/month order from the document's own cues: a printed format label such as MM/DD/YYYY, a written-out date elsewhere, the country of addresses, the currency, or the form (ACORD and ISO "CG" forms are US: month first; a UK insurer or £ amounts: day first). Only when the document gives no such cue is the order ambiguous: then set confidence at most 0.5 and say so in issues.
- Amounts: plain numbers, no symbols or separators. Put the currency (ISO code) in the "currency" field when shown.
- Booleans are true only when the document explicitly shows it; false only when it explicitly shows it is absent; otherwise null.
- If one file contains several different documents, read the main one and add an issue.
- If several policies appear on one certificate, read each limit into its own field; namedInsured and expiryDate refer to the policy most relevant to the field list (use the earliest expiry if they differ, and add an issue).`;

const READING_TOOL = {
  name: 'record_reading',
  description: 'Record what the document says.',
  schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ALL_KINDS },
      kindConfidence: { type: 'number' },
      issues: { type: 'array', items: { type: 'string' } },
      fields: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: { value: {}, confidence: { type: 'number' }, page: { type: ['integer', 'null'] }, source: { type: ['string', 'null'] } },
          required: ['value', 'confidence'],
        },
      },
    },
    required: ['kind', 'kindConfidence', 'fields'],
  },
};

export function parseAiJson(text: string): any {
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('The reader returned no structured result');
  return JSON.parse(text.slice(a, b + 1));
}

/** Validates model output against the schema. Anything not in the schema or malformed is dropped, never coerced into a guess. */
export function cleanExtraction(raw: any): { kind: DocumentKind; kindConfidence: number; issues: string[]; fields: Record<string, ExtractedField> } {
  const kind: DocumentKind = ALL_KINDS.includes(raw?.kind) ? raw.kind : 'other';
  const schema = SCHEMAS[kind];
  const fields: Record<string, ExtractedField> = {};
  for (const s of schema) {
    const r = raw?.fields?.[s.key];
    if (!r || typeof r !== 'object') continue;
    let value: any = r.value ?? null;
    if (value !== null) {
      if (s.type === 'date') value = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : null;
      else if (s.type === 'amount') { const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.]/g, '')); value = Number.isFinite(n) && n > 0 ? n : null; }
      else if (s.type === 'boolean') value = value === true || value === 'true' ? true : value === false || value === 'false' ? false : null;
      else value = String(value).trim().slice(0, 300) || null;
    }
    const confidence = value === null ? 0 : Math.max(0, Math.min(1, Number(r.confidence) || 0));
    const page = Number.isInteger(r.page) && r.page > 0 && r.page < 500 ? r.page : undefined;
    const source = typeof r.source === 'string' && r.source.trim() ? r.source.trim().slice(0, 160) : undefined;
    fields[s.key] = { value, confidence, ...(page ? { page } : {}), ...(source ? { source } : {}) };
  }
  const issues = Array.isArray(raw?.issues) ? raw.issues.filter((x: any) => typeof x === 'string').map((x: string) => x.slice(0, 200)).slice(0, 8) : [];
  return { kind, kindConfidence: Math.max(0, Math.min(1, Number(raw?.kindConfidence) || 0)), issues, fields };
}

export function pdfPageCount(bytes: Uint8Array): number {
  const s = Buffer.from(bytes).toString('latin1');
  return (s.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length || 1;
}

function contentBlock(bytes: Uint8Array, mimeType: string) {
  const data = Buffer.from(bytes).toString('base64');
  return mimeType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data } };
}

function needsSecondLook(x: ReturnType<typeof cleanExtraction>) {
  if (x.kindConfidence < 0.6) return true;
  return SCHEMAS[x.kind].filter((f) => f.critical).some((f) => { const v = x.fields[f.key]; return !v || v.value === null || v.confidence < 0.6; });
}

export function monthKey(d: Date) { return d.toISOString().slice(0, 7); }

/** Adds to this month's metered usage. Cost is only estimated when prices are configured (AI_PRICES_JSON). */
export async function recordUsage(svc: Services, orgId: string, u: { model: string; inputTokens: number; outputTokens: number; document?: boolean; purpose: string }) {
  const path = C.doc(orgId, 'aiUsage', monthKey(svc.now()));
  const price = svc.env.aiPrices?.[u.model];
  const cost = price ? (u.inputTokens * price.in + u.outputTokens * price.out) / 1_000_000 : undefined;
  await svc.db.transaction(async (tx) => {
    const cur = (await tx.get<any>(path)) ?? { id: monthKey(svc.now()), documents: 0, calls: 0, inputTokens: 0, outputTokens: 0, byModel: {}, byPurpose: {}, estimatedCost: 0, costKnown: true };
    const m = cur.byModel[u.model] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
    tx.set(path, {
      ...cur,
      documents: cur.documents + (u.document ? 1 : 0), calls: cur.calls + 1,
      inputTokens: cur.inputTokens + u.inputTokens, outputTokens: cur.outputTokens + u.outputTokens,
      byModel: { ...cur.byModel, [u.model]: { calls: m.calls + 1, inputTokens: m.inputTokens + u.inputTokens, outputTokens: m.outputTokens + u.outputTokens } },
      byPurpose: { ...cur.byPurpose, [u.purpose]: (cur.byPurpose?.[u.purpose] ?? 0) + 1 },
      estimatedCost: cost === undefined ? cur.estimatedCost : +(cur.estimatedCost + cost).toFixed(6),
      costKnown: cur.costKnown && cost !== undefined,
      updatedAt: svc.now().toISOString(),
    });
  });
}

export async function allowance(svc: Services, org: Organisation) {
  const plan = getPlan(svc.env.plans, org.subscription.plan);
  const limit = plan.limits.aiDocuments ?? null;
  const used = (await svc.db.get<any>(C.doc(org.id, 'aiUsage', monthKey(svc.now()))))?.documents ?? 0;
  return { limit, used, remaining: limit === null ? Infinity : Math.max(0, limit - used) };
}

/**
 * Reads one file. Returns an Extraction (never throws for document problems).
 * Callers decide where to store it.
 */
export async function readDocument(svc: Services, org: Organisation, bytes: Uint8Array, mimeType: string, purpose: string): Promise<Extraction> {
  const startedAt = svc.now().toISOString();
  if (!svc.ai) return { status: 'not_configured' };
  if (bytes.length > svc.env.aiMaxBytes) return { status: 'skipped', skippedReason: 'The file is too large to read automatically. Enter the details by hand.' };
  if (mimeType === 'application/pdf' && pdfPageCount(bytes) > svc.env.aiMaxPages) return { status: 'skipped', skippedReason: `The file has more than ${svc.env.aiMaxPages} pages, so it wasn't read automatically. Enter the details by hand, or ask for just the certificate.` };
  const al = await allowance(svc, org);
  if (al.remaining <= 0) return { status: 'skipped', skippedReason: `This month's automatic reading allowance (${al.limit} documents) has been used. Enter the details by hand, or upgrade your plan.` };

  const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
  const run = async (model: string, first: boolean) => {
    const r = await svc.ai!.call({ model, system: EXTRACTION_SYSTEM, maxTokens: 4000, tool: READING_TOOL, content: [contentBlock(bytes, mimeType), { type: 'text', text: 'Read this document and record what it says.' }] });
    usage.inputTokens += r.inputTokens; usage.outputTokens += r.outputTokens; usage.calls += 1;
    await recordUsage(svc, org.id, { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, document: first, purpose });
    return { ...cleanExtraction(r.json ?? parseAiJson(r.text)), model: r.model };
  };
  try {
    let x: Awaited<ReturnType<typeof run>>;
    let escalated = false;
    try { x = await run(svc.env.aiFastModel, true); } catch (e) {
      // The fast reader failed outright: give the document to the stronger model once before giving up.
      if (svc.env.anthropicModel === svc.env.aiFastModel) throw e;
      x = await run(svc.env.anthropicModel, false); escalated = true;
    }
    if (!escalated && needsSecondLook(x) && svc.env.anthropicModel !== svc.env.aiFastModel) {
      try { const y = await run(svc.env.anthropicModel, false); x = y; escalated = true; } catch { /* keep the first reading */ }
    }
    return { status: 'completed', kind: x.kind, kindConfidence: x.kindConfidence, issues: x.issues, fields: x.fields, model: x.model, escalated, usage, startedAt, completedAt: svc.now().toISOString() };
  } catch (e: any) {
    return { status: 'failed', error: String(e?.message ?? e).slice(0, 300), usage, startedAt, completedAt: svc.now().toISOString() };
  }
}

/** Builds the comparison for a version from its extraction and the projects it serves. */
export async function assessVersion(svc: Services, org: Organisation, v: DocumentVersion) {
  const [sub, def, assignments, projectReqs, projects] = await Promise.all([
    svc.db.get<Subcontractor>(C.doc(org.id, 'subcontractors', v.subcontractorId)),
    v.requirementId ? svc.db.get<RequirementDefinition>(C.doc(org.id, 'requirements', v.requirementId)) : Promise.resolve(null),
    svc.db.list<Assignment>(C.col(org.id, 'assignments'), [['subcontractorId', '==', v.subcontractorId]]),
    v.requirementId ? svc.db.list<ProjectRequirement>(C.col(org.id, 'projectRequirements'), [['requirementId', '==', v.requirementId]]) : Promise.resolve([]),
    svc.db.list<Project>(C.col(org.id, 'projects')),
  ]);
  if (!sub) return undefined;
  if (v.extraction.status !== 'completed') return { triage: 'not_read' as const, summary: 'Not read automatically. Check the document by eye.', checks: [], at: svc.now().toISOString() };
  const live = new Set(assignments.filter((a) => a.active).map((a) => a.projectId));
  const needing = new Set(projectReqs.filter((pr) => pr.active).map((pr) => pr.projectId));
  const ps = projects.filter((p) => live.has(p.id) && needing.has(p.id) && !['archived', 'completed'].includes(p.status));
  return assess({
    requirement: def, fields: v.extraction.fields ?? {}, kind: v.extraction.kind, kindConfidence: v.extraction.kindConfidence,
    subcontractor: sub, orgName: org.name, projects: ps.map((p) => ({ id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate })),
    today: todayIn(org.settings.timezone, svc.now()), nowIso: svc.now().toISOString(),
  });
}

/** The pipeline for a stored version. Idempotent: an unchanged, already-read file is never sent to the AI again. */
export async function processVersion(svc: Services, orgId: string, versionId: string) {
  const path = C.doc(orgId, 'versions', versionId);
  const [v, org] = await Promise.all([svc.db.get<DocumentVersion>(path), svc.db.get<Organisation>(C.org(orgId))]);
  if (!v || !org || !v.storagePath || v.scan.status !== 'clean') return { skipped: true };
  if (v.extraction.status === 'completed') return { skipped: true, reason: 'already read' };

  // Same bytes already read for this organisation (another version, or an email attachment)?
  let extraction: Extraction | null = null;
  if (v.sha256) {
    const prior = (await svc.db.list<DocumentVersion>(C.col(orgId, 'versions'), [['sha256', '==', v.sha256]]))
      .filter((x) => x.id !== v.id && x.extraction.status === 'completed' && !x.extraction.reusedFrom)[0];
    if (prior) extraction = { ...prior.extraction, reusedFrom: prior.id, usage: { inputTokens: 0, outputTokens: 0, calls: 0 } };
    if (!extraction) {
      const intake = (await svc.db.list<any>(C.col(orgId, 'intake'), [['sha256', '==', v.sha256]])).find((x) => x.extraction?.status === 'completed');
      if (intake) extraction = { ...intake.extraction, reusedFrom: `intake:${intake.id}`, usage: { inputTokens: 0, outputTokens: 0, calls: 0 } };
    }
  }
  if (!extraction) {
    if (!svc.ai) { await svc.db.update(path, { extraction: { status: 'not_configured' } }); return { skipped: true }; }
    await svc.db.update(path, { extraction: { status: 'processing', startedAt: svc.now().toISOString() } });
    const bytes = await svc.files.read(v.storagePath);
    extraction = bytes ? await readDocument(svc, org, bytes, v.mimeType, 'document') : { status: 'failed', error: 'Stored file not found' };
  }
  const next = { ...v, extraction };
  const assessment = await assessVersion(svc, org, next);
  await svc.db.update(path, { extraction, ...(assessment ? { assessment } : {}) });
  return { ok: extraction.status === 'completed', status: extraction.status };
}

// --- Development only ----------------------------------------------------------

/**
 * Offline reader for the local dev server and tests (DEV_AI=mock). It reads
 * "Label: value" lines from uncompressed test PDFs. It is never used in
 * production: getFirebaseServices only ever wires the Anthropic provider.
 */
export class MockAiProvider implements AiProvider {
  name = 'mock';
  async call(c: AiCall): Promise<AiResult> {
    const block = c.content.find((x) => x.type === 'document' || x.type === 'image');
    if (!block) {
      // Assistant calls: echo a grounded answer built from the snapshot the caller sent.
      const txt = c.content.map((x: any) => x.text ?? '').join('\n');
      const snap = txt.slice(txt.indexOf('DATA:') + 5).trim();
      let data: any = {}; try { data = JSON.parse(snap.slice(0, snap.lastIndexOf('}') + 1)); } catch { /* ignore */ }
      const notReady = (data.pairs ?? []).filter((p: any) => p.status !== 'Ready');
      const answer = notReady.length
        ? `${notReady.length} subcontractor${notReady.length === 1 ? ' isn’t' : 's aren’t'} ready:\n${notReady.map((p: any) => `- [[sub:${p.subcontractorId}|${p.subcontractor}]] on [[project:${p.projectId}|${p.project}]]: ${p.reason}`).join('\n')}`
        : 'Everyone assigned is ready.';
      const wantsReminders = /remind|chase|follow/i.test(txt.split('DATA:')[0]);
      const action = wantsReminders ? { type: 'send_reminders', items: notReady.filter((p: any) => p.outstanding?.length).map((p: any) => ({ subcontractorId: p.subcontractorId, projectId: p.projectId, requirementIds: p.outstanding.map((o: any) => o.requirementId) })) } : null;
      return { text: JSON.stringify({ answer, action }), inputTokens: Math.ceil(txt.length / 4), outputTokens: 200, model: c.model };
    }
    const raw = Buffer.from(block.source.data, 'base64').toString('latin1');
    const lines = [...raw.matchAll(/\(([^()]*)\)\s*Tj/g)].map((m) => m[1]);
    const text = (lines.length ? lines : raw.split(/\r?\n/)).join('\n');
    const find = (re: RegExp) => { const m = text.match(re); return m ? m[1].trim() : null; };
    const kind = /certificate of (liability )?insurance|insurance certificate|policy number/i.test(text) ? 'insurance_certificate'
      : /method statement|risk assessment|rams/i.test(text) ? 'method_statement'
        : /licen[cs]e|registration/i.test(text) ? 'licence_registration' : 'other';
    const page = 1;
    const fld = (label: RegExp, conf = 0.95) => { const v = find(label); return v ? { value: v, confidence: /\?/.test(v) ? 0.4 : conf, page, source: v } : { value: null, confidence: 0 }; };
    const money = (label: RegExp) => { const v = find(label); return v ? { value: Number(v.replace(/[^0-9.]/g, '')), confidence: 0.92, page, source: v } : { value: null, confidence: 0 }; };
    const fields: any = {
      namedInsured: fld(/(?:Named insured|Insured|Holder|Company):\s*(.+)/i),
      issuer: fld(/(?:Insurer|Issued by|Issuing body):\s*(.+)/i),
      referenceNumber: fld(/(?:Policy number|Licence number|Registration number|Reference):\s*(.+)/i),
      issueDate: fld(/(?:Effective|Issue date|Date):\s*(\d{4}-\d{2}-\d{2})/i),
      expiryDate: fld(/(?:Expiry|Expires|Expiry date):\s*(\d{4}-\d{2}-\d{2})/i),
      glEachOccurrence: money(/(?:Public liability|General liability|Each occurrence)[^:]*:\s*([0-9,]+)/i),
      glAggregate: money(/Aggregate[^:]*:\s*([0-9,]+)/i),
      elLimit: money(/Employers'? liability[^:]*:\s*([0-9,]+)/i),
      currency: fld(/Currency:\s*([A-Z]{3})/),
      wcCoverage: /employers'? liability|workers'? comp/i.test(text) ? { value: true, confidence: 0.9, page } : { value: null, confidence: 0 },
    };
    const out = { kind, kindConfidence: kind === 'other' ? 0.5 : 0.95, issues: [], fields };
    return { text: JSON.stringify(out), inputTokens: 1800, outputTokens: 350, model: c.model };
  }
}
