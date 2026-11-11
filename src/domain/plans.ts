// Plan catalogue. Defaults live here; the server can override the whole
// catalogue with the PLANS_JSON environment variable, so pricing and limits
// are configuration, not code. Stripe price IDs come from environment too.

export interface Plan {
  id: string;
  name: string;
  description: string;
  monthly: number; // USD per month when billed monthly
  annual: number; // USD per month when billed annually
  monthlyGbp?: number; // GBP equivalents for UK customers
  annualGbp?: number;
  limits: { activeSubcontractors: number | null; activeProjects: number | null; users: number | null; storageGb: number | null; aiDocuments?: number | null };
  features: string[];
}

export const TRIAL_DAYS = 14;

export const DEFAULT_PLANS: Plan[] = [
  {
    id: 'starter', name: 'Starter', description: 'For contractors tracking a core group of trades.',
    monthly: 89, annual: 74, monthlyGbp: 75, annualGbp: 62,
    limits: { activeSubcontractors: 30, activeProjects: 5, users: 3, storageGb: 10, aiDocuments: 150 },
    features: ['Project-specific requirements', 'Secure submission links', 'Automatic document reading', 'Automatic reminders and chasing', 'Email intake'],
  },
  {
    id: 'growth', name: 'Growth', description: 'For contractors running several live projects at once.',
    monthly: 229, annual: 189, monthlyGbp: 189, annualGbp: 159,
    limits: { activeSubcontractors: 150, activeProjects: 25, users: 12, storageGb: 50, aiDocuments: 750 },
    features: ['Everything in Starter', 'Ask questions about your paperwork', 'Escalation rules', 'Audit trail reports', 'Custom roles and permissions'],
  },
  {
    id: 'scale', name: 'Scale', description: 'For established contractors with a large supply chain.',
    monthly: 499, annual: 415, monthlyGbp: 415, annualGbp: 345,
    limits: { activeSubcontractors: 500, activeProjects: null, users: null, storageGb: 250, aiDocuments: 3000 },
    features: ['Everything in Growth', 'Unlimited projects and users', 'Configurable retention', 'Priority support'],
  },
];

export function getPlan(plans: Plan[], id: string): Plan {
  return plans.find((p) => p.id === id) ?? plans[0];
}

export function planPrice(p: Plan, interval: 'month' | 'year', currency: 'USD' | 'GBP') {
  if (currency === 'GBP') return (interval === 'year' ? p.annualGbp : p.monthlyGbp) ?? (interval === 'year' ? p.annual : p.monthly);
  return interval === 'year' ? p.annual : p.monthly;
}
