// Compares what was read from a document with what the requirement asks for.
// Deterministic and explainable: every check states what was compared and why
// it passed, failed or is unclear. This is NOT a review decision and never
// approves anything; it tells the reviewer where to look.
import { describeCriterion, formatAmount } from './compliance';
import { daysBetween, formatDate } from './dates';
import { expectedKinds, KIND_LABELS, SCHEMAS, type DocumentKind } from './extraction';
import type { Assessment, AssessmentCheck, ExtractedField, RequirementDefinition } from './types';

/** Fields read below this confidence are treated as unread for comparisons. */
export const TRUST = 0.75;

const SUFFIXES = /\b(limited|ltd|llc|l\.l\.c|inc|incorporated|plc|llp|lp|co|company|corp|corporation|group|holdings|services|the|and|&)\b/g;
export function normaliseName(n: string) {
  return n.toLowerCase().replace(/&/g, ' and ').replace(/[.,'’"()\-/]/g, ' ').replace(SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
}
/** Same company? Allows legal suffix and punctuation differences, and a trading name. */
export function namesMatch(read: string, names: (string | undefined)[]) {
  const r = normaliseName(read);
  if (!r) return false;
  return names.filter(Boolean).some((n) => {
    const x = normaliseName(n!);
    return !!x && (x === r || (x.length >= 6 && r.includes(x)) || (r.length >= 6 && x.includes(r)));
  });
}

/** Bump when the comparison rules change: stored results from older rules no longer count as "looks right". */
export const RULES_VERSION = 2;

/** The triage to act on: a stored result from older rules is treated as needing a check. */
export function currentTriage(a: { triage?: string; rulesVersion?: number } | undefined, extractionStatus?: string): 'looks_good' | 'check' | 'problem' | 'not_read' {
  if (!a?.triage) return extractionStatus === 'completed' ? 'check' : 'not_read';
  if (a.triage === 'looks_good' && (a.rulesVersion ?? 1) < RULES_VERSION) return 'check';
  return a.triage as any;
}

export interface AssessInput {
  requirement: Pick<RequirementDefinition, 'name' | 'category' | 'documentType' | 'criteria' | 'expiryRequired' | 'version'> | null;
  fields: Record<string, ExtractedField>;
  kind?: string;
  kindConfidence?: number;
  kindScheme?: number;
  subcontractor: { legalName: string; tradingName?: string };
  /** The contractor's own name, to check the certificate holder. */
  orgName?: string;
  projects: { id: string; name: string; startDate?: string; endDate?: string }[];
  today: string;
  nowIso: string;
}

export function assess(i: AssessInput): Assessment {
  const checks: AssessmentCheck[] = [];
  const f = (k: string) => i.fields[k];
  const trusted = (k: string) => { const x = f(k); return x && x.value !== null && x.value !== '' && x.confidence >= TRUST ? x : undefined; };
  const ev = (x?: ExtractedField) => (x ? { page: x.page, source: x.source, confidence: x.confidence } : undefined);
  const req = i.requirement;

  // 1. Is it the kind of document the requirement asks for?
  if (req && i.kind) {
    const want = expectedKinds(req);
    const kindName = KIND_LABELS[i.kind as DocumentKind] ?? i.kind;
    const legacy = i.kind === 'licence_registration' && !i.kindScheme && !want.includes('licence_registration') && want.some((k) => k === 'company_registration' || k === 'tax_registration');
    if (legacy) {
      checks.push({ key: 'kind', label: 'Right kind of document', outcome: 'unclear', detail: 'Read before company and tax documents were told apart. Check which one this is.' });
    } else if (want.length && (i.kindConfidence ?? 0) >= TRUST) {
      checks.push(want.includes(i.kind as DocumentKind)
        ? { key: 'kind', label: 'Right kind of document', outcome: 'pass', detail: `Reads as ${kindName.toLowerCase()}.` }
        : { key: 'kind', label: 'Right kind of document', outcome: 'fail', detail: `Reads as ${kindName.toLowerCase()}, but ${req.name} needs ${KIND_LABELS[want[0]].toLowerCase()}.` });
    } else if (want.length) {
      checks.push({ key: 'kind', label: 'Right kind of document', outcome: 'unclear', detail: 'Couldn’t tell confidently what kind of document this is.' });
    }
  }
  // Reading a document isn't proof it's the right one: without a specific match, a person checks.
  if (req && !checks.some((c) => c.key === 'kind')) {
    checks.push({ key: 'kind', label: 'Right kind of document', outcome: 'unclear', detail: `Check this is the document ${req.name} asks for.` });
  }

  // 1b. Insurance: the right cover, not just an insurance certificate. Employers' liability and
  // public liability certificates look alike; a combined certificate showing both satisfies either.
  if (req && i.kind === 'insurance_certificate') {
    const s = `${req.category ?? ''} ${req.documentType ?? ''} ${req.name}`.toLowerCase();
    const wantsEl = /employers'? liability|workers'? comp/.test(s);
    const wantsPl = !wantsEl && /public liability|general liability/.test(s);
    const plShown = !!trusted('glEachOccurrence') || !!trusted('glAggregate');
    const elShown = !!trusted('elLimit') || (() => { const w = trusted('wcCoverage'); return !!w && (w.value === true || w.value === 'true'); })();
    const label = wantsEl ? `Shows ${/workers/.test(s) ? 'workers’ compensation' : 'employers’ liability'} cover` : 'Shows public or general liability cover';
    if (wantsEl || wantsPl) {
      const has = wantsEl ? elShown : plShown;
      const other = wantsEl ? plShown : elShown;
      checks.push(has
        ? { key: 'cover', label, outcome: 'pass', detail: 'The certificate lists this cover.' }
        : other
          ? { key: 'cover', label, outcome: 'fail', detail: wantsEl ? 'The certificate shows public or general liability, not employers’ liability or workers’ compensation.' : 'The certificate shows employers’ liability or workers’ compensation, not public or general liability.' }
          : { key: 'cover', label, outcome: 'unclear', detail: 'Couldn’t confirm which cover the certificate lists.' });
    }
  }

  // 2. Does it name this subcontractor?
  const named = f('namedInsured');
  const namedT = trusted('namedInsured');
  if (namedT) {
    const ok = namesMatch(String(namedT.value), [i.subcontractor.legalName, i.subcontractor.tradingName]);
    checks.push({ key: 'name', label: 'Names this subcontractor', outcome: ok ? 'pass' : 'fail', detail: ok ? `Shows “${namedT.value}”.` : `Shows “${namedT.value}”, not ${i.subcontractor.legalName}.`, evidence: ev(namedT) });
  } else {
    checks.push({ key: 'name', label: 'Names this subcontractor', outcome: 'unclear', detail: named?.value ? `Read “${named.value}”, but not confidently.` : 'No company name could be read.', evidence: ev(named) });
  }

  // 3. Dates: in date today, already in effect, and valid for each project.
  const exp = trusted('expiryDate');
  const expRaw = f('expiryDate');
  const needsExpiry = !!req?.expiryRequired;
  if (exp) {
    const d = String(exp.value);
    const days = daysBetween(i.today, d);
    checks.push(days < 0
      ? { key: 'expiry', label: 'In date', outcome: 'fail', detail: `Expired on ${formatDate(d)}.`, evidence: ev(exp) }
      : { key: 'expiry', label: 'In date', outcome: 'pass', detail: `Valid until ${formatDate(d)}.`, evidence: ev(exp) });
    if (days >= 0) {
      for (const p of i.projects) {
        if (!p.endDate) continue;
        if (d < p.endDate) checks.push({ key: `covers:${p.id}`, projectId: p.id, label: `Lasts for ${p.name}`, outcome: 'warn', detail: `Expires ${formatDate(d)}, before the project ends on ${formatDate(p.endDate)}. A renewal will be requested automatically before then.`, evidence: ev(exp) });
        else checks.push({ key: `covers:${p.id}`, projectId: p.id, label: `Lasts for ${p.name}`, outcome: 'pass', detail: `Covers the project to ${formatDate(p.endDate)}.` });
      }
    }
  } else if (needsExpiry) {
    checks.push({ key: 'expiry', label: 'In date', outcome: 'unclear', detail: expRaw?.value ? `Read ${expRaw.value} as the expiry date, but not confidently.` : 'No expiry date could be read. This requirement needs one.', evidence: ev(expRaw) });
  }
  const eff = trusted('issueDate');
  if (eff && daysBetween(i.today, String(eff.value)) > 0) {
    checks.push({ key: 'effective', label: 'Already in effect', outcome: 'warn', detail: `Starts on ${formatDate(String(eff.value))}.`, evidence: ev(eff) });
  }

  // 4. The requirement's own conditions (limits, endorsements).
  for (const c of req?.criteria ?? []) {
    const x = trusted(c.key);
    const raw = f(c.key);
    if (!x) {
      checks.push({ key: `crit:${c.key}`, label: describeCriterion(c), outcome: 'unclear', detail: raw?.value !== null && raw?.value !== undefined ? `Read ${String(raw.value)}, but not confidently.` : 'Not found on the document.', evidence: ev(raw) });
      continue;
    }
    if (c.type === 'min_amount') {
      const n = typeof x.value === 'number' ? x.value : Number(String(x.value).replace(/[^0-9.]/g, ''));
      const cur = trusted('currency')?.value;
      const curNote = c.currency && cur && String(cur).toUpperCase() !== c.currency.toUpperCase() ? ` The document's limits are in ${cur}, the requirement is in ${c.currency}.` : '';
      checks.push(curNote
        ? { key: `crit:${c.key}`, label: describeCriterion(c), outcome: 'unclear', detail: `Shows ${formatAmount(n)}.${curNote}`, evidence: ev(x) }
        : { key: `crit:${c.key}`, label: describeCriterion(c), outcome: n >= Number(c.value ?? 0) ? 'pass' : 'fail', detail: `Shows ${formatAmount(n, c.currency)}.`, evidence: ev(x) });
    } else if (c.type === 'boolean') {
      const yes = x.value === true || x.value === 'true';
      // A certificate can tick "additional insured" or "waiver" without the policy actually carrying that endorsement.
      const endorsementOnCertificate = yes && i.kind === 'insurance_certificate' && /additionalInsured|waiverOfSubrogation/.test(c.key);
      checks.push(endorsementOnCertificate
        ? { key: `crit:${c.key}`, label: describeCriterion(c), outcome: 'warn', detail: 'The certificate says so, but a certificate alone doesn’t prove the endorsement. Ask for the endorsement page if your contract relies on it.', evidence: ev(x) }
        : { key: `crit:${c.key}`, label: describeCriterion(c), outcome: yes ? 'pass' : 'fail', detail: yes ? 'Shown on the document.' : 'Not shown on the document.', evidence: ev(x) });
    } else if (c.type === 'text_equals') {
      const ok = String(x.value).trim().toLowerCase() === String(c.value ?? '').trim().toLowerCase();
      checks.push({ key: `crit:${c.key}`, label: describeCriterion(c), outcome: ok ? 'pass' : 'fail', detail: `Shows “${x.value}”.`, evidence: ev(x) });
    } else {
      checks.push({ key: `crit:${c.key}`, label: describeCriterion(c), outcome: 'pass', detail: `Shows “${x.value}”.`, evidence: ev(x) });
    }
  }

  // 4b. Certificate holder: usually the contractor itself.
  const holder = trusted('certificateHolder');
  if (holder && i.orgName && i.kind === 'insurance_certificate') {
    checks.push(namesMatch(String(holder.value), [i.orgName])
      ? { key: 'holder', label: 'Issued to you', outcome: 'pass', detail: `Certificate holder is “${holder.value}”.`, evidence: ev(holder) }
      : { key: 'holder', label: 'Issued to you', outcome: 'warn', detail: `Certificate holder is “${holder.value}”, not ${i.orgName}. Check whether your contract needs it issued to you.`, evidence: ev(holder) });
  }

  // 5. Anything critical for this kind of document that couldn't be read.
  const schema = SCHEMAS[(i.kind as DocumentKind)] ?? [];
  for (const s of schema.filter((x) => x.critical && !['namedInsured', 'expiryDate'].includes(x.key))) {
    const x = trusted(s.key);
    if (!x) checks.push({ key: `field:${s.key}`, label: s.label, outcome: 'unclear', detail: 'Couldn’t be read confidently.', evidence: ev(f(s.key)) });
    else if (s.type === 'boolean' && !(x.value === true || x.value === 'true')) checks.push({ key: `field:${s.key}`, label: s.label, outcome: 'fail', detail: 'Not shown on the document.', evidence: ev(x) });
  }

  const fails = checks.filter((c) => c.outcome === 'fail');
  const unclear = checks.filter((c) => c.outcome === 'unclear');
  // "Looks right" needs a specific positive match on the kind of document, never just a successful reading.
  const kindPassed = checks.some((c) => c.key === 'kind' && c.outcome === 'pass');
  const triage: Assessment['triage'] = fails.length ? 'problem' : unclear.length || !kindPassed ? 'check' : 'looks_good';
  const summary = triage === 'problem'
    ? `${fails.length} problem${fails.length === 1 ? '' : 's'}: ${fails.map((x) => x.label.toLowerCase()).join(', ')}.`
    : triage === 'check'
      ? `${unclear.length} thing${unclear.length === 1 ? '' : 's'} to check by eye: ${unclear.map((x) => x.label.toLowerCase()).join(', ')}.`
      : 'Everything that could be read matches the requirement. Confirm and approve.';
  return { triage, summary, checks, requirementVersion: req?.version, rulesVersion: RULES_VERSION, at: i.nowIso };
}
