// The right document, not just a readable one. Tax and company documents are told apart,
// employers' and public liability certificates are told apart, and anything uncertain goes to a person.
import { describe, expect, it } from 'vitest';
import { assess, currentTriage, RULES_VERSION } from '../src/domain/assessment';
import { expectedKinds } from '../src/domain/extraction';

const F = (v: any, confidence = 0.95) => ({ value: v, confidence, page: 1, source: String(v) });
const base = { subcontractor: { legalName: 'Thameside Electrical Services Ltd' }, orgName: 'Harbourline Construction', projects: [], today: '2026-11-12', nowIso: '2026-11-12T12:00:00Z' };
const company = { name: 'Company registration', category: 'Registration', documentType: 'Company registration', expiryRequired: false, version: 1, criteria: [] } as any;
const pl = { name: 'Public liability insurance', category: 'Insurance', documentType: 'Insurance certificate', expiryRequired: true, version: 1, criteria: [] } as any;
const el = { name: "Employers' liability insurance", category: 'Insurance', documentType: 'Insurance certificate', expiryRequired: true, version: 1, criteria: [] } as any;
const named = { namedInsured: F('Thameside Electrical Services Ltd') };
const kindOf = (a: any) => a.checks.find((c: any) => c.key === 'kind');

describe('document classification', () => {
  it('maps requirements to specific kinds', () => {
    expect(expectedKinds(company)).toEqual(['company_registration']);
    expect(expectedKinds({ name: 'Tax registration details', category: 'Tax' })).toEqual(['tax_registration']);
    expect(expectedKinds({ name: 'Form W-9', category: 'Tax' })).toEqual(['tax_registration']);
    expect(expectedKinds({ name: 'Business license', category: 'Licensing' })).toEqual(['licence_registration', 'company_registration']);
    expect(expectedKinds({ name: 'Gas Safe registration', category: 'Competence' })).toEqual(['licence_registration']);
  });
  it('a VAT registration certificate does not pass as a company registration', () => {
    const a = assess({ ...base, requirement: company, kind: 'tax_registration', kindConfidence: 0.95, kindScheme: 2, fields: { ...named, referenceNumber: F('GB 284 7716 52') } });
    expect(kindOf(a).outcome).toBe('fail');
    expect(a.triage).toBe('problem');
  });
  it('a tax clearance certificate does not pass as a company registration', () => {
    const a = assess({ ...base, requirement: company, kind: 'tax_registration', kindConfidence: 0.9, kindScheme: 2, fields: { ...named, expiryDate: F('2027-02-02') } });
    expect(a.triage).toBe('problem');
  });
  it('a certificate of incorporation passes as a company registration', () => {
    const a = assess({ ...base, requirement: company, kind: 'company_registration', kindConfidence: 0.95, kindScheme: 2, fields: { ...named, referenceNumber: F('09876543') } });
    expect(kindOf(a).outcome).toBe('pass');
    expect(a.triage).toBe('looks_good');
  });
  it("an employers' liability certificate does not pass as public liability", () => {
    const a = assess({ ...base, requirement: pl, kind: 'insurance_certificate', kindConfidence: 0.95, kindScheme: 2, fields: { ...named, expiryDate: F('2027-05-31'), elLimit: F(10_000_000), wcCoverage: F(true) } });
    expect(a.checks.find((c) => c.key === 'cover')?.outcome).toBe('fail');
    expect(a.triage).toBe('problem');
  });
  it("a public liability certificate does not pass as employers' liability", () => {
    const a = assess({ ...base, requirement: el, kind: 'insurance_certificate', kindConfidence: 0.95, kindScheme: 2, fields: { ...named, expiryDate: F('2027-05-31'), glEachOccurrence: F(5_000_000) } });
    expect(a.checks.find((c) => c.key === 'cover')?.outcome).toBe('fail');
    expect(a.triage).toBe('problem');
  });
  it('a combined certificate showing both covers satisfies either', () => {
    const fields = { ...named, expiryDate: F('2027-05-31'), glEachOccurrence: F(5_000_000), elLimit: F(10_000_000) };
    expect(assess({ ...base, requirement: pl, kind: 'insurance_certificate', kindConfidence: 0.95, kindScheme: 2, fields }).triage).toBe('looks_good');
    expect(assess({ ...base, requirement: el, kind: 'insurance_certificate', kindConfidence: 0.95, kindScheme: 2, fields }).triage).toBe('looks_good');
  });
  it('a certificate whose cover could not be read goes to a person', () => {
    const a = assess({ ...base, requirement: pl, kind: 'insurance_certificate', kindConfidence: 0.95, kindScheme: 2, fields: { ...named, expiryDate: F('2027-05-31') } });
    expect(a.checks.find((c) => c.key === 'cover')?.outcome).toBe('unclear');
    expect(a.triage).toBe('check');
  });
  it('an uncertain or unreadable kind goes to a person, never "looks right"', () => {
    expect(assess({ ...base, requirement: company, kind: 'company_registration', kindConfidence: 0.5, kindScheme: 2, fields: named }).triage).toBe('check');
    expect(assess({ ...base, requirement: company, kind: undefined, fields: named }).triage).toBe('check');
    expect(assess({ ...base, requirement: { name: 'Site induction record', category: 'Other', version: 1, criteria: [] } as any, kind: 'other', kindConfidence: 0.9, kindScheme: 2, fields: named }).triage).toBe('check');
  });
  it('a reading from before the split is not trusted for company or tax requirements', () => {
    const a = assess({ ...base, requirement: company, kind: 'licence_registration', kindConfidence: 0.95, fields: named });
    expect(kindOf(a).outcome).toBe('unclear');
    expect(a.triage).toBe('check');
  });
  it('stored results from older rules never count as "looks right"', () => {
    expect(currentTriage({ triage: 'looks_good' }, 'completed')).toBe('check');
    expect(currentTriage({ triage: 'looks_good', rulesVersion: RULES_VERSION }, 'completed')).toBe('looks_good');
    expect(currentTriage({ triage: 'problem' }, 'completed')).toBe('problem');
    expect(currentTriage(undefined, 'completed')).toBe('check');
  });
});
