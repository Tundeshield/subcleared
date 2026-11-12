// What SubCleared reads from each kind of document. Shared by the server
// (prompting and validation) and the client (labels). Insurance fields are
// only asked of insurance documents; other kinds get their own schema.
// Keys that also exist in METADATA_FIELDS / VALUE_FIELDS keep the same meaning,
// so reviewers can carry them straight into the confirmed record.

export type DocumentKind =
  | 'insurance_certificate'
  | 'insurance_endorsement'
  | 'licence_registration'
  | 'method_statement'
  | 'training_certificate'
  | 'agreement'
  | 'other';

export type FieldType = 'text' | 'date' | 'amount' | 'boolean';
export interface SchemaField { key: string; label: string; type: FieldType; critical?: boolean; hint?: string }

export const KIND_LABELS: Record<DocumentKind, string> = {
  insurance_certificate: 'Insurance certificate',
  insurance_endorsement: 'Insurance endorsement',
  licence_registration: 'Licence or registration',
  method_statement: 'Method statement or risk assessment',
  training_certificate: 'Training or competence card',
  agreement: 'Signed agreement',
  other: 'Other document',
};

const holder = (label: string): SchemaField => ({ key: 'namedInsured', label, type: 'text', critical: true });

export const SCHEMAS: Record<DocumentKind, SchemaField[]> = {
  insurance_certificate: [
    holder('Named insured'),
    { key: 'issuer', label: 'Insurer', type: 'text', hint: 'the insurance company (insurer A on an ACORD form), not the broker or producer' },
    { key: 'referenceNumber', label: 'Policy number', type: 'text', hint: 'the general or public liability policy number when several are listed' },
    { key: 'coverageType', label: 'Policy type', type: 'text' },
    { key: 'issueDate', label: 'Effective date', type: 'date', hint: 'the date cover starts (policy effective date, start of the period of insurance), NOT the date the certificate or schedule was printed or issued' },
    { key: 'expiryDate', label: 'Expiry date', type: 'date', critical: true, hint: 'the date cover ends; if policies end on different dates, the earliest one, and add an issue' },
    { key: 'glEachOccurrence', label: 'Liability limit, each occurrence', type: 'amount', hint: 'general or public liability limit per occurrence / any one occurrence' },
    { key: 'glAggregate', label: 'Liability limit, aggregate', type: 'amount' },
    { key: 'elLimit', label: "Employers' liability limit", type: 'amount', hint: "employers' liability limit, or the E.L. each accident limit" },
    { key: 'autoCombinedSingleLimit', label: 'Vehicle liability limit', type: 'amount' },
    { key: 'umbrellaLimit', label: 'Excess / umbrella limit', type: 'amount' },
    { key: 'wcCoverage', label: "Workers' comp / employers' liability shown", type: 'boolean', hint: "true if workers' compensation or employers' liability cover is listed as in force" },
    { key: 'additionalInsured', label: 'Additional insured / indemnity to principal shown', type: 'boolean' },
    { key: 'waiverOfSubrogation', label: 'Waiver of subrogation shown', type: 'boolean' },
    { key: 'certificateHolder', label: 'Certificate holder', type: 'text', hint: 'the organisation name in the certificate holder box (name only, no address)' },
    { key: 'currency', label: 'Currency of limits', type: 'text' },
  ],
  insurance_endorsement: [
    holder('Named insured'),
    { key: 'issuer', label: 'Insurer', type: 'text' },
    { key: 'referenceNumber', label: 'Policy number', type: 'text' },
    { key: 'issueDate', label: 'Effective date', type: 'date' },
    { key: 'expiryDate', label: 'Expiry date', type: 'date' },
    { key: 'additionalInsured', label: 'Additional insured / indemnity to principal', type: 'boolean' },
    { key: 'waiverOfSubrogation', label: 'Waiver of subrogation', type: 'boolean' },
    { key: 'additionalInsuredParties', label: 'Parties named', type: 'text' },
  ],
  licence_registration: [
    holder('Holder'),
    { key: 'issuer', label: 'Issuing body', type: 'text' },
    { key: 'referenceNumber', label: 'Licence or registration number', type: 'text' },
    { key: 'coverageType', label: 'Class or scope', type: 'text' },
    { key: 'jurisdiction', label: 'Jurisdiction', type: 'text' },
    { key: 'issueDate', label: 'Issue date', type: 'date' },
    { key: 'expiryDate', label: 'Expiry date', type: 'date', critical: true },
  ],
  method_statement: [
    holder('Company'),
    { key: 'projectReference', label: 'Project or site named', type: 'text' },
    { key: 'activities', label: 'Activities covered', type: 'text' },
    { key: 'author', label: 'Prepared by', type: 'text' },
    { key: 'revision', label: 'Revision', type: 'text' },
    { key: 'issueDate', label: 'Date', type: 'date' },
    { key: 'expiryDate', label: 'Review or expiry date', type: 'date', hint: 'the review date or expiry date printed on the document' },
  ],
  training_certificate: [
    holder('Card or certificate holder'),
    { key: 'coverageType', label: 'Qualification', type: 'text' },
    { key: 'issuer', label: 'Issuing body', type: 'text' },
    { key: 'referenceNumber', label: 'Card or certificate number', type: 'text' },
    { key: 'issueDate', label: 'Issue date', type: 'date' },
    { key: 'expiryDate', label: 'Expiry date', type: 'date', critical: true },
  ],
  agreement: [
    holder('Subcontractor named'),
    { key: 'counterparty', label: 'Other party', type: 'text' },
    { key: 'projectReference', label: 'Project named', type: 'text' },
    { key: 'issueDate', label: 'Date signed', type: 'date' },
    { key: 'signedByBoth', label: 'Signed by both parties', type: 'boolean', critical: true },
  ],
  other: [
    holder('Company or person named'),
    { key: 'documentType', label: 'What the document is', type: 'text' },
    { key: 'issuer', label: 'Issued by', type: 'text' },
    { key: 'referenceNumber', label: 'Reference number', type: 'text' },
    { key: 'issueDate', label: 'Issue date', type: 'date' },
    { key: 'expiryDate', label: 'Expiry date', type: 'date' },
  ],
};

export const ALL_KINDS = Object.keys(SCHEMAS) as DocumentKind[];

export function fieldLabel(key: string, kind?: string): string {
  const k = (kind && (SCHEMAS as any)[kind]) ? (SCHEMAS as any)[kind] as SchemaField[] : [];
  const hit = k.find((f) => f.key === key) ?? ALL_KINDS.flatMap((x) => SCHEMAS[x]).find((f) => f.key === key);
  return hit?.label ?? key;
}

/** Which document kind a requirement most likely expects, from its own configuration. */
export function expectedKinds(def: { category?: string; documentType?: string; name?: string; criteria?: { key: string }[] }): DocumentKind[] {
  const s = `${def.category ?? ''} ${def.documentType ?? ''} ${def.name ?? ''}`.toLowerCase();
  if (/endorse|indemnity to principal|additional insured/.test(s)) return ['insurance_endorsement', 'insurance_certificate'];
  if (/insur|certificate of insurance|coi|liability|compensation/.test(s)) return ['insurance_certificate', 'insurance_endorsement'];
  if (/licen[cs]e|registration|gas safe|niceic|napit|competent person/.test(s)) return ['licence_registration'];
  if (/rams|method statement|risk assessment|jha|safety plan/.test(s)) return ['method_statement'];
  if (/training|cscs|card|competen|qualification/.test(s)) return ['training_certificate'];
  if (/agreement|contract|subcontract/.test(s)) return ['agreement'];
  return [];
}
