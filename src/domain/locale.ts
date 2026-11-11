// Market-aware terminology, formatting and defaults. The product never
// hardcodes one country's requirements; these only shape wording and the
// optional starter library an organisation can adopt and edit.
import type { Market, OrgSettings } from './types';

export const MARKETS: { id: Market; label: string; locale: 'en-US' | 'en-GB'; currency: 'USD' | 'GBP'; timezone: string }[] = [
  { id: 'US', label: 'United States', locale: 'en-US', currency: 'USD', timezone: 'America/Chicago' },
  { id: 'UK', label: 'United Kingdom', locale: 'en-GB', currency: 'GBP', timezone: 'Europe/London' },
  { id: 'OTHER', label: 'Other', locale: 'en-GB', currency: 'USD', timezone: 'UTC' },
];

export function marketFromCountry(country: string): Market {
  const c = country.toLowerCase();
  if (/united states|usa|^us$/.test(c)) return 'US';
  if (/united kingdom|england|scotland|wales|northern ireland|^uk$|great britain/.test(c)) return 'UK';
  return 'OTHER';
}

const TERMS = {
  US: { contractor: 'general contractor', Contractor: 'General contractor', coi: 'certificate of insurance', mobilise: 'mobilize', organisation: 'organization', licence: 'license' },
  UK: { contractor: 'principal contractor', Contractor: 'Principal contractor', coi: 'insurance certificate', mobilise: 'mobilise', organisation: 'organisation', licence: 'licence' },
  OTHER: { contractor: 'main contractor', Contractor: 'Main contractor', coi: 'insurance certificate', mobilise: 'mobilise', organisation: 'organisation', licence: 'licence' },
} as const;

export type TermKey = keyof (typeof TERMS)['US'];
export function term(market: Market | undefined, k: TermKey): string { return TERMS[market ?? 'OTHER'][k]; }

// Formatting locale, set once from the signed-in organisation.
let activeLocale: 'en-US' | 'en-GB' = 'en-GB';
let activeCurrency: 'USD' | 'GBP' = 'USD';
export function setFormatting(s?: Partial<Pick<OrgSettings, 'locale' | 'currency'>>) {
  if (s?.locale) activeLocale = s.locale;
  if (s?.currency) activeCurrency = s.currency;
}
export function getLocale() { return activeLocale; }
export function money(n: number, currency = activeCurrency) {
  return n.toLocaleString(activeLocale, { style: 'currency', currency, maximumFractionDigits: 0 });
}

/** Server-side: switch date/currency formatting to an organisation's settings for the current unit of work. */
export function applyOrgFormatting(s?: Partial<Pick<OrgSettings, 'locale' | 'currency'>>) {
  activeLocale = s?.locale ?? 'en-GB';
  activeCurrency = s?.currency ?? 'GBP';
}
