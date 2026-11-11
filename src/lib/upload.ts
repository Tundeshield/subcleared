import { MAX_UPLOAD_BYTES } from '../domain/fileSafety';
import { api, dataChanged } from './api';

export const ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';

export function precheck(file: File): string | null {
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`;
  const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '');
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(type)) return 'Only PDF, JPEG and PNG files can be uploaded.';
  return null;
}

export function mimeOf(file: File) {
  return file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg');
}

function put(url: string, headers: Record<string, string>, file: File, onProgress: (p: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}). Please try again.`)));
    xhr.onerror = () => reject(new Error('Upload interrupted. Check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

/**
 * Three steps: reserve a slot, PUT bytes to a short-lived signed URL, then ask
 * the server to verify and record the submission. Success is only reported
 * after the server confirms the file was scanned and stored.
 */
export async function uploadDocument(
  kind: { portal: string } | { internal: Record<string, unknown> },
  file: File, requirementId: string | undefined, onProgress: (stage: 'preparing' | 'uploading' | 'verifying', p: number) => void, signal?: AbortSignal,
) {
  const err = precheck(file);
  if (err) throw new Error(err);
  onProgress('preparing', 0);
  const meta = { fileName: file.name, mimeType: mimeOf(file), size: file.size, requirementId };
  const slot = 'portal' in kind
    ? await api('portal.uploadCreate', { session: kind.portal, ...meta }, { portal: true })
    : await api('uploads.create', { ...kind.internal, ...meta });
  await put(slot.upload.url, slot.upload.headers, file, (p) => onProgress('uploading', p), signal);
  onProgress('verifying', 1);
  const out = 'portal' in kind
    ? await api('portal.uploadFinalize', { session: kind.portal, versionId: slot.versionId }, { portal: true })
    : await api('uploads.finalize', { versionId: slot.versionId });
  if (!('portal' in kind)) dataChanged();
  return out as { versionId: string; documentId: string; status: string };
}
