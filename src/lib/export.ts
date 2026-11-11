import Papa from 'papaparse';

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
  // Guard against CSV formula injection in spreadsheet apps.
  const safe = (v: any) => { const s = v === undefined || v === null ? '' : Array.isArray(v) ? v.join('; ') : String(v); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
  const csv = Papa.unparse({ fields: columns.map((c) => c.label), data: rows.map((r) => columns.map((c) => safe(r[c.key]))) });
  download(`${slug(title)}-${new Date().toISOString().slice(0, 10)}.csv`, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
}

export async function exportPdf(o: { title: string; organisation: string; generatedBy?: string; generatedAt?: string; filters?: string[]; columns: Column[]; rows: Record<string, any>[]; note?: string }) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: o.columns.length > 5 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(o.title, 40, 48);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100);
  const meta = [`${o.organisation}`, `Generated ${new Date(o.generatedAt ?? Date.now()).toLocaleString('en-GB')}${o.generatedBy ? ` by ${o.generatedBy}` : ''}`, o.filters?.length ? `Filters: ${o.filters.join(' · ')}` : 'Filters: none'];
  meta.forEach((m, i) => doc.text(m, 40, 66 + i * 12));
  autoTable(doc, {
    startY: 66 + meta.length * 12 + 8,
    head: [o.columns.map((c) => c.label)],
    body: o.rows.map((r) => o.columns.map((c) => { const v = r[c.key]; return v === undefined || v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v); })),
    styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
    headStyles: { fillColor: [20, 23, 27], textColor: 255 },
    alternateRowStyles: { fillColor: [246, 247, 248] },
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      doc.setFontSize(8); doc.setTextColor(140);
      doc.text(`SubCleared · ${o.note ?? 'Compliance status reflects documents reviewed against stated requirements; it is not an insurance or legal determination.'}`, 40, doc.internal.pageSize.getHeight() - 20, { maxWidth: w - 120 });
      doc.text(`Page ${doc.getNumberOfPages()}`, w - 70, doc.internal.pageSize.getHeight() - 20);
    },
  });
  doc.save(`${slug(o.title)}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
