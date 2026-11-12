// Sample data so a new organisation can see SubCleared working before adding
// its own records. Everything is created through the real handlers (so
// readiness, documents and audit entries are genuine), flagged `sample: true`,
// shown with a "Sample" label in the UI, and removable in one action.
import { addDays, todayIn } from '../src/domain/dates';
import type { DocumentVersion, Market, Organisation, Project, RequirementDefinition, RequirementTemplate, Subcontractor } from '../src/domain/types';
import { audit, C, type Ctx, conflict, need } from './core';
import { recompute } from './data';
import { createUploadSlot, decideReview, finalizeUploadSlot } from './handlers/documents';
import { applyTemplate, assignSubcontractors, createProject } from './handlers/projects';
import { setOverride } from './handlers/requirements';
import { createSub } from './handlers/subs';

interface SampleSet {
  projects: { name: string; code: string; location: string; address: string; status: 'active' | 'planning'; template: string; start: number; end: number }[];
  subs: { legalName: string; trade: string; types: string[]; jurisdiction: string; country: string; contact: [string, string, string]; registration?: string }[];
  // [subIndex, projectIndexes]
  assignments: [number, number[]][];
  // [subIndex, requirement key, outcome, expiry offset days]
  documents: [number, string, 'approved' | 'pending' | 'rejected', number | null][];
  // subcontractors whose non-document checks (e.g. CIS verification) have been confirmed
  confirmed: number[];
}

const UK: SampleSet = {
  projects: [
    { name: 'Kings Cross Office Fit-out', code: 'KCX-114', location: 'London', address: 'York Way, London N1C', status: 'active', template: 'Electrical subcontractor', start: -40, end: 220 },
    { name: 'Ancoats Residential Block B', code: 'ANC-207', location: 'Manchester', address: 'Redhill Street, Manchester M4', status: 'active', template: 'General subcontractor onboarding', start: -90, end: 400 },
    { name: 'Digbeth Logistics Hub', code: 'DGB-031', location: 'Birmingham', address: 'Bordesley Street, Birmingham B5', status: 'planning', template: 'Civil engineering subcontractor', start: 45, end: 520 },
  ],
  subs: [
    { legalName: 'Thameside Electrical Services Ltd', trade: 'Electrical installation', types: ['electrical'], jurisdiction: 'England', country: 'United Kingdom', contact: ['Priya Shah', 'priya.shah@thameside.example', '020 7946 0321'], registration: '08817324' },
    { legalName: 'Pennine Roofing & Cladding Ltd', trade: 'Roofing and cladding', types: ['roofing'], jurisdiction: 'England', country: 'United Kingdom', contact: ['Gareth Holmes', 'gareth@pennineroofing.example', '0161 496 0712'], registration: '10442918' },
    { legalName: 'Midland Groundworks Ltd', trade: 'Groundworks and civils', types: ['civil'], jurisdiction: 'England', country: 'United Kingdom', contact: ['Sean Doyle', 'sean.doyle@midlandgw.example', '0121 496 0388'], registration: '11290455' },
    { legalName: 'Northern Mechanical Services Ltd', trade: 'HVAC and mechanical', types: ['mechanical'], jurisdiction: 'England', country: 'United Kingdom', contact: ['Hannah Clarke', 'h.clarke@northernmech.example', '0113 496 0154'], registration: '09774310' },
    { legalName: 'Carver Plumbing & Heating Ltd', trade: 'Plumbing and heating', types: ['plumbing'], jurisdiction: 'England', country: 'United Kingdom', contact: ['Tom Carver', 'tom@carverph.example', '0161 496 0950'], registration: '12006671' },
  ],
  assignments: [[0, [0, 1]], [1, [1]], [2, [1, 2]], [3, [0]], [4, [1]]],
  documents: [
    [0, 'gl', 'approved', 240], [0, 'wc', 'approved', 180], [0, 'biz', 'approved', null], [0, 'elec', 'approved', 300], [0, 'safety', 'approved', 150], [0, 'rams', 'approved', null], [0, 'agreement', 'approved', null],
    [1, 'gl', 'approved', 18], [1, 'wc', 'approved', 200], [1, 'biz', 'pending', null],
    [2, 'gl', 'approved', -6], [2, 'wc', 'rejected', 120],
    [3, 'gl', 'approved', 300], [3, 'wc', 'pending', 280],
    [4, 'gl', 'approved', 90], [4, 'wc', 'approved', 25], [4, 'biz', 'approved', null], [4, 'safety', 'approved', 200], [4, 'agreement', 'approved', null],
  ],
  confirmed: [0, 4],
};

const US: SampleSet = {
  projects: [
    { name: 'East Austin Medical Office', code: 'ATX-2214', location: 'Austin, TX', address: 'E 7th St, Austin, TX 78702', status: 'active', template: 'Electrical subcontractor', start: -30, end: 260 },
    { name: 'Deep Ellum Mixed-Use', code: 'DAL-1187', location: 'Dallas, TX', address: 'Elm St, Dallas, TX 75226', status: 'active', template: 'General subcontractor onboarding', start: -75, end: 380 },
    { name: 'Fulton Market Tenant Improvement', code: 'CHI-0452', location: 'Chicago, IL', address: 'W Fulton Market, Chicago, IL 60607', status: 'planning', template: 'Mechanical subcontractor', start: 30, end: 210 },
  ],
  subs: [
    { legalName: 'Lone Star Electric LLC', trade: 'Electrical', types: ['electrical'], jurisdiction: 'Texas', country: 'United States', contact: ['Maria Delgado', 'mdelgado@lonestarelectric.example', '(512) 555-0147'] },
    { legalName: 'Trinity Roofing Co.', trade: 'Roofing', types: ['roofing'], jurisdiction: 'Texas', country: 'United States', contact: ['Jake Turner', 'jake@trinityroofing.example', '(214) 555-0183'] },
    { legalName: 'Lakeshore Mechanical Inc.', trade: 'HVAC and mechanical', types: ['mechanical'], jurisdiction: 'Illinois', country: 'United States', contact: ['Dana Kowalski', 'dkowalski@lakeshoremech.example', '(312) 555-0126'] },
    { legalName: 'Bluebonnet Plumbing LLC', trade: 'Plumbing', types: ['plumbing'], jurisdiction: 'Texas', country: 'United States', contact: ['Luis Ortega', 'luis@bluebonnetplumbing.example', '(512) 555-0199'] },
    { legalName: 'Prairie Civil Contractors Inc.', trade: 'Site work and concrete', types: ['civil'], jurisdiction: 'Illinois', country: 'United States', contact: ['Ruth Anders', 'randers@prairiecivil.example', '(312) 555-0164'] },
  ],
  assignments: [[0, [0, 1]], [1, [1]], [2, [0, 2]], [3, [1]], [4, [2]]],
  documents: [
    [0, 'gl', 'approved', 260], [0, 'wc', 'approved', 190], [0, 'biz', 'approved', null], [0, 'elec', 'approved', 330], [0, 'safety', 'approved', 140], [0, 'rams', 'approved', null], [0, 'tax', 'approved', null], [0, 'agreement', 'approved', null],
    [1, 'gl', 'approved', 21], [1, 'wc', 'approved', 160], [1, 'biz', 'pending', null],
    [2, 'gl', 'approved', 300], [2, 'wc', 'pending', 280], [2, 'auto', 'approved', -4],
    [3, 'gl', 'approved', 85], [3, 'wc', 'rejected', 120], [3, 'biz', 'approved', null],
    [4, 'gl', 'approved', 12],
  ],
  confirmed: [0],
};

function samplePdf(title: string, org: string, sub: string) {
  const esc = (t: string) => t.replace(/[()\\]/g, '');
  const lines = [`SAMPLE DOCUMENT - NOT A REAL CERTIFICATE`, esc(title), `Holder: ${esc(sub)}`, `Requested by: ${esc(org)}`, 'Generated by SubCleared to demonstrate the review workflow.'];
  const text = `BT /F1 16 Tf 72 720 Td (${lines[0]}) Tj /F1 12 Tf ${lines.slice(1).map((l) => `0 -24 Td (${l}) Tj`).join(' ')} ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export async function loadSample(ctx: Ctx) {
  need(ctx, 'settings.manage');
  if (ctx.org.hasSample) throw conflict('Sample data is already loaded');
  const market: Market = ctx.org.settings.market === 'US' ? 'US' : 'UK';
  const set = market === 'US' ? US : UK;
  const today = todayIn(ctx.org.settings.timezone, ctx.svc.now());
  const [reqs, templates] = await Promise.all([
    ctx.db.list<RequirementDefinition>(C.col(ctx.org.id, 'requirements')),
    ctx.db.list<RequirementTemplate>(C.col(ctx.org.id, 'templates')),
  ]);
  const quietCtx: Ctx = { ...ctx, source: 'import' };
  const projectIds: string[] = [];
  for (const p of set.projects) {
    const { projectId } = await createProject(quietCtx, { name: p.name, code: p.code, location: p.location, address: p.address, status: p.status, startDate: addDays(today, p.start), endDate: addDays(today, p.end), managerUid: ctx.member.uid });
    await ctx.db.update(C.doc(ctx.org.id, 'projects', projectId), { sample: true });
    const t = templates.find((x) => x.name === p.template && x.active);
    if (t) await applyTemplate(quietCtx, { projectId, templateId: t.id });
    projectIds.push(projectId);
  }
  const subIds: string[] = [];
  for (const s of set.subs) {
    const { subcontractorId } = await createSub(quietCtx, {
      legalName: s.legalName, trade: s.trade, subTypes: s.types, jurisdiction: s.jurisdiction, country: s.country, registrationNumber: s.registration,
      tags: ['Sample'], contacts: [{ name: s.contact[0], email: s.contact[1], phone: s.contact[2], roles: ['owner', 'submission'], primary: true }],
    });
    await ctx.db.update(C.doc(ctx.org.id, 'subcontractors', subcontractorId), { sample: true });
    subIds.push(subcontractorId);
  }
  for (const [si, pis] of set.assignments) for (const pi of pis) await assignSubcontractors(quietCtx, { projectId: projectIds[pi], subcontractorIds: [subIds[si]], sendRequests: false });

  // Requirement keys → this organisation's requirement ids (by starter name).
  const { starterRequirements } = await import('../src/domain/library');
  const starters = starterRequirements(ctx.org.settings.market ?? 'OTHER');
  const reqId = (key: string) => reqs.find((r) => r.name === starters.find((x) => x.key === key)?.name)?.id;
  // Where a requirement the sample set treats as a manual check is a document in this organisation's library
  // (the neutral library asks for tax registration as a document), confirmed subcontractors get an approved copy.
  const documents = [...set.documents];
  for (const si of set.confirmed) for (const key of ['tax']) {
    const def = reqs.find((r) => r.id === reqId(key));
    if (def?.kind === 'document' && !documents.some(([d, k]) => d === si && k === key)) documents.push([si, key, 'approved', null] as (typeof documents)[number]);
  }
  for (const [si, key, outcome, expiry] of documents) {
    const rid = reqId(key);
    const def = reqs.find((r) => r.id === rid);
    if (!rid || !def || def.kind !== 'document') continue;
    const s = set.subs[si];
    const bytes = samplePdf(def.name, ctx.org.name, s.legalName);
    const actor = { type: 'portal' as const, id: 'sample', name: `${s.contact[0]} (${s.legalName})` };
    const slot = await createUploadSlot(ctx, actor, { subcontractorId: subIds[si], requirementId: rid, fileName: `${def.name.replace(/[^\w ]/g, '').replace(/\s+/g, '-').toLowerCase()}.pdf`, mimeType: 'application/pdf', size: bytes.length });
    const v = await ctx.db.get<DocumentVersion>(C.doc(ctx.org.id, 'versions', slot.versionId));
    await ctx.svc.files.write(v!.storagePath!, bytes, 'application/pdf');
    await finalizeUploadSlot(ctx, actor, slot.versionId, 'portal');
    if (outcome === 'pending') continue;
    const values: Record<string, any> = {};
    for (const c of def.criteria) values[c.key] = c.type === 'min_amount' ? Number(c.value) * (market === 'US' ? 2 : 1) : true;
    const metadata = {
      issuer: market === 'US' ? 'Hartwell Mutual Insurance Co. (sample)' : 'Albion Commercial Insurance plc (sample)', referenceNumber: `SMP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      issueDate: addDays(today, -200), expiryDate: expiry === null ? undefined : addDays(today, expiry), namedInsured: s.legalName, values,
    };
    await decideReview(ctx, outcome === 'approved'
      ? { versionId: slot.versionId, decision: 'approve', metadata }
      : { versionId: slot.versionId, decision: 'reject', reason: 'The named insured on the certificate does not match the subcontractor’s legal name.', metadata });
  }
  for (const si of set.confirmed) {
    for (const def of reqs.filter((r) => r.kind !== 'document' && r.active)) {
      await setOverride(ctx, { type: 'manual_confirmation', subcontractorId: subIds[si], requirementId: def.id, reason: market === 'UK' ? 'Checked with HMRC / site records (sample)' : 'Confirmed against training records (sample)' });
    }
  }
  await ctx.db.update(C.org(ctx.org.id), { hasSample: true });
  await audit(ctx, { action: 'organisation.sample_loaded', entity: { type: 'organisation', id: ctx.org.id, label: ctx.org.name }, after: { market, projects: projectIds.length, subcontractors: subIds.length } });
  await recompute(ctx, {}, 'sample.loaded');
  return { projects: projectIds.length, subcontractors: subIds.length };
}

export async function clearSample(ctx: Ctx) {
  need(ctx, 'settings.manage');
  const [projects, subs] = await Promise.all([ctx.db.list<Project>(C.col(ctx.org.id, 'projects')), ctx.db.list<Subcontractor>(C.col(ctx.org.id, 'subcontractors'))]);
  const pids = new Set(projects.filter((p) => p.sample).map((p) => p.id));
  const sids = new Set(subs.filter((s) => s.sample).map((s) => s.id));
  const byField = async (col: string, field: string, set: Set<string>) => {
    for (const d of await ctx.db.list<any>(C.col(ctx.org.id, col))) if (set.has(d[field])) await ctx.db.delete(C.doc(ctx.org.id, col, d.id));
  };
  const versions = (await ctx.db.list<DocumentVersion>(C.col(ctx.org.id, 'versions'))).filter((v) => sids.has(v.subcontractorId));
  for (const v of versions) if (v.storagePath) await ctx.svc.files.remove(v.storagePath).catch(() => undefined);
  for (const [col, field] of [['versions', 'subcontractorId'], ['documents', 'subcontractorId'], ['reviews', 'subcontractorId'], ['requests', 'subcontractorId'], ['links', 'subcontractorId'], ['overrides', 'subcontractorId'], ['readiness', 'subcontractorId'], ['evaluations', 'subcontractorId'], ['notes', 'subcontractorId']] as const) await byField(col, field, sids);
  for (const [col, field] of [['assignments', 'projectId'], ['projectRequirements', 'projectId'], ['readiness', 'projectId'], ['evaluations', 'projectId']] as const) await byField(col, field, pids);
  for (const id of pids) await ctx.db.delete(C.doc(ctx.org.id, 'projects', id));
  for (const id of sids) await ctx.db.delete(C.doc(ctx.org.id, 'subcontractors', id));
  const ids = [...pids, ...sids];
  for (const n of await ctx.db.list<any>(C.col(ctx.org.id, 'notifications'))) if (ids.some((id) => n.link?.includes(id))) await ctx.db.delete(C.doc(ctx.org.id, 'notifications', n.id));
  await ctx.db.update(C.org(ctx.org.id), { hasSample: false });
  await audit(ctx, { action: 'organisation.sample_removed', entity: { type: 'organisation', id: ctx.org.id, label: ctx.org.name }, after: { projects: pids.size, subcontractors: sids.size } });
  return { removed: { projects: pids.size, subcontractors: sids.size } };
}

export type { Organisation };
