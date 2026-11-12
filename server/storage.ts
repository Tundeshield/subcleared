// File storage abstraction. Production: Cloud Storage for Firebase with V4
// signed, time-limited URLs (the bucket itself denies all direct client
// access via storage.rules). Development: local disk with HMAC-signed URLs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_UPLOAD_BYTES } from '../src/domain/fileSafety';

export interface UploadTarget { url: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string }

export interface FileStore {
  uploadUrl(key: string, contentType: string, ttlSeconds?: number): Promise<UploadTarget>;
  readUrl(key: string, opts: { ttlSeconds?: number; fileName: string; inline?: boolean }): Promise<string>;
  read(key: string): Promise<Uint8Array | null>;
  move(from: string, to: string): Promise<void>;
  remove(key: string): Promise<void>;
  write(key: string, data: Uint8Array, contentType: string): Promise<void>;
  setMetadata?(key: string, meta: Record<string, string>): Promise<void>;
}

/**
 * Browsers upload straight to the bucket, so the bucket must allow the app's own
 * origins (and only those) to PUT. Without this every upload fails in the browser
 * before it reaches storage, with no trace on the server.
 */
export function storageCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const out = new Set<string>();
  const add = (u?: string) => { if (!u) return; try { const o = new URL(u).origin; if (o.startsWith('https://')) out.add(o); } catch { /* ignore */ } };
  for (const u of [env.APP_URL, env.URL]) {
    add(u);
    try { const h = new URL(u!).hostname; if (!h.startsWith('www.') && h.split('.').length === 2) add(`https://www.${h}`); } catch { /* ignore */ }
  }
  if (env.SITE_NAME) add(`https://${env.SITE_NAME}.netlify.app`);
  for (const u of (env.STORAGE_CORS_ORIGINS || '').split(',')) add(u.trim());
  return [...out];
}

export interface CorsStatus { ok: boolean; changed?: boolean; origins: string[]; error?: string; fix?: string }

export const UPLOAD_CORS_RULE = { method: ['PUT', 'GET'], responseHeader: ['Content-Type', 'x-goog-content-length-range'], maxAgeSeconds: 3600 };

/** Rules to apply, or null when the existing ones already allow every origin. Keeps rules someone else added. */
export function mergeCors(existing: any[] | undefined, origins: string[]): any[] | null {
  const rules = existing ?? [];
  const allows = (o: string) => rules.some((r) => (r.origin ?? []).some((x: string) => x === o || x === '*') && (r.method ?? []).includes('PUT')
    && UPLOAD_CORS_RULE.responseHeader.every((h) => (r.responseHeader ?? []).some((x: string) => x.toLowerCase() === h.toLowerCase())));
  const missing = origins.filter((o) => !allows(o));
  if (!missing.length) return null;
  return [...rules, { origin: missing, ...UPLOAD_CORS_RULE }];
}

export class GcsFileStore implements FileStore {
  private corsReady: Promise<CorsStatus> | null = null;
  constructor(private bucket: import('@google-cloud/storage').Bucket, private corsOrigins: string[] = []) {}
  /** Makes sure browsers on the app's domains may upload. Checked once per instance; retried after a failure. */
  ensureUploadCors(): Promise<CorsStatus> {
    if (!this.corsOrigins.length) return Promise.resolve({ ok: false, origins: [], error: 'No https app origins configured (APP_URL)' });
    this.corsReady ??= (async (): Promise<CorsStatus> => {
      const [meta] = await this.bucket.getMetadata();
      const next = mergeCors((meta as any).cors, this.corsOrigins);
      if (next) {
        await this.bucket.setCorsConfiguration(next as any);
        console.info(JSON.stringify({ event: 'storage.cors_configured', bucket: this.bucket.name, origins: this.corsOrigins }));
      }
      return { ok: true, changed: !!next, origins: this.corsOrigins };
    })().catch((e: any): CorsStatus => {
      this.corsReady = null;
      const fix = `Run: gcloud storage buckets update gs://${this.bucket.name} --cors-file=firebase/storage-cors.json`;
      console.error(JSON.stringify({ event: 'storage.cors_failed', bucket: this.bucket.name, origins: this.corsOrigins, error: e?.message, fix }));
      return { ok: false, origins: this.corsOrigins, error: String(e?.message ?? e).slice(0, 300), fix };
    });
    return this.corsReady;
  }
  async uploadUrl(key: string, contentType: string, ttlSeconds = 900): Promise<UploadTarget> {
    await this.ensureUploadCors();
    const expires = Date.now() + ttlSeconds * 1000;
    const range = `0,${MAX_UPLOAD_BYTES}`;
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4', action: 'write', expires, contentType, extensionHeaders: { 'x-goog-content-length-range': range },
    });
    return { url, method: 'PUT', headers: { 'Content-Type': contentType, 'x-goog-content-length-range': range }, expiresAt: new Date(expires).toISOString() };
  }
  async readUrl(key: string, { ttlSeconds = 600, fileName, inline = true }: { ttlSeconds?: number; fileName: string; inline?: boolean }) {
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4', action: 'read', expires: Date.now() + ttlSeconds * 1000,
      responseDisposition: `${inline ? 'inline' : 'attachment'}; filename="${fileName.replace(/[^\w.\- ]/g, '_')}"`,
    });
    return url;
  }
  async read(key: string) {
    const f = this.bucket.file(key);
    const [exists] = await f.exists();
    if (!exists) return null;
    const [buf] = await f.download();
    return new Uint8Array(buf);
  }
  async move(from: string, to: string) { await this.bucket.file(from).move(to); }
  async remove(key: string) { await this.bucket.file(key).delete({ ignoreNotFound: true }); }
  async write(key: string, data: Uint8Array, contentType: string) { await this.bucket.file(key).save(Buffer.from(data), { contentType, resumable: false }); }
}

export class LocalFileStore implements FileStore {
  constructor(private root: string, private secret: string, private baseUrl: string) {
    fs.mkdirSync(root, { recursive: true });
  }
  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root))) throw new Error('Invalid key');
    return p;
  }
  sign(key: string, op: 'put' | 'get', exp: number, extra = '') {
    return crypto.createHmac('sha256', this.secret).update(`${op}:${key}:${exp}:${extra}`).digest('hex');
  }
  verify(key: string, op: 'put' | 'get', exp: number, sig: string, extra = '') {
    if (Date.now() > exp) return false;
    const want = this.sign(key, op, exp, extra);
    return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
  }
  async uploadUrl(key: string, contentType: string, ttlSeconds = 900): Promise<UploadTarget> {
    const exp = Date.now() + ttlSeconds * 1000;
    const url = `${this.baseUrl}/api/_files/put?key=${encodeURIComponent(key)}&exp=${exp}&ct=${encodeURIComponent(contentType)}&sig=${this.sign(key, 'put', exp, contentType)}`;
    return { url, method: 'PUT', headers: { 'Content-Type': contentType }, expiresAt: new Date(exp).toISOString() };
  }
  async readUrl(key: string, { ttlSeconds = 600, fileName, inline = true }: { ttlSeconds?: number; fileName: string; inline?: boolean }) {
    const exp = Date.now() + ttlSeconds * 1000;
    const extra = `${fileName}|${inline ? 1 : 0}`;
    return `${this.baseUrl}/api/_files/get?key=${encodeURIComponent(key)}&exp=${exp}&name=${encodeURIComponent(fileName)}&inline=${inline ? 1 : 0}&sig=${this.sign(key, 'get', exp, extra)}`;
  }
  async read(key: string) { const p = this.file(key); return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null; }
  async write(key: string, data: Uint8Array, _contentType?: string) { const p = this.file(key); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }
  async move(from: string, to: string) { const a = this.file(from); const b = this.file(to); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.renameSync(a, b); }
  async remove(key: string) { const p = this.file(key); if (fs.existsSync(p)) fs.unlinkSync(p); }
}
