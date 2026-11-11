// Local development & end-to-end test server. NEVER deployed: Netlify only
// ships netlify/functions/*, which use Firebase. This server swaps in an
// in-memory database (persisted to .data/), local file storage, a dev
// password auth and a dev mailbox so every workflow can run offline.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { handleApi } from './api';
import { MemoryDb } from './db';
import { MockAiProvider } from './ai';
import { MemoryInbound, processIntake, simulateResendDelivery } from './intake';
import { runDailyJobs, runExtraction } from './jobs';
import { readEnv, type Services } from './services';
import { LocalFileStore } from './storage';

const PORT = Number(process.env.DEV_API_PORT || 8787);
const DATA = path.resolve(process.env.DEV_DATA_DIR || '.data');
const STATIC = process.env.DEV_STATIC ? path.resolve(process.env.DEV_STATIC) : null;
const APP_URL = process.env.APP_URL || 'http://localhost:5173';
fs.mkdirSync(DATA, { recursive: true });
if (process.env.DEV_RESET === '1') { fs.rmSync(DATA, { recursive: true, force: true }); fs.mkdirSync(DATA, { recursive: true }); }

const secret = 'dev-secret-' + (fs.existsSync(path.join(DATA, 'secret')) ? fs.readFileSync(path.join(DATA, 'secret'), 'utf8') : (() => { const s = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(path.join(DATA, 'secret'), s); return s; })());
const db = new MemoryDb(path.join(DATA, 'db.json'));
const files = new LocalFileStore(path.join(DATA, 'files'), secret, APP_URL);
let clockOffsetMs = Number(process.env.DEV_CLOCK_OFFSET_DAYS || 0) * 86_400_000;

function signToken(p: object) { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return `dev.${b}.${crypto.createHmac('sha256', secret).update(b).digest('base64url')}`; }
function readToken(t: string) {
  const [, b, s] = t.split('.');
  if (!b || crypto.createHmac('sha256', secret).update(b).digest('base64url') !== s) throw new Error('bad token');
  const p = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (p.exp < Date.now()) throw new Error('expired');
  return p;
}
function hashPw(pw: string, salt: string) { return crypto.scryptSync(pw, salt, 32).toString('hex'); }

const devInbound = new MemoryInbound();
const svc: Services = {
  mode: 'memory', db, files,
  auth: {
    async verify(token) {
      const p = readToken(token);
      const u = await db.get<any>(`_devUsers/${p.uid}`);
      if (!u) throw new Error('no user');
      return { uid: u.uid, email: u.email, emailVerified: !!u.verified, name: u.name };
    },
  },
  mail: {
    configured: true,
    async send(msg) {
      const id = db.newId();
      await db.set(`_devMail/${id}`, { id, ...msg, at: new Date().toISOString() });
      console.log(`[dev-mail] → ${msg.to}: ${msg.subject}`);
      if (process.env.DEV_MAIL_FAIL && msg.to.includes(process.env.DEV_MAIL_FAIL)) return { ok: false, error: 'Simulated delivery failure (DEV_MAIL_FAIL)' };
      return { ok: true, id, dev: true };
    },
  },
  ai: process.env.DEV_AI === 'mock' ? new MockAiProvider() : undefined,
  inbound: devInbound,
  env: { ...readEnv({ ...process.env, APP_URL, RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET || 'whsec_ZGV2LXJlc2VuZC13ZWJob29rLXNlY3JldA==', INBOUND_EMAIL_DOMAIN: process.env.INBOUND_EMAIL_DOMAIN || 'in.subcleared.test' }), appUrl: APP_URL },
  now: () => new Date(Date.now() + clockOffsetMs),
  async queueExtraction(orgId, versionId) { setTimeout(() => runExtraction(svc, orgId, versionId).catch(console.error), 10); },
  async queueIntake(orgId, intakeId) { setTimeout(() => processIntake(svc, orgId, intakeId).catch(console.error), 10); },
};

async function body(req: http.IncomingMessage, limit = 3_000_000): Promise<Buffer> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new Error('too large'); chunks.push(c as Buffer); }
  return Buffer.concat(chunks);
}
function json(res: http.ServerResponse, status: number, data: unknown) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }

async function devAuth(action: string, input: any) {
  const email = String(input.email || '').trim().toLowerCase();
  const issue = (u: any) => ({ token: signToken({ uid: u.uid, exp: Date.now() + 3600_000 }), user: { uid: u.uid, email: u.email, emailVerified: !!u.verified, name: u.name } });
  const byEmail = async () => (await db.list<any>('_devUsers', [['email', '==', email]]))[0];
  if (action === 'signup') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return [400, { error: 'Enter a valid email address' }];
    if (String(input.password || '').length < 8) return [400, { error: 'Password must be at least 8 characters' }];
    if (await byEmail()) return [409, { error: 'An account with this email already exists' }];
    const salt = crypto.randomBytes(8).toString('hex');
    const u = { uid: db.newId(), email, name: String(input.name || ''), salt, hash: hashPw(input.password, salt), verified: false };
    await db.set(`_devUsers/${u.uid}`, u);
    await sendVerify(u);
    return [200, issue(u)];
  }
  if (action === 'login') {
    const u = await byEmail();
    if (!u || hashPw(String(input.password || ''), u.salt) !== u.hash) return [401, { error: 'Email or password is incorrect' }];
    return [200, issue(u)];
  }
  if (action === 'refresh') { try { const p = readToken(String(input.token)); const u = await db.get<any>(`_devUsers/${p.uid}`); return u ? [200, issue(u)] : [401, { error: 'no user' }]; } catch { return [401, { error: 'expired' }]; } }
  if (action === 'sendVerify') { try { const p = readToken(String(input.token)); const u = await db.get<any>(`_devUsers/${p.uid}`); if (u) await sendVerify(u); return [200, { ok: true }]; } catch { return [401, { error: 'expired' }]; } }
  if (action === 'verify') {
    const rec = await db.get<any>(`_devCodes/${String(input.code)}`);
    if (!rec || rec.type !== 'verify') return [400, { error: 'This verification link is invalid or has already been used.' }];
    await db.update(`_devUsers/${rec.uid}`, { verified: true }); await db.delete(`_devCodes/${input.code}`);
    return [200, { ok: true }];
  }
  if (action === 'reset') {
    const u = await byEmail();
    if (u) { const code = crypto.randomBytes(16).toString('hex'); await db.set(`_devCodes/${code}`, { type: 'reset', uid: u.uid }); await svc.mail.send({ to: u.email, subject: 'Reset your SubCleared password', text: `${APP_URL}/auth/action?mode=resetPassword&oobCode=${code}`, html: `<a href="${APP_URL}/auth/action?mode=resetPassword&oobCode=${code}">Reset password</a>` }); }
    return [200, { ok: true }];
  }
  if (action === 'confirmReset') {
    const rec = await db.get<any>(`_devCodes/${String(input.code)}`);
    if (!rec || rec.type !== 'reset') return [400, { error: 'This reset link is invalid or has expired.' }];
    if (String(input.password || '').length < 8) return [400, { error: 'Password must be at least 8 characters' }];
    const u = await db.get<any>(`_devUsers/${rec.uid}`);
    await db.update(`_devUsers/${rec.uid}`, { hash: hashPw(input.password, u.salt) }); await db.delete(`_devCodes/${input.code}`);
    return [200, { ok: true }];
  }
  return [404, { error: 'unknown' }];
}
async function sendVerify(u: any) {
  const code = crypto.randomBytes(16).toString('hex');
  await db.set(`_devCodes/${code}`, { type: 'verify', uid: u.uid });
  const url = `${APP_URL}/auth/action?mode=verifyEmail&oobCode=${code}`;
  await svc.mail.send({ to: u.email, subject: 'Verify your email for SubCleared', text: url, html: `<a href="${url}">Verify email</a>` });
}

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/_files/put' && req.method === 'PUT') {
      const key = url.searchParams.get('key')!; const exp = Number(url.searchParams.get('exp')); const ct = url.searchParams.get('ct')!;
      if (!files.verify(key, 'put', exp, url.searchParams.get('sig') || '', ct)) return json(res, 403, { error: 'Signature invalid or expired' });
      if (req.headers['content-type'] !== ct) return json(res, 403, { error: 'Content-Type mismatch' });
      const b = await body(req, 15 * 1024 * 1024 + 1).catch(() => null);
      if (!b) return json(res, 413, { error: 'File too large' });
      files.write(key, b); res.writeHead(200); return res.end();
    }
    if (url.pathname === '/api/_files/get') {
      const key = url.searchParams.get('key')!; const exp = Number(url.searchParams.get('exp')); const name = url.searchParams.get('name') || 'file'; const inline = url.searchParams.get('inline') || '1';
      if (!files.verify(key, 'get', exp, url.searchParams.get('sig') || '', `${name}|${inline}`)) { res.writeHead(403); return res.end('Link expired'); }
      const data = await files.read(key);
      if (!data) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(key); const type = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg';
      res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `${inline === '1' ? 'inline' : 'attachment'}; filename="${name}"`, 'Cache-Control': 'private, no-store' });
      return res.end(Buffer.from(data));
    }
    if (url.pathname.startsWith('/api/_dev/auth/')) {
      const [status, out] = await devAuth(url.pathname.split('/').pop()!, JSON.parse((await body(req)).toString() || '{}'));
      return json(res, status as number, out);
    }
    if (url.pathname === '/api/_dev/mail') {
      const mail = (await db.list<any>('_devMail')).sort((a, b) => b.at.localeCompare(a.at));
      return json(res, 200, { items: mail.slice(0, 200) });
    }
    if (url.pathname === '/api/_dev/inbound' && req.method === 'POST') {
      // Simulates Resend receiving an email: {from, fromName, to, subject, text, attachments:[{filename, contentType, content (base64)}]}
      const m = JSON.parse((await body(req, 40_000_000)).toString());
      const out = await simulateResendDelivery(svc, devInbound, { ...m, to: Array.isArray(m.to) ? m.to : [m.to], attachments: (m.attachments ?? []).map((a: any) => ({ filename: a.filename, contentType: a.contentType, bytes: new Uint8Array(Buffer.from(a.content, 'base64')) })) });
      return json(res, out.status, out.body);
    }
    if (url.pathname === '/api/_dev/jobs') { const out = await runDailyJobs(svc, { force: url.searchParams.get('force') !== '0' }); return json(res, 200, out); }
    if (url.pathname === '/api/_dev/clock') {
      const input = JSON.parse((await body(req)).toString() || '{}');
      if (input.offsetDays !== undefined) clockOffsetMs = Number(input.offsetDays) * 86_400_000;
      return json(res, 200, { now: svc.now().toISOString() });
    }
    if (url.pathname.startsWith('/api/') && req.method === 'POST') {
      const action = url.pathname.slice(5);
      const raw = await body(req);
      const out = await handleApi(svc, { action, input: raw.length ? JSON.parse(raw.toString()) : {}, authorization: req.headers.authorization, orgId: req.headers['x-org-id'] as string, ip: req.socket.remoteAddress });
      return json(res, out.status, out.body);
    }
    if (STATIC) {
      let p = path.join(STATIC, decodeURIComponent(url.pathname));
      if (!p.startsWith(STATIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(STATIC, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      return res.end(fs.readFileSync(p));
    }
    json(res, 404, { error: 'Not found' });
  } catch (e: any) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});
server.listen(PORT, () => console.log(`SubCleared dev API on http://localhost:${PORT} (data: ${DATA})`));
