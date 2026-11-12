// Field-level accuracy of document reading against a fixture set with known
// answers (tests/fixtures/certificates/truth.json). Runs the real pipeline
// (readDocument: fast model first, second look when unsure) and the
// deterministic comparison, so the result describes what customers get.
//
// Scoring per field:
//   correct           right value, read confidently
//   correct_unsure    right value, but flagged for a person to check (safe, costs time)
//   wrong_flagged     wrong value, flagged as unsure (safe: a person is asked)
//   wrong_confident   wrong value read confidently  <- dangerous: could pass a check
//   missed            not read at all (safe, costs time)
//   overconfident     a value that should be uncertain (e.g. ambiguous date) read confidently <- dangerous
// Reading accuracy is NOT compliance: a correct reading only means the
// document says this. Approval and independent verification stay separate.
import fs from 'node:fs';
import path from 'node:path';
import { assess, TRUST } from '../src/domain/assessment';
import type { Extraction, Organisation } from '../src/domain/types';
import { readDocument } from './ai';
import type { Services } from './services';

export interface Fixture { file: string; kind: string; fields: Record<string, string | number | boolean>; note: string; expectLowConfidence: string[] }
type Outcome = 'correct' | 'correct_unsure' | 'wrong_flagged' | 'wrong_confident' | 'missed' | 'overconfident' | 'uncertain_ok';

/** What the comparison should conclude for documents that are meant to fail or pass. */
const CHECK_EXPECTATIONS: Record<string, { subName: string; triage: 'looks_good' | 'problem' | 'check' }> = {
  'us-acord-clean.pdf': { subName: 'Keystone Plumbing LLC', triage: 'looks_good' },
  'wrong-company.pdf': { subName: 'Pennine Roofing Ltd', triage: 'problem' },
  'expired.pdf': { subName: 'Keystone Plumbing LLC', triage: 'problem' },
  'low-limit.pdf': { subName: 'Brookside Painting Co', triage: 'problem' },
};
const GL_REQUIREMENT = { name: 'General liability insurance', category: 'Insurance', documentType: 'Certificate of insurance', expiryRequired: true, version: 1, criteria: [{ key: 'glEachOccurrence', label: 'General liability, each occurrence', type: 'min_amount' as const, value: 1_000_000, currency: 'USD' }] };

const norm = (v: unknown) => String(v).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
function same(a: unknown, b: unknown) {
  if (typeof b === 'number') return Number(a) === b;
  if (typeof b === 'boolean') return a === b;
  return norm(a) === norm(b);
}

export function fixtureDir() {
  const candidates = [
    path.resolve(process.cwd(), 'tests/fixtures/certificates'),
    path.resolve(process.env.LAMBDA_TASK_ROOT ?? '', 'tests/fixtures/certificates'),
    ...(typeof __dirname !== 'undefined' ? [path.resolve(__dirname, '../tests/fixtures/certificates'), path.resolve(__dirname, '../../tests/fixtures/certificates')] : []),
  ];
  const hit = candidates.find((d) => fs.existsSync(path.join(d, 'truth.json')));
  if (!hit) throw new Error(`Fixture set not found (looked in ${candidates.join(', ')})`);
  return hit;
}

export function scoreDocument(f: Fixture, x: Extraction) {
  const fields = x.fields ?? {};
  const rows: { field: string; expected: unknown; read: unknown; confidence: number; outcome: Outcome; source?: string; page?: number }[] = [];
  for (const [k, expected] of Object.entries(f.fields)) {
    const r = fields[k];
    const read = r?.value ?? null; const conf = r?.confidence ?? 0;
    let outcome: Outcome;
    if (read === null || read === undefined || read === '') outcome = 'missed';
    else if (same(read, expected)) outcome = conf >= TRUST ? 'correct' : 'correct_unsure';
    else outcome = conf >= TRUST ? 'wrong_confident' : 'wrong_flagged';
    rows.push({ field: k, expected, read, confidence: conf, outcome, source: r?.source, page: r?.page });
  }
  for (const k of f.expectLowConfidence) {
    const r = fields[k];
    const confident = r && r.value !== null && r.confidence >= TRUST;
    rows.push({ field: `${k} (should be uncertain)`, expected: 'uncertain', read: r?.value ?? null, confidence: r?.confidence ?? 0, outcome: confident ? 'overconfident' : 'uncertain_ok' });
  }
  return rows;
}

export async function runEval(svc: Services, opts: { only?: string[]; today?: string } = {}) {
  if (!svc.ai) throw new Error('No AI provider configured');
  const dir = fixtureDir();
  const fixtures: Fixture[] = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8')).filter((f: Fixture) => !opts.only?.length || opts.only.includes(f.file));
  // An isolated pseudo-organisation: usage is metered here, never against a customer.
  const org = { id: '_eval', name: 'Harbourline Construction', settings: { timezone: 'UTC' }, subscription: { plan: 'scale', status: 'active', interval: 'month' } } as unknown as Organisation;
  const today = opts.today ?? svc.now().toISOString().slice(0, 10);
  const docs: any[] = [];
  for (const f of fixtures) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f.file)));
    const mime = f.file.endsWith('.pdf') ? 'application/pdf' : f.file.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const t0 = Date.now();
    const x = await readDocument(svc, org, bytes, mime, 'eval');
    const rows = x.status === 'completed' ? scoreDocument(f, x) : Object.keys(f.fields).map((k) => ({ field: k, expected: f.fields[k], read: null, confidence: 0, outcome: 'missed' as Outcome }));
    const exp = CHECK_EXPECTATIONS[f.file];
    const check = exp && x.status === 'completed' ? assess({ requirement: GL_REQUIREMENT, fields: x.fields ?? {}, kind: x.kind, kindConfidence: x.kindConfidence, subcontractor: { legalName: exp.subName }, orgName: org.name, projects: [], today, nowIso: new Date().toISOString() }) : undefined;
    docs.push({
      file: f.file, note: f.note, status: x.status, error: x.error, skippedReason: x.skippedReason, ms: Date.now() - t0,
      kindExpected: f.kind, kindRead: x.kind, kindConfidence: x.kindConfidence, kindCorrect: x.kind === f.kind,
      model: x.model, escalated: !!x.escalated, usage: x.usage, issues: x.issues ?? [], rows,
      check: check ? { expected: exp!.triage, got: check.triage, ok: check.triage === exp!.triage, summary: check.summary } : undefined,
    });
  }
  const all = docs.flatMap((d) => d.rows);
  const count = (o: Outcome) => all.filter((r) => r.outcome === o).length;
  const scored = all.filter((r) => !String(r.field).includes('(should be uncertain)'));
  const summary = {
    documents: docs.length, readOk: docs.filter((d) => d.status === 'completed').length,
    kindCorrect: docs.filter((d) => d.kindCorrect).length,
    fields: scored.length,
    correct: count('correct'), correctUnsure: count('correct_unsure'), wrongFlagged: count('wrong_flagged'),
    wrongConfident: count('wrong_confident'), missed: count('missed'),
    uncertaintyChecks: all.length - scored.length, overconfident: count('overconfident'),
    accuracyConfident: scored.length ? +(count('correct') / scored.length).toFixed(3) : 0,
    accuracyAnyConfidence: scored.length ? +((count('correct') + count('correct_unsure')) / scored.length).toFixed(3) : 0,
    dangerous: count('wrong_confident') + count('overconfident'),
    checksOk: docs.filter((d) => d.check?.ok).length, checks: docs.filter((d) => d.check).length,
    escalations: docs.filter((d) => d.escalated).length,
    tokens: docs.reduce((n, d) => n + (d.usage?.inputTokens ?? 0) + (d.usage?.outputTokens ?? 0), 0),
    models: [...new Set(docs.map((d) => d.model).filter(Boolean))],
  };
  const byField: Record<string, Record<string, number>> = {};
  for (const r of scored) { const k = r.field; byField[k] ??= {}; byField[k][r.outcome] = (byField[k][r.outcome] ?? 0) + 1; }
  return { at: new Date().toISOString(), today, summary, byField, docs };
}

export function toMarkdown(rep: any) {
  const s = rep.summary;
  const lines = [
    `# Extraction accuracy — ${rep.at}`, '',
    `${s.documents} documents · ${s.fields} fields · models: ${s.models.join(', ')}`, '',
    `| Measure | Result |`, `| --- | --- |`,
    `| Documents read | ${s.readOk}/${s.documents} |`,
    `| Document type correct | ${s.kindCorrect}/${s.documents} |`,
    `| Fields correct and confident | ${s.correct}/${s.fields} (${(s.accuracyConfident * 100).toFixed(1)}%) |`,
    `| Fields correct, any confidence | ${s.correct + s.correctUnsure}/${s.fields} (${(s.accuracyAnyConfidence * 100).toFixed(1)}%) |`,
    `| Wrong but flagged for a person | ${s.wrongFlagged} |`,
    `| **Wrong and confident (dangerous)** | **${s.wrongConfident}** |`,
    `| Missed | ${s.missed} |`,
    `| **Overconfident on ambiguous values** | **${s.overconfident}/${s.uncertaintyChecks}** |`,
    `| Requirement checks reaching the expected result | ${s.checksOk}/${s.checks} |`,
    `| Second looks by the stronger model | ${s.escalations} |`, '',
  ];
  for (const d of rep.docs) {
    lines.push(`## ${d.file}`, '', `${d.note}. Status ${d.status}${d.error ? ` (${d.error})` : ''}; type ${d.kindRead} (${d.kindCorrect ? 'correct' : `expected ${d.kindExpected}`}); ${d.ms} ms${d.escalated ? '; second look' : ''}.${d.check ? ` Check: ${d.check.got} (expected ${d.check.expected}) — ${d.check.summary}` : ''}`, '');
    lines.push('| Field | Expected | Read | Confidence | Outcome |', '| --- | --- | --- | --- | --- |');
    for (const r of d.rows) lines.push(`| ${r.field} | ${r.expected} | ${r.read ?? '—'} | ${Math.round(r.confidence * 100)}% | ${r.outcome} |`);
    if (d.issues.length) lines.push('', `Issues raised: ${d.issues.join('; ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
