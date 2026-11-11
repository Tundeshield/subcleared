// Authentication client. Production uses Firebase Authentication (email +
// password, email verification, password reset). Local development and the
// automated test suite use a dev auth backend (VITE_AUTH_MODE=dev), which is
// never available in a production build.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  applyActionCode, confirmPasswordReset, createUserWithEmailAndPassword, getAuth, onIdTokenChanged, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signOut as fbSignOut, updateProfile, type Auth,
} from 'firebase/auth';

export interface AuthUser { uid: string; email: string; emailVerified: boolean; name: string }

export interface AuthClient {
  mode: 'firebase' | 'dev' | 'unconfigured';
  subscribe(cb: (u: AuthUser | null) => void): () => void;
  token(force?: boolean): Promise<string | null>;
  signUp(email: string, password: string, name: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  resendVerification(): Promise<void>;
  reload(): Promise<AuthUser | null>;
  requestReset(email: string): Promise<void>;
  applyVerification(code: string): Promise<void>;
  confirmReset(code: string, password: string): Promise<void>;
}

const env = import.meta.env;
const actionUrl = () => `${window.location.origin}/auth/action`;

function friendly(e: any): Error {
  const code: string = e?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Email or password is incorrect.', 'auth/wrong-password': 'Email or password is incorrect.', 'auth/user-not-found': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'An account with this email already exists. Try signing in.', 'auth/weak-password': 'Use at least 8 characters for your password.',
    'auth/invalid-email': 'Enter a valid email address.', 'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/expired-action-code': 'This link has expired. Request a new one.', 'auth/invalid-action-code': 'This link is invalid or has already been used.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
  };
  return new Error(map[code] ?? e?.message ?? 'Something went wrong.');
}

function firebaseClient(): AuthClient {
  const app: FirebaseApp = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID,
  });
  const auth: Auth = getAuth(app);
  const map = (u: any): AuthUser | null => (u ? { uid: u.uid, email: (u.email ?? '').toLowerCase(), emailVerified: u.emailVerified, name: u.displayName ?? '' } : null);
  return {
    mode: 'firebase',
    subscribe: (cb) => onIdTokenChanged(auth, (u) => cb(map(u))),
    token: async (force) => (auth.currentUser ? auth.currentUser.getIdToken(force) : null),
    async signUp(email, password, name) {
      if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
      try {
        const c = await createUserWithEmailAndPassword(auth, email, password);
        if (name) await updateProfile(c.user, { displayName: name });
        await sendEmailVerification(c.user, { url: `${window.location.origin}/onboarding` });
      } catch (e) { throw friendly(e); }
    },
    async signIn(email, password) { try { await signInWithEmailAndPassword(auth, email, password); } catch (e) { throw friendly(e); } },
    signOut: () => fbSignOut(auth),
    async resendVerification() { if (auth.currentUser) await sendEmailVerification(auth.currentUser, { url: `${window.location.origin}/onboarding` }).catch((e) => { throw friendly(e); }); },
    async reload() { if (!auth.currentUser) return null; await auth.currentUser.reload(); await auth.currentUser.getIdToken(true); return map(auth.currentUser); },
    async requestReset(email) { try { await sendPasswordResetEmail(auth, email, { url: `${window.location.origin}/login` }); } catch (e: any) { if (e?.code !== 'auth/user-not-found') throw friendly(e); } },
    async applyVerification(code) { try { await applyActionCode(auth, code); await auth.currentUser?.reload(); await auth.currentUser?.getIdToken(true); } catch (e) { throw friendly(e); } },
    async confirmReset(code, password) { try { await confirmPasswordReset(auth, code, password); } catch (e) { throw friendly(e); } },
  };
}

function devClient(): AuthClient {
  const KEY = 'sc.devAuth';
  let state: { token: string; user: AuthUser } | null = null;
  try { state = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* ignore */ }
  const subs = new Set<(u: AuthUser | null) => void>();
  const emit = () => subs.forEach((cb) => cb(state?.user ?? null));
  const save = (s: typeof state) => { state = s; if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); emit(); };
  const post = async (a: string, body: any) => {
    const r = await fetch(`/api/_dev/auth/${a}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  };
  return {
    mode: 'dev',
    subscribe(cb) { subs.add(cb); setTimeout(() => cb(state?.user ?? null), 0); return () => subs.delete(cb); },
    async token(force) {
      if (!state) return null;
      const exp = JSON.parse(atob(state.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp;
      if (force || exp - Date.now() < 60_000) { try { save(await post('refresh', { token: state.token })); } catch { save(null); return null; } }
      return state?.token ?? null;
    },
    async signUp(email, password, name) { save(await post('signup', { email, password, name })); },
    async signIn(email, password) { save(await post('login', { email, password })); },
    async signOut() { save(null); },
    async resendVerification() { if (state) await post('sendVerify', { token: state.token }); },
    async reload() { if (!state) return null; save(await post('refresh', { token: state.token })); return state!.user; },
    async requestReset(email) { await post('reset', { email }); },
    async applyVerification(code) { await post('verify', { code }); if (state) save(await post('refresh', { token: state.token })); },
    async confirmReset(code, password) { await post('confirmReset', { code, password }); },
  };
}

function unconfigured(): AuthClient {
  const fail = async () => { throw new Error('Sign-in is not configured for this deployment yet.'); };
  return { mode: 'unconfigured', subscribe: (cb) => { setTimeout(() => cb(null), 0); return () => {}; }, token: async () => null, signUp: fail, signIn: fail, signOut: async () => {}, resendVerification: fail, reload: async () => null, requestReset: fail, applyVerification: fail, confirmReset: fail };
}

export const auth: AuthClient = env.VITE_AUTH_MODE === 'dev' ? devClient() : env.VITE_FIREBASE_API_KEY ? firebaseClient() : unconfigured();
export { actionUrl };
