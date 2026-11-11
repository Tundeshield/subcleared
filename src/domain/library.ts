// Starter requirement library and templates. These are editable starting points
// an organisation can adopt; they are not legal standards for any jurisdiction.
import type { Criterion, RequirementDefinition } from './types';

type Starter = Omit<RequirementDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'active'> & { key: string };

const gl: Criterion[] = [
  { key: 'glEachOccurrence', label: 'General liability, each occurrence', type: 'min_amount', value: 1_000_000 },
  { key: 'glAggregate', label: 'General liability, aggregate', type: 'min_amount', value: 2_000_000 },
];

export const STARTER_REQUIREMENTS: Starter[] = [
  {
    key: 'gl', name: 'General liability insurance', category: 'Insurance', kind: 'document',
    description: 'Certificate of insurance showing current general/public liability cover.',
    subTypes: [], defaultMandatory: true, documentType: 'Certificate of insurance', expiryRequired: true,
    renewal: 'on_expiry', reviewRequired: true, criteria: gl,
    instructions: 'Upload the current certificate of insurance. It must show the policy number, insurer, policy dates and limits.',
  },
  {
    key: 'wc', name: "Workers' compensation insurance", category: 'Insurance', kind: 'document',
    description: "Evidence of workers' compensation / employers' liability cover.",
    subTypes: [], defaultMandatory: true, documentType: 'Certificate of insurance', expiryRequired: true,
    renewal: 'on_expiry', reviewRequired: true,
    criteria: [{ key: 'wcCoverage', label: "Workers' compensation coverage shown", type: 'boolean', value: true }],
    instructions: "Upload your workers' compensation or employers' liability certificate.",
  },
  {
    key: 'auto', name: 'Commercial auto insurance', category: 'Insurance', kind: 'document',
    description: 'Commercial vehicle liability cover for vehicles used on site or for deliveries.',
    subTypes: [], defaultMandatory: true, documentType: 'Certificate of insurance', expiryRequired: true,
    renewal: 'on_expiry', reviewRequired: true,
    criteria: [{ key: 'autoCombinedSingleLimit', label: 'Auto liability, combined single limit', type: 'min_amount', value: 1_000_000 }],
  },
  {
    key: 'umbrella', name: 'Umbrella / excess liability', category: 'Insurance', kind: 'document',
    description: 'Excess liability cover above primary limits.', subTypes: [], defaultMandatory: false,
    documentType: 'Certificate of insurance', expiryRequired: true, renewal: 'on_expiry', reviewRequired: true,
    criteria: [{ key: 'umbrellaLimit', label: 'Umbrella limit', type: 'min_amount', value: 5_000_000 }],
  },
  {
    key: 'ai', name: 'Additional insured endorsement', category: 'Insurance', kind: 'document',
    description: 'Endorsement naming the general contractor as additional insured.', subTypes: [], defaultMandatory: true,
    documentType: 'Endorsement', expiryRequired: true, renewal: 'on_expiry', reviewRequired: true,
    criteria: [
      { key: 'additionalInsured', label: 'Additional insured status', type: 'boolean', value: true },
      { key: 'waiverOfSubrogation', label: 'Waiver of subrogation', type: 'boolean', value: true },
    ],
  },
  {
    key: 'pl', name: 'Professional liability insurance', category: 'Insurance', kind: 'document',
    description: 'Required where the subcontractor provides design services.', subTypes: ['design', 'mechanical', 'civil'],
    defaultMandatory: false, documentType: 'Certificate of insurance', expiryRequired: true, renewal: 'on_expiry', reviewRequired: true, criteria: [],
  },
  {
    key: 'biz', name: 'Business licence', category: 'Licensing', kind: 'document',
    description: 'Current business licence or registration to trade.', subTypes: [], defaultMandatory: true,
    documentType: 'Licence', expiryRequired: false, renewal: 'on_expiry', reviewRequired: true, criteria: [],
  },
  {
    key: 'elec', name: 'Electrical trade licence', category: 'Licensing', kind: 'document',
    description: 'Licence for the qualifying electrician or electrical contractor.', subTypes: ['electrical'],
    defaultMandatory: true, documentType: 'Licence', expiryRequired: true, renewal: 'on_expiry', reviewRequired: true, criteria: [],
  },
  {
    key: 'plumb', name: 'Plumbing / gas trade licence', category: 'Licensing', kind: 'document',
    description: 'Licence or registration for plumbing and gas work.', subTypes: ['plumbing'],
    defaultMandatory: true, documentType: 'Licence', expiryRequired: true, renewal: 'on_expiry', reviewRequired: true, criteria: [],
  },
  {
    key: 'safety', name: 'Safety certification', category: 'Health & safety', kind: 'document',
    description: 'Accredited health and safety certification or prequalification.', subTypes: [], defaultMandatory: true,
    documentType: 'Certificate', expiryRequired: true, renewal: 'on_expiry', reviewRequired: true, criteria: [],
  },
  {
    key: 'hsp', name: 'Health and safety policy', category: 'Health & safety', kind: 'document',
    description: 'Signed company health and safety policy.', subTypes: [], defaultMandatory: true,
    documentType: 'Policy', expiryRequired: false, renewal: 'annual', reviewRequired: true, criteria: [],
  },
  {
    key: 'rams', name: 'Risk assessment and method statement', category: 'Health & safety', kind: 'document',
    description: 'Project-specific risk assessment and method statement for the scope of work.', subTypes: [],
    defaultMandatory: true, documentType: 'RAMS', expiryRequired: false, renewal: 'none', reviewRequired: true, criteria: [],
  },
  {
    key: 'reg', name: 'Company registration', category: 'Corporate', kind: 'document',
    description: 'Certificate of incorporation or equivalent registration document.', subTypes: [], defaultMandatory: false,
    documentType: 'Registration', expiryRequired: false, renewal: 'none', reviewRequired: true, criteria: [],
  },
  {
    key: 'tax', name: 'Tax documentation', category: 'Corporate', kind: 'document',
    description: 'Tax form or tax registration evidence required in your jurisdiction (e.g. W-9, UTR, TIN).', subTypes: [],
    defaultMandatory: true, documentType: 'Tax form', expiryRequired: false, renewal: 'none', reviewRequired: true, criteria: [],
  },
  {
    key: 'agreement', name: 'Signed subcontractor agreement', category: 'Contractual', kind: 'document',
    description: 'Executed subcontract or master services agreement.', subTypes: [], defaultMandatory: true,
    documentType: 'Agreement', expiryRequired: false, renewal: 'none', reviewRequired: true, criteria: [],
  },
  {
    key: 'declaration', name: 'Annual compliance declaration', category: 'Declarations', kind: 'declaration',
    description: 'Periodic declaration that the subcontractor has no outstanding enforcement actions and maintains required training.', subTypes: [],
    defaultMandatory: false, expiryRequired: false, renewal: 'periodic', renewalPeriodDays: 365, reviewRequired: false, criteria: [],
  },
];

export const STARTER_TEMPLATES: { name: string; description: string; items: [string, boolean][] }[] = [
  { name: 'General subcontractor onboarding', description: 'Baseline paperwork for any trade.', items: [['gl', true], ['wc', true], ['biz', true], ['tax', true], ['agreement', true], ['hsp', true]] },
  { name: 'Electrical subcontractor', description: 'Baseline plus electrical licensing and safety.', items: [['gl', true], ['wc', true], ['biz', true], ['elec', true], ['safety', true], ['rams', true], ['tax', true], ['agreement', true]] },
  { name: 'Plumbing subcontractor', description: 'Baseline plus plumbing/gas licensing.', items: [['gl', true], ['wc', true], ['biz', true], ['plumb', true], ['rams', true], ['tax', true], ['agreement', true]] },
  { name: 'Roofing subcontractor', description: 'Work at height: safety certification and RAMS.', items: [['gl', true], ['wc', true], ['umbrella', false], ['safety', true], ['rams', true], ['biz', true], ['agreement', true]] },
  { name: 'Mechanical subcontractor', description: 'HVAC and mechanical services.', items: [['gl', true], ['wc', true], ['auto', true], ['pl', false], ['safety', true], ['rams', true], ['agreement', true]] },
  { name: 'Civil engineering subcontractor', description: 'Groundworks and civils with plant on site.', items: [['gl', true], ['wc', true], ['auto', true], ['umbrella', true], ['pl', false], ['safety', true], ['rams', true], ['agreement', true]] },
  { name: 'Specialist contractor', description: 'Specialist packages with design input.', items: [['gl', true], ['wc', true], ['pl', true], ['rams', true], ['agreement', true]] },
  { name: 'High-risk work contractor', description: 'Demolition, confined spaces, hot works and similar.', items: [['gl', true], ['wc', true], ['auto', true], ['umbrella', true], ['ai', true], ['safety', true], ['rams', true], ['declaration', true], ['agreement', true]] },
];

export const SUB_TYPES = ['general', 'electrical', 'plumbing', 'roofing', 'mechanical', 'civil', 'design', 'specialist', 'high_risk'];

export const DOCUMENT_TYPES = ['Certificate of insurance', 'Endorsement', 'Licence', 'Certificate', 'Policy', 'RAMS', 'Registration', 'Tax form', 'Agreement', 'Other'];

/** Metadata fields offered to reviewers and to AI extraction. */
export const METADATA_FIELDS: { key: string; label: string; type: 'text' | 'date' | 'amount' | 'boolean' }[] = [
  { key: 'documentType', label: 'Document type', type: 'text' },
  { key: 'namedInsured', label: 'Named insured / holder', type: 'text' },
  { key: 'issuer', label: 'Issuer or insurer', type: 'text' },
  { key: 'referenceNumber', label: 'Policy / reference number', type: 'text' },
  { key: 'issueDate', label: 'Issue / effective date', type: 'date' },
  { key: 'expiryDate', label: 'Expiry date', type: 'date' },
  { key: 'coverageType', label: 'Coverage type', type: 'text' },
  { key: 'jurisdiction', label: 'Jurisdiction', type: 'text' },
];

export const VALUE_FIELDS: { key: string; label: string; type: 'amount' | 'boolean' }[] = [
  { key: 'glEachOccurrence', label: 'GL each occurrence', type: 'amount' },
  { key: 'glAggregate', label: 'GL aggregate', type: 'amount' },
  { key: 'autoCombinedSingleLimit', label: 'Auto combined single limit', type: 'amount' },
  { key: 'umbrellaLimit', label: 'Umbrella / excess limit', type: 'amount' },
  { key: 'wcCoverage', label: "Workers' compensation shown", type: 'boolean' },
  { key: 'additionalInsured', label: 'Additional insured', type: 'boolean' },
  { key: 'waiverOfSubrogation', label: 'Waiver of subrogation', type: 'boolean' },
];
