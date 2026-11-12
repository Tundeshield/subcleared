import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Member, Organisation, Permission } from '../domain/types';
import type { Plan } from '../domain/plans';
import { api, getOrgId, setOrgId } from './api';
import { auth, type AuthUser } from './auth';
import { setFormatting } from '../domain/locale';

export interface Me {
  user: { uid: string; email: string; emailVerified: boolean; name: string; textScale?: number; theme?: string; views: { id: string; name: string; path: string }[] };
  memberships: { orgId: string; orgName: string; role: string; status: string }[];
  org: Organisation | null;
  member: Member | null;
  permissions: Permission[];
  projectScoped: boolean;
  plans: Plan[];
  billingConfigured: boolean;
  emailConfigured: boolean;
  extractionConfigured: boolean;
  emailFrom?: string;
  intakeConfigured?: boolean;
  mode: 'firebase' | 'memory';
}

interface SessionValue {
  ready: boolean;
  authUser: AuthUser | null;
  me: Me | null;
  error: string | null;
  refresh: () => Promise<Me | null>;
  switchOrg: (id: string) => Promise<void>;
  can: (p: Permission) => boolean;
}

const Ctx = createContext<SessionValue>(null as any);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [meReady, setMeReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!(await auth.token())) { setMe(null); setMeReady(true); return null; }
    try {
      const m = await api<Me>('me');
      if (m.org && m.org.id !== getOrgId()) setOrgId(m.org.id);
      setFormatting(m.org?.settings);
      setMe(m); setError(null);
      applyPrefs({ textScale: m.user.textScale });
      return m;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally { setMeReady(true); }
  }, []);

  useEffect(() => auth.subscribe((u) => {
    setAuthUser(u); setAuthReady(true);
    if (u) { setMeReady(false); refresh(); } else { setMe(null); setMeReady(true); }
  }), [refresh]);

  const switchOrg = useCallback(async (id: string) => { setOrgId(id); await refresh(); }, [refresh]);
  const can = useCallback((p: Permission) => !!me?.permissions.includes(p), [me]);
  return <Ctx.Provider value={{ ready: authReady && meReady, authUser, me, error, refresh, switchOrg, can }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

export function applyPrefs(p: { textScale?: number }) {
  let stored: any = {};
  try { stored = JSON.parse(localStorage.getItem('sc.prefs') || '{}'); } catch { /* ignore */ }
  const next = { ...stored, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) };
  try { localStorage.setItem('sc.prefs', JSON.stringify(next)); } catch { /* ignore */ }
  document.documentElement.style.fontSize = `${16 * (next.textScale || 1)}px`;
  return next;
}
export function readPrefs(): { textScale: number } {
  try { const p = JSON.parse(localStorage.getItem('sc.prefs') || '{}'); return { textScale: p.textScale || 1 }; } catch { return { textScale: 1 }; }
}
