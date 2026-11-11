import Papa from 'papaparse';
import { getLocale } from '../domain/locale';

export interface Column { key: string; label: string }

function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function exportCsv(title: string, columns: Column[], rows: Record<string, any>[]) {
  // Guard against formula injection when the file is opened in a spreadsheet.
  const safe = (v: any) => { const s = v === undefined || v === null ? '' : Array.isArray(v) ? v.join('; ') : String(v); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
  const csv = Papa.unparse({ fields: columns.map((c) => c.label), data: rows.map((r) => columns.map((c) => safe(r[c.key]))) });
  download(`${slug(title)}-${new Date().toISOString().slice(0, 10)}.csv`, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
}

// Brand colours for print.
const CHARCOAL: [number, number, number] = [37, 43, 39];
const FIELD: [number, number, number] = [82, 116, 95];
const IVORY: [number, number, number] = [246, 245, 240];
const MUTED: [number, number, number] = [108, 112, 107];

/** A business report: branded header, context, summary figures and a clean table. */
export async function exportPdf(o: {
  title: string; subtitle?: string; organisation: string; generatedBy?: string; generatedAt?: string; filters?: string[];
  context?: [string, string][]; summary?: [string, number | string][]; columns: Column[]; rows: Record<string, any>[]; note?: string;
}) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const landscape = o.columns.length > 5;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;

  // Mark: the raised barrier.
  const mark = (x: number, y: number, s: number) => {
    doc.setFillColor(...CHARCOAL); doc.rect(x + 6 * s, y + 9 * s, 4 * s, 16 * s, 'F'); doc.rect(x + 4 * s, y + 24 * s, 13 * s, 3 * s, 'F');
    doc.setFillColor(...FIELD);
    const a = (-34 * Math.PI) / 180; const cx = x + 8 * s; const cy = y + 11.2 * s;
    const pts = [[8, 9.2], [28, 9.2], [28, 13.2], [8, 13.2]].map(([px, py]) => { const dx = x + px * s - cx; const dy = y + py * s - cy; return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]; });
    (doc as any).lines(pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]), pts[0][0], pts[0][1], [1, 1], 'F', true);
  };

  doc.setFillColor(...IVORY); doc.rect(0, 0, W, 112, 'F');
  mark(M - 4, 26, 0.85);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...CHARCOAL); doc.text('SubCleared', M + 26, 46);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED); doc.text('SUBCONTRACTOR COMPLIANCE & READINESS', M + 26, 56, { charSpace: 0.6 });
  const when = new Date(o.generatedAt ?? Date.now()).toLocaleString(getLocale(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  doc.setFontSize(8.5); doc.text([o.organisation, `Generated ${when}`, o.generatedBy ? `by ${o.generatedBy}` : ''].filter(Boolean), W - M, 40, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(...CHARCOAL); doc.text(o.title, M, 92);
  let y = 112;
  if (o.subtitle) { doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...CHARCOAL); doc.text(o.subtitle, M, y + 24); y += 28; }
  y += 14;
  if (o.context?.length) {
    const colW = (W - 2 * M) / Math.min(o.context.length, 4);
    o.context.forEach(([k, v], i) => {
      const x = M + (i % 4) * colW; const yy = y + Math.floor(i / 4) * 34;
      doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text(k.toUpperCase(), x, yy, { charSpace: 0.4 });
      doc.setFontSize(10); doc.setTextColor(...CHARCOAL); doc.text(String(v), x, yy + 14, { maxWidth: colW - 12 });
    });
    y += Math.ceil(o.context.length / 4) * 34 + 6;
  }
  if (o.summary?.length) {
    doc.setDrawColor(...CHARCOAL); doc.setLineWidth(0.8); doc.line(M, y, W - M, y);
    const colW = (W - 2 * M) / o.summary.length;
    o.summary.forEach(([k, v], i) => {
      const x = M + i * colW;
      doc.setFontSize(20); doc.setTextColor(...(k.toLowerCase() === 'ready' ? FIELD : CHARCOAL)); doc.text(String(v), x, y + 30);
      doc.setFontSize(8.5); doc.setTextColor(...MUTED); doc.text(k, x, y + 44);
    });
    y += 62;
  }
  if (o.filters?.length) { doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(`Filters: ${o.filters.join(' · ')}`, M, y + 4, { maxWidth: W - 2 * M }); y += 16; }

  autoTable(doc, {
    startY: y + 6,
    head: [o.columns.map((c) => c.label)],
    body: o.rows.map((r) => o.columns.map((c) => { const v = r[c.key]; return v === undefined || v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v); })),
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 6, bottom: 6, left: 6, right: 6 }, textColor: CHARCOAL, lineColor: [221, 221, 214], lineWidth: { bottom: 0.5, top: 0, left: 0, right: 0 }, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [255, 255, 255], textColor: MUTED, fontStyle: 'normal', fontSize: 7.5, lineWidth: { bottom: 1, top: 0, left: 0, right: 0 }, lineColor: CHARCOAL },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    margin: { left: M, right: M, bottom: 54, top: 48 },
    didDrawPage: () => {
      doc.setFontSize(7.5); doc.setTextColor(...MUTED);
      doc.text(o.note ?? 'Readiness reflects documents reviewed against your stated requirements. It is not an insurance, licensing or legal determination.', M, H - 28, { maxWidth: W - 2 * M - 80 });
      doc.text(`Page ${(doc as any).internal.getCurrentPageInfo().pageNumber} of {total}`, W - M, H - 28, { align: 'right' });
    },
  });
  if (typeof (doc as any).putTotalPages === 'function') (doc as any).putTotalPages('{total}');
  if (!o.rows.length) { doc.setFontSize(10); doc.setTextColor(...MUTED); doc.text('No records match this report.', M, y + 40); }
  doc.save(`${slug(o.subtitle ? `${o.title} ${o.subtitle}` : o.title)}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
