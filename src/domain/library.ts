// Starter requirement library and templates. These are editable starting points
// an organisation can adopt; they are not legal standards for any jurisdiction.
import type { Criterion, RequirementDefinition } from './types';

type Starter = Omit<RequirementDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'active'> & { key: string };

type Market = 'US' | 'UK' | 'OTHER';

function base(market: Market): Starter[] {
  const uk = market === 'UK';
  const cur = uk ? 'GBP' : 'USD';
  const lim = (us: number, gb: number) => (uk ? gb : us);
  const gl: Criterion[] = [
    { key: 'glEachOccurrence', label: uk ? 'Public liability, any one occurrence' : 'General liability, each occurrence', type: 'min_amount', value: lim(1_000_000, 5_000_000), currency: cur },
    ...(uk ? [] : [{ key: 'glAggregate', label: 'General liability, aggregate', type: 'min_amount' as const, value: 2_000_000, currency: cur }]),
  ];
  const coi = uk ? 'Insurance certificate' : 'Certificate of insurance';
  return [
    {
      key: 'gl', name: uk ? 'Public liability insurance' : 'General liability insurance', category: 'Insurance', kind: 'document',
      description: uk ? 'Insurance certificate or schedule showing current public liability cover.' : 'Certificate of insurance (ACORD 25 or equivalent) showing current general liability cover.',
      subTypes: [], defaultMandatory: true, documentType: coi, expiryRequired: true, renewal: 'on_expiry', reviewRequired: true, criteria: gl,
      instructions: `Upload your current ${coi.toLowerCase()}. It must show the insurer, policy number, policy dates and limits.`,
    },
    {
      key: 'wc', name: uk ? "Employers' liability insurance" : "Workers' compensation insurance", category: 'Insurance', kind: 'document',
      description: uk ? "Employers' liability certificate (a legal requirement for most UK employers)." : "Evidence of workers' compensation cover, or a valid exemption where your state allows one.",
      subTypes: [], defaultMandatory: true, documentType: coi, expiryRequired: true, renewal: 'on_expiry', reviewRequired: true,
      criteria: uk ? [{ key: 'elLimit', label: "Employers' liability limit", type: 'min_amount', value: 10_000_000, currency: cur }] : [{ key: 'wcCoverage', label: "Workers' compensation coverage shown", type: 'boolean', value: true }],
      instructions: uk ? "Upload your current employers' liability certificate." : "Upload your workers' compensation certificate or exemption.",
    },
    {
      key: 'auto', name: uk ? 'Commercial vehicle insurance' : 'Commercial auto insurance', category: 'Insurance', kind: 'document',
      description: 'Liability cover for vehicles used on site or for deliveries.', subTypes: [], defaultMandatory: true, documentType: coi,
      expiryRequired: true, renewal: 'on_expiry', reviewRequired: true,
      criteria: uk ? [] : [{ key: 'autoCombinedSingleLimit', label: 'Auto liability, combined single limit', type: 'min_amount', value: 1_000_000, currency: cur }],
    },
    {
      key: 'umbrella', name: uk ? 'Excess liability insurance' : 'Umbrella / excess liability', category: 'Insurance', kind: 'document',
      description: 'Excess cover above primary liability limits.', subTypes: [], defaultMandatory: false, documentType: coi, expiryRequired: true,
      renewal: 'on_expiry', reviewRequired: true, criteria: [{ key: 'umbrellaLimit', label: 'Excess limit', type: 'min_amount', value: lim(5_000_000, 5_000_000), currency: cur }],
    },
    uk ? {
      key: 'ai', name: 'Indemnity to principal', category: 'Insurance', kind: 'document',
      description: 'Policy wording or endorsement extending an indemnity to the principal contractor, where your contract requires it.', subTypes: [],
      defaultMandatory: false, documentType: 'Endorsement', expiryRequired: true, renewal: 'on_expiry', reviewRequired: true,
      criteria: [{ key: 'additionalInsured', label: 'Indemnity to principal shown', type: 'boolean', value: true }],
    } : {
      key: 'ai', name: 'Additional insured endorsement', category: 'Insurance', kind: 'document',
      description: 'Endorsement naming the general contractor (and owner, where required) as additional insured, with waiver of subrogation.', subTypes: [],
      defaultMandatory: true, documentType: 'Endorsement', expiryRequired: true, renewal: 'on_expiry', reviewRequired: true,
      criteria: [{ key: 'additionalInsured', label: 'Additional insured status', type: 'boolean', value: true }, { key: 'waiverOfSubrogation', label: 'Waiver of subrogation', type: 'boolean', value: true }],
    },
    {
      key: 'pl', name: 'Professional indemnity insurance', category: 'Insurance', kind: 'document',
      description: 'Required where the subcontractor provides design services.', subTypes: ['design', 'mechanical', 'civil'],
      defaultMandatory: false, documentType: coi, expiryRequired: true, renewal: 'on_expiry', reviewRequired: true, criteria: [],
    },
    uk ? {
      key: 'biz', name: 'Company registration', category: 'Registration', kind: 'document',
      description: 'Certificate of incorporation or Companies House record (or sole-trader confirmation).', subTypes: [], defaultMandatory: true,
      documentType: 'Registration', expiryRequired: false, renewal: 'none', reviewRequired: true, criteria: [],
    } : {
      key: 'biz', name: 'Business license', category: 'Licensing', kind: 'document',
      description: 'Current business license or registration to operate in the project jurisdiction.', subTypes: [], defaultMandatory: true,
      documentType: 'License', expiryRequired: false, renewal: 'on_expiry', reviewRequired: true, criteria: [],
    },
    {
      key: 'elec', name: uk ? 'Electrical competent person registration' : 'Electrical contractor license', category: uk ? 'Registration' : 'Licensing', kind: 'document',
      description: uk ? 'NICEIC, NAPIT or equivalent competent person scheme registration.' : 'State electrical contractor license for the project jurisdiction.',
      subTypes: ['electrical'], defaultMandatory: true, documentType: uk ? 'Registration' : 'License', expiryRequired: true, renewal: 'on_expiry', reviewRequired: true, criteria: [],
    },
    {
      key: 'plumb', name: uk ? 'Gas Safe registration' : 'Plumbing contractor license', category: uk ? 'Registration' : 'Licensing', kind: 'document',
      description: uk ? 'Gas Safe Register entry for engineers carrying out gas work.' : 'State or municipal plumbing license for the project jurisdiction.',
      subTypes: ['plumbing'], defaultMandatory: true, documentType: uk ? 'Registration' : 'License', expiryRequired: true, renewal: 'on_expiry', reviewRequired: true, criteria: [],
    },
    {
      key: 'safety', name: uk ? 'Health and safety accreditation' : 'Safety program and EMR', category: 'Health & safety', kind: 'document',
      description: uk ? 'CHAS, SafeContractor, Constructionline or another SSIP-recognised accreditation.' : 'Written safety program and current experience modification rate (EMR) letter.',
      subTypes: [], defaultMandatory: true, documentType: 'Certificate', expiryRequired: true, renewal: 'on_expiry', reviewRequired: true, criteria: [],
    },
    {
      key: 'training', name: uk ? 'CSCS cards for site operatives' : 'OSHA 10/30 training records', category: 'Health & safety', kind: 'manual_check',
      description: uk ? 'Confirm every operative attending site holds a valid CSCS (or equivalent) card.' : 'Confirm site workers hold OSHA 10 and supervisors OSHA 30 cards.',
      subTypes: [], defaultMandatory: false, expiryRequired: false, renewal: 'periodic', renewalPeriodDays: 180, reviewRequired: false, criteria: [],
    },
    {
      key: 'rams', name: uk ? 'Risk assessment and method statement (RAMS)' : 'Job hazard analysis', category: 'Health & safety', kind: 'document',
      description: uk ? 'Project-specific RAMS covering the subcontract scope.' : 'Project-specific job hazard analysis (JHA) for the scope of work.',
      subTypes: [], defaultMandatory: true, documentType: uk ? 'RAMS' : 'JHA', expiryRequired: false, renewal: 'none', reviewRequired: true, criteria: [],
    },
    {
      key: 'tax', name: uk ? 'CIS verification' : 'Form W-9', category: 'Tax', kind: uk ? 'manual_check' : 'document',
      description: uk ? 'Confirm the subcontractor has been verified with HMRC under the Construction Industry Scheme.' : 'Signed IRS Form W-9 with the taxpayer identification number.',
      subTypes: [], defaultMandatory: true, documentType: uk ? undefined : 'Tax form', expiryRequired: false, renewal: 'none', reviewRequired: !uk, criteria: [],
    },
    {
      key: 'agreement', name: 'Signed subcontract agreement', category: 'Contractual', kind: 'document',
      description: 'Executed subcontract or master subcontract agreement.', subTypes: [], defaultMandatory: true,
      documentType: 'Agreement', expiryRequired: false, renewal: 'none', reviewRequired: true, criteria: [],
    },
    {
      key: 'declaration', name: 'Annual compliance declaration', category: 'Declarations', kind: 'declaration',
      description: 'Yearly confirmation that there are no outstanding enforcement actions and that required training is current.', subTypes: [],
      defaultMandatory: false, expiryRequired: false, renewal: 'periodic', renewalPeriodDays: 365, reviewRequired: false, criteria: [],
    },
  ] as Starter[];
}

export function starterRequirements(market: Market = 'OTHER') { return base(market); }
/** @deprecated use starterRequirements(market) */
export const STARTER_REQUIREMENTS: Starter[] = base('US');

export const STARTER_TEMPLATES: { name: string; description: string; items: [string, boolean][] }[] = [
  { name: 'General subcontractor onboarding', description: 'Baseline paperwork for any trade.', items: [['gl', true], ['wc', true], ['biz', true], ['tax', true], ['agreement', true], ['safety', true]] },
  { name: 'Electrical subcontractor', description: 'Baseline plus electrical licensing and site safety.', items: [['gl', true], ['wc', true], ['biz', true], ['elec', true], ['safety', true], ['rams', true], ['tax', true], ['agreement', true]] },
  { name: 'Plumbing and heating subcontractor', description: 'Baseline plus plumbing/gas licensing.', items: [['gl', true], ['wc', true], ['biz', true], ['plumb', true], ['rams', true], ['tax', true], ['agreement', true]] },
  { name: 'Roofing subcontractor', description: 'Work at height: accreditation and method statements.', items: [['gl', true], ['wc', true], ['umbrella', false], ['safety', true], ['rams', true], ['biz', true], ['agreement', true]] },
  { name: 'Mechanical subcontractor', description: 'HVAC and mechanical services.', items: [['gl', true], ['wc', true], ['auto', true], ['pl', false], ['safety', true], ['rams', true], ['agreement', true]] },
  { name: 'Civil engineering subcontractor', description: 'Groundworks and civils with plant on site.', items: [['gl', true], ['wc', true], ['auto', true], ['umbrella', true], ['pl', false], ['safety', true], ['rams', true], ['agreement', true]] },
  { name: 'Specialist contractor', description: 'Specialist packages with design input.', items: [['gl', true], ['wc', true], ['pl', true], ['rams', true], ['agreement', true]] },
  { name: 'High-risk work contractor', description: 'Demolition, confined spaces, hot works and similar.', items: [['gl', true], ['wc', true], ['auto', true], ['umbrella', true], ['ai', true], ['safety', true], ['training', true], ['rams', true], ['declaration', true], ['agreement', true]] },
];

export const SUB_TYPES = ['general', 'electrical', 'plumbing', 'roofing', 'mechanical', 'civil', 'design', 'specialist', 'high_risk'];

export const DOCUMENT_TYPES = ['Certificate of insurance', 'Insurance certificate', 'Endorsement', 'License', 'Licence', 'Certificate', 'Policy', 'RAMS', 'JHA', 'Registration', 'Tax form', 'Agreement', 'Other'];

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
  { key: 'glEachOccurrence', label: 'Liability limit, each occurrence', type: 'amount' },
  { key: 'glAggregate', label: 'Liability limit, aggregate', type: 'amount' },
  { key: 'elLimit', label: "Employers' liability limit", type: 'amount' },
  { key: 'autoCombinedSingleLimit', label: 'Auto combined single limit', type: 'amount' },
  { key: 'umbrellaLimit', label: 'Excess / umbrella limit', type: 'amount' },
  { key: 'wcCoverage', label: "Workers' comp / EL cover shown", type: 'boolean' },
  { key: 'additionalInsured', label: 'Additional insured', type: 'boolean' },
  { key: 'waiverOfSubrogation', label: 'Waiver of subrogation', type: 'boolean' },
];
