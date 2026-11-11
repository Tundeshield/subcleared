import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from './auth';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

let currentOrgId: string | null = (() => { try { return localStorage.getItem('sc.org'); } catch { return null; } })();
export function setOrgId(id: string | null) { currentOrgId = id; try { if (id) localStorage.setItem('sc.org', id); else localStorage.removeItem('sc.org'); } catch { /* ignore */ } }
export function getOrgId() { return currentOrgId; }

const listeners = new Set<() => void>();
/** Lets any screen refresh after a mutation elsewhere (e.g. notifications badge). */
export function onDataChanged(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
export function dataChanged() { listeners.forEach((l) => l()); }

export async function api<T = any>(action: string, input: unknown = {}, opts: { portal?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!opts.portal) {
    const t = await auth.token();
    if (t) headers.Authorization = `Bearer ${t}`;
    if (currentOrgId) headers['x-org-id'] = currentOrgId;
  }
  let res: Response;
  try {
    res = await fetch(`/api/${action}`, { method: 'POST', headers, body: JSON.stringify(input ?? {}) });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0, 'network');
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(body?.error || `Request failed (${res.status})`, res.status, body?.code);
  return body as T;
}

export function useApi<T = any>(action: string | null, input: unknown = {}, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!action);
  const seq = useRef(0);
  const key = JSON.stringify(input);
  const load = useCallback(async (quiet = false) => {
    if (!action) return;
    const n = ++seq.current;
    if (!quiet) setLoading(true);
    try {
      const d = await api<T>(action, JSON.parse(key));
      if (n === seq.current) { setData(d); setError(null); }
    } catch (e: any) {
      if (n === seq.current) setError(e instanceof ApiError ? e : new ApiError(e.message, 0));
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, key, ...deps]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onDataChanged(() => load(true)), [load]);
  return { data, error, loading, reload: () => load(true), setData };
}

export function useMutation<I = any, O = any>(action: string, opts: { portal?: boolean } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (input: I): Promise<O> => {
    setBusy(true); setError(null);
    try {
      const out = await api<O>(action, input, opts);
      if (!opts.portal) dataChanged();
      return out;
    } catch (e: any) {
      setError(e.message);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [action, opts.portal]);
  return { run, busy, error, setError };
}
