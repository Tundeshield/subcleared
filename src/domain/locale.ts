// Market-aware terminology, formatting and defaults. The product never
// hardcodes one country's requirements; these only shape wording and the
// optional starter library an organisation can adopt and edit.
import type { Market, OrgSettings } from './types';

export const MARKETS: { id: Market; label: string; locale: string; currency: string; timezone: string }[] = [
  { id: 'US', label: 'United States conventions', locale: 'en-US', currency: 'USD', timezone: 'America/Chicago' },
  { id: 'UK', label: 'United Kingdom conventions', locale: 'en-GB', currency: 'GBP', timezone: 'Europe/London' },
  { id: 'OTHER', label: 'Neutral (international)', locale: 'en-GB', currency: 'USD', timezone: 'UTC' },
];

/** Countries offered at set-up. Each only proposes defaults — every value can be changed in Settings. */
export const COUNTRIES: { name: string; locale: string; currency: string; timezone: string }[] = [
  ['Australia', 'en-AU', 'AUD', 'Australia/Sydney'], ['Canada', 'en-CA', 'CAD', 'America/Toronto'], ['Denmark', 'en-DK', 'DKK', 'Europe/Copenhagen'],
  ['France', 'en-FR', 'EUR', 'Europe/Paris'], ['Germany', 'en-DE', 'EUR', 'Europe/Berlin'], ['Hong Kong', 'en-HK', 'HKD', 'Asia/Hong_Kong'],
  ['India', 'en-IN', 'INR', 'Asia/Kolkata'], ['Ireland', 'en-IE', 'EUR', 'Europe/Dublin'], ['Malaysia', 'en-MY', 'MYR', 'Asia/Kuala_Lumpur'],
  ['Netherlands', 'en-NL', 'EUR', 'Europe/Amsterdam'], ['New Zealand', 'en-NZ', 'NZD', 'Pacific/Auckland'], ['Norway', 'en-NO', 'NOK', 'Europe/Oslo'],
  ['Philippines', 'en-PH', 'PHP', 'Asia/Manila'], ['Qatar', 'en-QA', 'QAR', 'Asia/Qatar'], ['Saudi Arabia', 'en-SA', 'SAR', 'Asia/Riyadh'],
  ['Singapore', 'en-SG', 'SGD', 'Asia/Singapore'], ['South Africa', 'en-ZA', 'ZAR', 'Africa/Johannesburg'], ['Spain', 'en-ES', 'EUR', 'Europe/Madrid'],
  ['Sweden', 'en-SE', 'SEK', 'Europe/Stockholm'], ['Switzerland', 'en-CH', 'CHF', 'Europe/Zurich'], ['United Arab Emirates', 'en-AE', 'AED', 'Asia/Dubai'],
  ['United Kingdom', 'en-GB', 'GBP', 'Europe/London'], ['United States', 'en-US', 'USD', 'America/Chicago'], ['Other', 'en-GB', 'USD', 'UTC'],
].map(([name, locale, currency, timezone]) => ({ name, locale, currency, timezone }));
/** A best guess at the country from the browser's timezone, for a default the user can change. */
const ZONE_COUNTRY: [RegExp, string][] = [
  [/^Australia\//, 'Australia'], [/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal)$/, 'Canada'],
  [/^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Indiana\/.+|Kentucky\/.+)|Pacific\/Honolulu|US\/.+)$/, 'United States'],
  [/^Europe\/(London|Belfast|Guernsey|Isle_of_Man|Jersey)$/, 'United Kingdom'], [/^Pacific\/(Auckland|Chatham)$/, 'New Zealand'], [/^Asia\/(Kolkata|Calcutta)$/, 'India'],
];
export function countryFromTimezone(tz: string): string {
  const hit = COUNTRIES.find((c) => c.timezone === tz && c.name !== 'Other');
  if (hit) return hit.name;
  return ZONE_COUNTRY.find(([re]) => re.test(tz))?.[1] ?? 'Other';
}
export const countryDefaults = (country: string) => COUNTRIES.find((c) => c.name.toLowerCase() === country.toLowerCase()) ?? COUNTRIES[COUNTRIES.length - 1];
export const LOCALES = [...new Set(COUNTRIES.map((c) => c.locale))].sort();
export const CURRENCIES = [...new Set(COUNTRIES.map((c) => c.currency))].sort();
export const validLocale = (l: string) => { try { return Intl.DateTimeFormat.supportedLocalesOf([l]).length > 0; } catch { return false; } };
export const validCurrency = (c: string) => { try { new Intl.NumberFormat('en', { style: 'currency', currency: c }); return /^[A-Z]{3}$/.test(c); } catch { return false; } };
/** Stripe prices exist in USD and GBP; every other organisation currency bills in USD. */
export const billingCurrency = (c?: string): 'USD' | 'GBP' => (c === 'GBP' ? 'GBP' : 'USD');

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
let activeLocale = 'en-GB';
let activeCurrency = 'USD';
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

/** Plain-language reminder schedules. Each maps to the existing reminderSchedule setting; anything else is shown as custom. */
export const REMINDER_PRESETS: { id: string; label: string; schedule: number[] }[] = [
  { id: 'standard', label: 'Standard — 90, 60, 30, 14 and 7 days before expiry, on the day, and a week after', schedule: [90, 60, 30, 14, 7, 0, -7] },
  { id: 'fewer', label: 'Fewer — 30, 14 and 7 days before expiry, and on the day', schedule: [30, 14, 7, 0] },
  { id: 'early', label: 'Early and steady — 90, 60 and 30 days before expiry, then on the day', schedule: [90, 60, 30, 0] },
];
export function reminderPreset(schedule: number[]): string {
  const key = [...schedule].sort((a, b) => b - a).join(',');
  return REMINDER_PRESETS.find((p) => p.schedule.join(',') === key)?.id ?? 'custom';
}
