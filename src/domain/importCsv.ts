import Papa from 'papaparse';
import { SUB_TYPES } from './library';

export interface ImportRow {
  legalName: string;
  tradingName?: string;
  registrationNumber?: string;
  trade: string;
  subTypes: string[];
  address?: string;
  country?: string;
  jurisdiction?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  tags: string[];
}

export interface ImportResult {
  rows: ImportRow[];
  errors: { line: number; message: string }[];
}

const HEADER_ALIASES: Record<string, keyof ImportRow> = {
  'legal name': 'legalName', legalname: 'legalName', company: 'legalName', 'company name': 'legalName', name: 'legalName',
  'trading name': 'tradingName', tradingname: 'tradingName', dba: 'tradingName',
  'registration number': 'registrationNumber', registration: 'registrationNumber', 'company number': 'registrationNumber',
  trade: 'trade', service: 'trade', 'primary trade': 'trade',
  type: 'subTypes', types: 'subTypes', 'subcontractor type': 'subTypes',
  address: 'address', country: 'country', jurisdiction: 'jurisdiction', state: 'jurisdiction',
  'contact name': 'contactName', contact: 'contactName', 'contact email': 'contactEmail', email: 'contactEmail',
  'contact phone': 'contactPhone', phone: 'contactPhone', tags: 'tags',
};

export const CSV_TEMPLATE = 'Legal name,Trading name,Registration number,Trade,Type,Address,Country,Jurisdiction,Contact name,Contact email,Contact phone,Tags\n';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseSubcontractorCsv(text: string): ImportResult {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const errors: ImportResult['errors'] = parsed.errors.map((e) => ({ line: (e.row ?? 0) + 2, message: e.message }));
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  parsed.data.forEach((raw, i) => {
    const line = i + 2;
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = HEADER_ALIASES[k];
      if (key) r[key] = (v ?? '').trim();
    }
    if (!r.legalName) { errors.push({ line, message: 'Legal name is required' }); return; }
    if (!r.trade) { errors.push({ line, message: `Trade is required for "${r.legalName}"` }); return; }
    if (r.contactEmail && !EMAIL_RE.test(r.contactEmail)) { errors.push({ line, message: `Invalid email "${r.contactEmail}"` }); return; }
    const dupKey = r.legalName.toLowerCase();
    if (seen.has(dupKey)) { errors.push({ line, message: `Duplicate company "${r.legalName}" in file` }); return; }
    seen.add(dupKey);
    const types = (r.subTypes || '').split(/[;|,]/).map((t) => t.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean);
    const unknown = types.filter((t) => !SUB_TYPES.includes(t));
    rows.push({
      legalName: r.legalName.slice(0, 200), tradingName: r.tradingName || undefined, registrationNumber: r.registrationNumber || undefined,
      trade: r.trade.slice(0, 100), subTypes: types.length ? types.filter((t) => SUB_TYPES.includes(t)) : guessSubTypes(r.trade),
      address: r.address || undefined, country: r.country || undefined, jurisdiction: r.jurisdiction || undefined,
      contactName: r.contactName || undefined, contactEmail: r.contactEmail?.toLowerCase() || undefined, contactPhone: r.contactPhone || undefined,
      tags: (r.tags || '').split(/[;|]/).map((t) => t.trim()).filter(Boolean),
    });
    if (unknown.length) errors.push({ line, message: `Ignored unknown type(s): ${unknown.join(', ')} (row still imported)` });
  });
  return { rows, errors };
}

export function guessSubTypes(trade: string): string[] {
  const t = trade.toLowerCase();
  const out: string[] = [];
  if (/electric/.test(t)) out.push('electrical');
  if (/plumb|gas|heating/.test(t)) out.push('plumbing');
  if (/roof/.test(t)) out.push('roofing');
  if (/mechanic|hvac|ventilat/.test(t)) out.push('mechanical');
  if (/civil|ground|excavat|concrete/.test(t)) out.push('civil');
  if (/design|engineer|architect/.test(t)) out.push('design');
  if (/demolition|asbestos|scaffold|crane/.test(t)) out.push('high_risk');
  return out.length ? out : ['general'];
}
