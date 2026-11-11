import type { DeliveryLog } from '../src/domain/types';
import { C, sha256 } from './core';
import type { Db } from './db';
import type { Services } from './services';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function renderEmail(o: { orgName?: string; heading: string; body: string; cta?: { label: string; url: string }; footer?: string }) {
  const paragraphs = o.body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.55">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f6;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#15181c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #e3e5e8;border-radius:6px">
<tr><td style="padding:22px 28px;border-bottom:1px solid #eceef0;font-weight:700;letter-spacing:-.01em">SubCleared${o.orgName ? `<span style="font-weight:400;color:#6b7280"> · ${esc(o.orgName)}</span>` : ''}</td></tr>
<tr><td style="padding:28px">
<h1 style="font-size:20px;margin:0 0 16px;letter-spacing:-.01em">${esc(o.heading)}</h1>${paragraphs}
${o.cta ? `<p style="margin:22px 0 6px"><a href="${esc(o.cta.url)}" style="display:inline-block;background:#0e7c86;color:#fff;text-decoration:none;padding:12px 18px;border-radius:5px;font-weight:600">${esc(o.cta.label)}</a></p><p style="font-size:12px;color:#6b7280;word-break:break-all">${esc(o.cta.url)}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #eceef0;font-size:12px;color:#6b7280">${esc(o.footer ?? 'You received this because your organisation uses SubCleared to manage compliance paperwork.')}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${o.heading}\n\n${o.body}${o.cta ? `\n\n${o.cta.label}: ${o.cta.url}` : ''}\n\n— SubCleared${o.orgName ? ` for ${o.orgName}` : ''}${o.footer ? `\n\n${o.footer}` : ''}`;
  return { html, text };
}

export interface EmailInput {
  to: string;
  template: string;
  subject: string;
  heading: string;
  body: string;
  cta?: { label: string; url: string };
  dedupeKey?: string;
  footer?: string;
  /** Where replies go — the person who sent the request, so subcontractors can ask questions. */
  replyTo?: string;
}

/**
 * Sends one email and writes a delivery log. With a dedupeKey, a message that
 * was already sent is never sent again (scheduler retries are safe); failed
 * deliveries are retried and their attempt count increments.
 */
export async function sendEmail(ctx: { db: Db; svc: Services; org: { id: string; name: string } }, input: EmailInput): Promise<DeliveryLog> {
  const now = ctx.svc.now().toISOString();
  const logId = input.dedupeKey ? sha256(`email:${input.dedupeKey}`).slice(0, 24) : ctx.db.newId();
  const path = C.doc(ctx.org.id, 'deliveryLogs', logId);
  const existing = input.dedupeKey ? await ctx.db.get<DeliveryLog>(path) : null;
  if (existing && ['sent', 'dev_logged', 'queued'].includes(existing.status)) return { ...existing, status: existing.status };
  const log: DeliveryLog = {
    id: logId, channel: 'email', to: input.to, template: input.template, subject: input.subject, status: 'queued',
    attempts: (existing?.attempts ?? 0) + 1, dedupeKey: input.dedupeKey, createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  await ctx.db.set(path, log as any);
  const { html, text } = renderEmail({ orgName: ctx.org.name, heading: input.heading, body: input.body, cta: input.cta, footer: input.footer });
  const res = await ctx.svc.mail.send({ to: input.to, subject: input.subject, html, text, replyTo: input.replyTo });
  const final: DeliveryLog = {
    ...log,
    status: res.ok ? (res.dev ? 'dev_logged' : 'sent') : 'failed',
    providerId: res.id,
    error: res.ok ? undefined : res.error,
    updatedAt: ctx.svc.now().toISOString(),
  };
  await ctx.db.set(path, final as any);
  return final;
}
