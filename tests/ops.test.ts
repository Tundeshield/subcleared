import { describe, expect, it } from 'vitest';
import { MemoryDb } from '../server/db';
import { checkJobHealth, jobHealth, reportError, scrub } from '../server/ops';

const svcAt = (iso: string, sent: any[]) => {
  const clock = { now: new Date(iso) };
  return { clock, svc: { db: new MemoryDb(), now: () => clock.now, mail: { configured: true, async send(m: any) { sent.push(m); return { ok: true }; } } } as any };
};

describe('operator monitoring', () => {
  it('alerts once when the scheduler stops, again only when it gets worse or recovers', async () => {
    process.env.OPS_ALERT_EMAIL = 'ops@subcleared.example';
    const sent: any[] = [];
    const { clock, svc } = svcAt('2026-11-12T10:00:00Z', sent);
    await svc.db.set('jobRuns/latest', { finishedAt: '2026-11-12T09:30:00Z', ok: true });
    expect((await checkJobHealth(svc)).alerted).toBe(false);
    clock.now = new Date('2026-11-12T12:00:00Z'); // 2.5 h without a run
    expect((await checkJobHealth(svc)).severity).toBe('down');
    clock.now = new Date('2026-11-12T12:30:00Z');
    await checkJobHealth(svc); await checkJobHealth(svc);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/have not run for 3 hours/);
    clock.now = new Date('2026-11-13T10:00:00Z');
    await checkJobHealth(svc);
    expect(sent.at(-1).subject).toMatch(/^Critical/);
    await svc.db.set('jobRuns/latest', { finishedAt: '2026-11-13T10:05:00Z', ok: true });
    clock.now = new Date('2026-11-13T10:10:00Z');
    await checkJobHealth(svc);
    expect(sent.at(-1).subject).toMatch(/^Resolved/);
    expect(sent).toHaveLength(3);
    delete process.env.OPS_ALERT_EMAIL;
  });
  it('reports a missing run as down, and the public check carries no data', () => {
    expect(jobHealth(null, new Date()).severity).toBe('critical');
    expect(Object.keys(jobHealth({ finishedAt: new Date().toISOString(), ok: true }, new Date()))).toEqual(['severity', 'ageMinutes', 'lastFinishedAt', 'lastOk']);
  });
  it('keeps a durable error record with context, and never stores credentials', async () => {
    const { svc } = svcAt('2026-11-12T10:00:00Z', []);
    const err = Object.assign(new Error('Upstream refused Bearer eyJhbGciOi.eyJzdWIiOiJ4.c2lnbmF0dXJl with key re_live_ABCDEFGH12345678 at https://x.example/u?token=abc123&x=1'), { code: 'E_UPSTREAM' });
    const id = await reportError(svc, { fn: 'extract-background', orgId: 'org1', error: err, retry: 'will_retry' });
    const rec: any = await svc.db.get(`opsErrors/${id}`);
    expect(rec).toMatchObject({ fn: 'extract-background', orgId: 'org1', code: 'E_UPSTREAM', retry: 'will_retry' });
    expect(rec.message).not.toMatch(/eyJ|re_live_ABCD|abc123/);
    expect(scrub('docs-0123456789abcdefghij0123456789abcdefghij')).toContain('[redacted]');
  });
});
