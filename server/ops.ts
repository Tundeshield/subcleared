// Operator-only reliability tooling: durable error records and background-job health alerts.
// Nothing here is shown to customers. Never record passwords, tokens or document contents.
import crypto from 'node:crypto';
import type { Services } from './services';

/** Strips anything that looks like a credential before it is logged or stored. */
export function scrub(s: string) {
  return s
    .replace(/Bearer\s+[\w.~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .replace(/\b(sk|rk|pk|re|whsec)_[\w-]{8,}/g, '[key]')
    .replace(/([?&](token|key|sig|signature|code|session)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]');
}

export interface ErrorReport { fn: string; op?: string; orgId?: string; error: unknown; retry?: 'will_retry' | 'retried' | 'final' | 'none' }

/**
 * Records a production failure where it outlives Netlify's short log retention: a structured log
 * line, a stored record (opsErrors, newest first via /internal/errors), and, when configured, a
 * POST to ERROR_WEBHOOK_URL (any log service or chat webhook).
 */
export async function reportError(svc: Pick<Services, 'db' | 'now'>, r: ErrorReport) {
  const e: any = r.error;
  const at = svc.now().toISOString();
  const rec = {
    id: `${at.replace(/[^0-9]/g, '').slice(0, 14)}-${crypto.randomBytes(4).toString('hex')}`, at, fn: r.fn, op: r.op ?? null, orgId: r.orgId ?? null,
    message: scrub(String(e?.message ?? e)).slice(0, 500), code: e?.code ? String(e.code).slice(0, 60) : null,
    stack: e?.stack ? scrub(String(e.stack)).split('\n').slice(0, 8).join('\n').slice(0, 1500) : null, retry: r.retry ?? 'none',
  };
  console.error(JSON.stringify({ event: 'error', ...rec }));
  await svc.db.set(`opsErrors/${rec.id}`, rec).catch(() => undefined);
  const hook = process.env.ERROR_WEBHOOK_URL;
  if (hook) await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `SubCleared ${rec.fn}${rec.op ? ` ${rec.op}` : ''}: ${rec.message}`, ...rec }) }).catch(() => undefined);
  return rec.id;
}

const STALE_MS = 2 * 3600_000;
const CRITICAL_MS = 24 * 3600_000;

export function jobHealth(last: { finishedAt?: string; ok?: boolean } | null, now: Date) {
  const finished = last?.finishedAt ? Date.parse(last.finishedAt) : NaN;
  const age = Number.isFinite(finished) ? now.getTime() - finished : Infinity;
  const severity: 'ok' | 'down' | 'critical' = age > CRITICAL_MS ? 'critical' : age > STALE_MS ? 'down' : 'ok';
  return { severity, ageMinutes: Number.isFinite(age) ? Math.round(age / 60_000) : null, lastFinishedAt: last?.finishedAt ?? null, lastOk: last?.ok ?? null };
}

/**
 * Checks the hourly scheduler from outside it. Alerts the operator once when it stops, again only if it
 * gets worse (more than a day) or when it recovers. Runs from its own schedule, and the same state is
 * served at /internal/health for an external uptime monitor, so a dead scheduler can't hide its own failure.
 */
export async function checkJobHealth(svc: Services) {
  const now = svc.now();
  const h = jobHealth(await svc.db.get<any>('jobRuns/latest'), now);
  const prev = await svc.db.get<any>('opsAlerts/jobs');
  const was = prev?.severity ?? 'ok';
  if (h.severity === was) return { ...h, alerted: false };
  const subject = h.severity === 'ok' ? 'Resolved: SubCleared scheduled jobs are running again' : `${h.severity === 'critical' ? 'Critical' : 'Alert'}: SubCleared scheduled jobs have not run for ${h.ageMinutes === null ? 'an unknown time' : `${Math.round(h.ageMinutes / 60)} hours`}`;
  const text = [subject, '', `Job: renewals-scheduled → jobs-background (reminders, chasing, recovery, digests)`, `Last finished: ${h.lastFinishedAt ?? 'never'}`, `Last run ok: ${h.lastOk ?? 'unknown'}`, `Checked: ${now.toISOString()}`, '', 'Check the function logs in Netlify, then POST /internal/jobs/run to run it now.'].join('\n');
  const to = process.env.OPS_ALERT_EMAIL;
  let delivered = false;
  if (to && svc.mail.configured) {
    const r = await svc.mail.send({ to, subject, text, html: `<pre style="font:13px ui-monospace,monospace">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</pre>` }).catch((e: any) => ({ ok: false, error: e.message }));
    delivered = !!r.ok;
  }
  console.error(JSON.stringify({ event: 'ops.job_health', from: was, to: h.severity, ...h, emailed: delivered }));
  await svc.db.set('opsAlerts/jobs', { ...h, since: now.toISOString(), previous: was, emailed: delivered });
  return { ...h, alerted: true, emailed: delivered };
}
