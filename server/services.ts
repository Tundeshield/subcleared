import crypto from 'node:crypto';
import { DEFAULT_PLANS, type Plan } from '../src/domain/plans';
import { FirestoreDb, type Db } from './db';
import { AnthropicProvider, type AiProvider } from './ai';
import { ResendInbound, type InboundSource } from './intake';
import { GcsFileStore, storageCorsOrigins, type FileStore } from './storage';

export interface Identity {
  uid: string; email: string; emailVerified: boolean; name?: string;
  /** Settles once the server has confirmed the sign-in wasn't revoked or the account disabled; rejects otherwise. */
  confirmed?: Promise<void>;
}

export interface AuthVerifier {
  verify(token: string): Promise<Identity>;
  /** Server-side email verification / reset links (Firebase) — optional. */
  revokeSessions?(uid: string): Promise<void>;
}

export interface MailMessage { to: string; subject: string; text: string; html: string; replyTo?: string | string[] }
export interface Mailer {
  configured: boolean;
  /** The From address in use, for display and diagnostics. */
  from?: string;
  send(msg: MailMessage): Promise<{ ok: boolean; id?: string; error?: string; dev?: boolean }>;
}

export interface Env {
  appUrl: string;
  portalSecret: string;
  anthropicKey?: string;
  /** The more capable model, used for second looks and the assistant. */
  anthropicModel: string;
  /** The inexpensive model that reads every document first. */
  aiFastModel: string;
  /** Optional per-million-token prices, e.g. {"model":{"in":1,"out":5}}. Without them only tokens are reported. */
  aiPrices?: Record<string, { in: number; out: number }>;
  aiMaxPages: number;
  aiMaxBytes: number;
  /** Signing secret of the Resend `email.received` webhook (whsec_…). */
  resendWebhookSecret?: string;
  inboundDomain?: string;
  stripeSecret?: string;
  stripeWebhookSecret?: string;
  scanUrl?: string;
  scanToken?: string;
  cronSecret?: string;
  plans: Plan[];
  priceId(plan: string, interval: 'month' | 'year', currency?: 'USD' | 'GBP'): string | undefined;
}

export interface Services {
  mode: 'firebase' | 'memory';
  db: Db;
  files: FileStore;
  auth: AuthVerifier;
  mail: Mailer;
  /** Document reader / assistant model. Undefined when no AI provider is configured. */
  ai?: AiProvider;
  /** Received-email API (Resend). Undefined when RESEND_API_KEY is missing. */
  inbound?: InboundSource;
  env: Env;
  now(): Date;
  /** Kicks off background extraction for a stored version. */
  queueExtraction(orgId: string, versionId: string): Promise<void>;
  /** Kicks off background reading and matching of an emailed attachment. */
  queueIntake(orgId: string, intakeId: string): Promise<void>;
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
    aiFastModel: e.ANTHROPIC_MODEL_FAST || 'claude-haiku-5-5',
    aiPrices: (() => { try { return e.AI_PRICES_JSON ? JSON.parse(e.AI_PRICES_JSON) : undefined; } catch { console.error('AI_PRICES_JSON is not valid JSON'); return undefined; } })(),
    aiMaxPages: Number(e.AI_MAX_PAGES || 12),
    aiMaxBytes: Number(e.AI_MAX_BYTES || 10 * 1024 * 1024),
    resendWebhookSecret: e.RESEND_WEBHOOK_SECRET,
    inboundDomain: e.INBOUND_EMAIL_DOMAIN,
    stripeSecret: e.STRIPE_SECRET_KEY,
    stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET,
    scanUrl: e.MALWARE_SCAN_URL,
    scanToken: e.MALWARE_SCAN_TOKEN,
    cronSecret: e.CRON_SECRET,
    plans,
    priceId: (plan, interval, currency) => {
      const k = `STRIPE_PRICE_${plan.toUpperCase()}_${interval === 'month' ? 'MONTHLY' : 'ANNUAL'}`;
      return (currency ? e[`${k}_${currency}`] : undefined) ?? e[k];
    },
  };
}

export class ResendMailer implements Mailer {
  configured: boolean;
  constructor(private apiKey?: string, public from = 'SubCleared <notifications@subcleared.app>') { this.configured = !!apiKey; }
  async send(msg: MailMessage) {
    if (!this.apiKey) return { ok: false, error: 'Email provider not configured (RESEND_API_KEY missing)' };
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}) }),
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
    files: new GcsFileStore(getStorage(app).bucket() as any, storageCorsOrigins()),
    auth: {
      async verify(token) {
        // Signature, expiry and audience are checked locally (no network). The revocation and
        // disabled-account check needs a call to Firebase, so it runs alongside the other access
        // checks; the request is refused before any handler runs if it fails.
        const d = await auth.verifyIdToken(token, false);
        const confirmed = auth.getUser(d.uid).then((u) => {
          if (u.disabled) throw new Error('Account disabled');
          const validSince = u.tokensValidAfterTime ? Math.floor(Date.parse(u.tokensValidAfterTime) / 1000) : 0;
          if (d.auth_time < validSince) throw new Error('Session revoked');
        });
        confirmed.catch(() => undefined); // handled by the caller; avoid an unhandled rejection
        return { uid: d.uid, email: (d.email || '').toLowerCase(), emailVerified: !!d.email_verified, name: d.name, confirmed };
      },
      async revokeSessions(uid) { await auth.revokeRefreshTokens(uid); },
    },
    mail: new ResendMailer(process.env.RESEND_API_KEY, process.env.EMAIL_FROM),
    ai: env.anthropicKey ? new AnthropicProvider(env.anthropicKey) : undefined,
    inbound: process.env.RESEND_API_KEY ? new ResendInbound(process.env.RESEND_API_KEY) : undefined,
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
    async queueIntake(orgId, intakeId) {
      const res = await fetch(`${env.appUrl}/.netlify/functions/intake-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-signature': internalSignature(env.portalSecret, `intake:${orgId}:${intakeId}`) },
        body: JSON.stringify({ orgId, intakeId }),
      });
      if (!res.ok && res.status !== 202) throw new Error(`Could not queue intake (${res.status})`);
    },
  };
  return firebaseServices;
}

/**
 * Token for internal endpoints (scheduler trigger, accuracy runs). Uses the
 * dedicated variable when set, otherwise a value derived from the portal
 * secret, so the endpoints work without extra configuration but stay closed
 * to anyone who can't read the deployment's settings.
 */
export function internalToken(purpose: 'jobs' | 'eval', env: NodeJS.ProcessEnv = process.env): string {
  const own = purpose === 'jobs' ? env.CRON_SECRET : env.EVAL_SECRET;
  if (own) return own;
  const base = env.PORTAL_SESSION_SECRET || '';
  return base.length >= 32 ? crypto.createHmac('sha256', base).update(`internal-endpoint:${purpose}`).digest('hex') : '';
}

export function internalSignature(secret: string, payload: string) {
  return crypto.createHmac('sha256', secret).update(`internal:${payload}`).digest('hex');
}
