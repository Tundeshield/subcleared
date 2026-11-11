import crypto from 'node:crypto';
import { DEFAULT_PLANS, type Plan } from '../src/domain/plans';
import { FirestoreDb, type Db } from './db';
import { GcsFileStore, type FileStore } from './storage';

export interface Identity { uid: string; email: string; emailVerified: boolean; name?: string }

export interface AuthVerifier {
  verify(token: string): Promise<Identity>;
  /** Server-side email verification / reset links (Firebase) — optional. */
  revokeSessions?(uid: string): Promise<void>;
}

export interface MailMessage { to: string; subject: string; text: string; html: string }
export interface Mailer {
  configured: boolean;
  send(msg: MailMessage): Promise<{ ok: boolean; id?: string; error?: string; dev?: boolean }>;
}

export interface Env {
  appUrl: string;
  portalSecret: string;
  anthropicKey?: string;
  anthropicModel: string;
  stripeSecret?: string;
  stripeWebhookSecret?: string;
  scanUrl?: string;
  scanToken?: string;
  cronSecret?: string;
  plans: Plan[];
  priceId(plan: string, interval: 'month' | 'year'): string | undefined;
}

export interface Services {
  mode: 'firebase' | 'memory';
  db: Db;
  files: FileStore;
  auth: AuthVerifier;
  mail: Mailer;
  env: Env;
  now(): Date;
  /** Kicks off background extraction for a stored version. */
  queueExtraction(orgId: string, versionId: string): Promise<void>;
}

export function readEnv(e: NodeJS.ProcessEnv = process.env): Env {
  let plans = DEFAULT_PLANS;
  if (e.PLANS_JSON) {
    try { plans = JSON.parse(e.PLANS_JSON); } catch { console.error('PLANS_JSON is not valid JSON; using defaults'); }
  }
  const portalSecret = e.PORTAL_SESSION_SECRET || '';
  if (!portalSecret || portalSecret.length < 32) {
    if (e.NODE_ENV === 'production' || e.CONTEXT === 'production') throw new Error('PORTAL_SESSION_SECRET must be set (32+ chars)');
  }
  return {
    appUrl: (e.APP_URL || e.URL || 'http://localhost:5173').replace(/\/$/, ''),
    portalSecret: portalSecret || 'dev-only-portal-secret-change-me-0000000000',
    anthropicKey: e.ANTHROPIC_API_KEY,
    anthropicModel: e.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    stripeSecret: e.STRIPE_SECRET_KEY,
    stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET,
    scanUrl: e.MALWARE_SCAN_URL,
    scanToken: e.MALWARE_SCAN_TOKEN,
    cronSecret: e.CRON_SECRET,
    plans,
    priceId: (plan, interval) => e[`STRIPE_PRICE_${plan.toUpperCase()}_${interval === 'month' ? 'MONTHLY' : 'ANNUAL'}`],
  };
}

export class ResendMailer implements Mailer {
  configured: boolean;
  constructor(private apiKey?: string, private from = 'SubCleared <notifications@subcleared.app>') { this.configured = !!apiKey; }
  async send(msg: MailMessage) {
    if (!this.apiKey) return { ok: false, error: 'Email provider not configured (RESEND_API_KEY missing)' };
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: body?.message || `Resend responded ${res.status}` };
      return { ok: true, id: body?.id };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Network error' };
    }
  }
}

let firebaseServices: Services | null = null;

/** Production services backed by Firebase Admin. Cached per function instance. */
export async function getFirebaseServices(): Promise<Services> {
  if (firebaseServices) return firebaseServices;
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  const { getStorage } = await import('firebase-admin/storage');
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
  const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  const app = getApps()[0] ?? initializeApp({ credential: cert(sa), storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${sa.project_id}.appspot.com` });
  const firestore = getFirestore(app);
  try { firestore.settings({ ignoreUndefinedProperties: true }); } catch { /* already set */ }
  const auth = getAuth(app);
  const env = readEnv();
  firebaseServices = {
    mode: 'firebase',
    db: new FirestoreDb(firestore),
    files: new GcsFileStore(getStorage(app).bucket() as any),
    auth: {
      async verify(token) {
        const d = await auth.verifyIdToken(token, true);
        return { uid: d.uid, email: (d.email || '').toLowerCase(), emailVerified: !!d.email_verified, name: d.name };
      },
      async revokeSessions(uid) { await auth.revokeRefreshTokens(uid); },
    },
    mail: new ResendMailer(process.env.RESEND_API_KEY, process.env.EMAIL_FROM),
    env,
    now: () => new Date(),
    async queueExtraction(orgId, versionId) {
      // Netlify background function: returns 202 immediately, runs up to 15 min.
      const res = await fetch(`${env.appUrl}/.netlify/functions/extract-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-signature': internalSignature(env.portalSecret, `${orgId}:${versionId}`) },
        body: JSON.stringify({ orgId, versionId }),
      });
      if (!res.ok && res.status !== 202) throw new Error(`Could not queue extraction (${res.status})`);
    },
  };
  return firebaseServices;
}

export function internalSignature(secret: string, payload: string) {
  return crypto.createHmac('sha256', secret).update(`internal:${payload}`).digest('hex');
}
