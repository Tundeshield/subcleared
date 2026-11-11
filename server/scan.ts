import { inspectFile, type SafetyResult } from '../src/domain/fileSafety';
import type { Services } from './services';

/**
 * Two layers: (1) structural validation of the stored bytes — real type
 * sniffing, size, truncation and PDF active-content blocking — always runs;
 * (2) an external antivirus engine runs when MALWARE_SCAN_URL is configured
 * (for example a ClamAV REST service). The method is recorded on the version
 * so reviewers can see exactly which checks a file passed.
 */
export async function scanFile(svc: Services, bytes: Uint8Array, fileName: string, declaredMime?: string): Promise<SafetyResult & { method: string; detail?: string }> {
  const structural = inspectFile(bytes, fileName, declaredMime);
  if (!structural.ok) return { ...structural, method: 'structural' };
  if (!svc.env.scanUrl) return { ...structural, method: 'structural', detail: 'Structural checks passed; no antivirus engine configured' };
  try {
    const res = await fetch(svc.env.scanUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...(svc.env.scanToken ? { Authorization: `Bearer ${svc.env.scanToken}` } : {}) },
      body: Buffer.from(bytes),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: 'Antivirus scan could not be completed; please try again', method: 'structural+av', detail: `Scanner HTTP ${res.status}` };
    const clean = body.clean === true || body.infected === false || body.status === 'OK';
    return clean
      ? { ...structural, method: 'structural+av', detail: 'Structural checks and antivirus scan passed' }
      : { ok: false, reason: 'The file was flagged by the antivirus scan', method: 'structural+av', detail: JSON.stringify(body).slice(0, 300) };
  } catch (e: any) {
    // Fail closed: an unreachable scanner never lets a file through.
    return { ok: false, reason: 'Antivirus scan could not be completed; please try again', method: 'structural+av', detail: e?.message };
  }
}
