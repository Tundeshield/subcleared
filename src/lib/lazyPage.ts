import { lazy, type ComponentType } from 'react';

/**
 * Each page is a separate file whose name changes with every release. A tab
 * opened before a release still knows the old names; those files are gone, so
 * opening a page in that tab used to fail and leave a blank screen. When that
 * happens we load the new release once, at the page the person was going to.
 */
const KEY = 'sc.reloadedForUpdate';

export function isStaleChunkError(e: unknown) {
  const m = String((e as any)?.message ?? e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script|ChunkLoadError|Loading chunk/i.test(m);
}

export function reloadForUpdate(): boolean {
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY) || 0); } catch { /* storage unavailable */ }
  if (Date.now() - last < 30_000) return false; // already tried: let the error screen explain instead of looping
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
  window.location.reload();
  return true;
}

export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const m = await load();
      // A file that loaded but isn't the page (e.g. HTML served in its place) counts as an old release too.
      if (!m || typeof (m as any).default !== 'function' && typeof (m as any).default !== 'object') throw new Error('Failed to fetch dynamically imported module (empty)');
      return m;
    } catch (e) {
      if (isStaleChunkError(e) && reloadForUpdate()) return new Promise<never>(() => {}); // keep the loading state until the reload
      throw e;
    }
  });
}
