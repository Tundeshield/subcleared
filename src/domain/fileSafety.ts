// Server-side content checks for uploaded files. These checks run on the
// stored bytes (never on the client-declared type). An optional external AV
// scanner can be plugged in on the server; see server/scan.ts.

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];

export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png';
  return null;
}

export function extensionMatches(fileName: string, mime: AllowedMime): boolean {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return (mime === 'application/pdf' && ext === 'pdf') || (mime === 'image/jpeg' && ['jpg', 'jpeg'].includes(ext)) || (mime === 'image/png' && ext === 'png');
}

// PDF features that can execute code or smuggle files. Certificates of
// insurance and licences never legitimately need these.
const PDF_DANGEROUS = [/\/JavaScript\b/, /\/JS\b/, /\/Launch\b/, /\/EmbeddedFile\b/, /\/RichMedia\b/, /\/XFA\b/, /\/SubmitForm\b/, /\/ImportData\b/];

export interface SafetyResult {
  ok: boolean;
  mime?: AllowedMime;
  reason?: string;
}

export function inspectFile(bytes: Uint8Array, fileName: string, declaredMime?: string): SafetyResult {
  if (bytes.length === 0) return { ok: false, reason: 'File is empty' };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, reason: `File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit` };
  const mime = sniffMime(bytes);
  if (!mime) return { ok: false, reason: 'Only PDF, JPEG and PNG files are accepted' };
  if (!extensionMatches(fileName, mime)) return { ok: false, reason: 'File extension does not match its contents' };
  if (declaredMime && declaredMime !== mime && !(declaredMime === 'image/jpg' && mime === 'image/jpeg')) {
    return { ok: false, reason: 'Declared file type does not match its contents' };
  }
  if (mime === 'application/pdf') {
    // Scan as latin1 so binary streams don't throw.
    const text = latin1(bytes);
    const hit = PDF_DANGEROUS.find((re) => re.test(text));
    if (hit) return { ok: false, reason: `PDF contains active content (${hit.source.replace(/\\\//g, '/').replace(/\\b/g, '')}) and was blocked` };
    if (!/%%EOF\s*$/.test(text.slice(-1024))) return { ok: false, reason: 'PDF appears truncated or malformed' };
  }
  if (mime === 'image/png' && !latin1(bytes.slice(-12)).includes('IEND')) return { ok: false, reason: 'PNG appears truncated' };
  if (mime === 'image/jpeg' && !(bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9)) return { ok: false, reason: 'JPEG appears truncated' };
  return { ok: true, mime };
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return s;
}
