import { describe, expect, it } from 'vitest';
import { inspectFile } from '../src/domain/fileSafety';
import { parseSubcontractorCsv } from '../src/domain/importCsv';
import { can, canAssignRole, canSeeProject, isProjectScoped } from '../src/domain/permissions';
import type { Member } from '../src/domain/types';

const enc = (s: string) => new TextEncoder().encode(s);
const m = (role: Member['role'], extra: Partial<Member> = {}): Member => ({ uid: 'u1', email: 'a@b.c', name: 'A', role, status: 'active', joinedAt: '', ...extra });

describe('permissions', () => {
  it('maps roles to capabilities', () => {
    expect(can(m('reviewer'), 'documents.review')).toBe(true);
    expect(can(m('reviewer'), 'subs.manage')).toBe(false);
    expect(can(m('read_only'), 'documents.upload')).toBe(false);
    expect(can(m('admin'), 'billing.manage')).toBe(false);
    expect(can(m('owner'), 'billing.manage')).toBe(true);
    expect(can(m('owner', { status: 'deactivated' }), 'reports.view')).toBe(false);
  });
  it('supports custom grants and revocations', () => {
    expect(can(m('reviewer', { extraPermissions: ['requests.send'] }), 'requests.send')).toBe(true);
    expect(can(m('compliance_manager', { revokedPermissions: ['documents.review'] }), 'documents.review')).toBe(false);
  });
  it('scopes project managers to assigned projects', () => {
    const pm = m('project_manager');
    expect(isProjectScoped(pm)).toBe(true);
    expect(canSeeProject(pm, { managerUid: 'u1', adminUids: [] })).toBe(true);
    expect(canSeeProject(pm, { managerUid: 'x', adminUids: [] })).toBe(false);
    expect(canSeeProject(m('compliance_manager'), { managerUid: 'x', adminUids: [] })).toBe(true);
  });
  it('only owners can grant ownership', () => {
    expect(canAssignRole(m('admin'), 'owner')).toBe(false);
    expect(canAssignRole(m('owner'), 'owner')).toBe(true);
    expect(canAssignRole(m('reviewer'), 'read_only')).toBe(false);
  });
});

describe('file safety', () => {
  const pdf = enc('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer\n%%EOF\n');
  it('accepts a clean PDF and sniffs type from bytes', () => {
    expect(inspectFile(pdf, 'coi.pdf', 'application/pdf')).toEqual({ ok: true, mime: 'application/pdf' });
  });
  it('rejects disguised and active-content files', () => {
    expect(inspectFile(enc('MZ\x90\x00 executable'), 'coi.pdf').ok).toBe(false);
    expect(inspectFile(pdf, 'coi.png').reason).toMatch(/extension/);
    expect(inspectFile(enc('%PDF-1.7\n<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>\n%%EOF'), 'x.pdf').reason).toMatch(/active content/);
    expect(inspectFile(enc('%PDF-1.7\n<< /EmbeddedFile >>\n%%EOF'), 'x.pdf').ok).toBe(false);
    expect(inspectFile(enc('%PDF-1.7 truncated'), 'x.pdf').reason).toMatch(/truncated/);
    expect(inspectFile(new Uint8Array(), 'x.pdf').ok).toBe(false);
  });
  it('validates image signatures', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    expect(inspectFile(jpg, 'photo.jpeg', 'image/jpeg').ok).toBe(true);
    expect(inspectFile(jpg, 'photo.jpeg', 'application/pdf').ok).toBe(false);
  });
});

describe('CSV import', () => {
  it('parses rows, normalises types and reports errors per line', () => {
    const csv = [
      'Legal name,Trade,Type,Contact email,Tags',
      'Brightline Electrical Ltd,Electrical,electrical,ops@brightline.example,priority;north',
      ',Plumbing,,x@y.z,',
      'Stonebridge Civils,Groundworks,,not-an-email,',
      'Brightline Electrical Ltd,Electrical,,,',
      'Harbour Roofing,Roofing,,,',
    ].join('\n');
    const r = parseSubcontractorCsv(csv);
    expect(r.rows.map((x) => x.legalName)).toEqual(['Brightline Electrical Ltd', 'Harbour Roofing']);
    expect(r.rows[0].tags).toEqual(['priority', 'north']);
    expect(r.rows[1].subTypes).toEqual(['roofing']);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });
});
