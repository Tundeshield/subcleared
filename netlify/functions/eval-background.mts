import crypto from 'node:crypto';
import { runEval, toMarkdown } from '../../server/eval';
import { getFirebaseServices, internalToken } from '../../server/services';

// Measures document-reading accuracy against the bundled fixture set using the
// production model. Internal only: requires EVAL_SECRET in the x-eval-secret header.
// Results are stored at evals/latest and read with /internal/eval/status.
export default async (req: Request) => {
  const svc = await getFirebaseServices();
  const secret = internalToken('eval');
  const got = req.headers.get('x-eval-secret') || '';
  if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new Response('Forbidden', { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { only?: string[] };
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  await svc.db.set('evals/latest', { status: 'running', runId, startedAt: new Date().toISOString() });
  try {
    const report = await runEval(svc, { only: body.only });
    const doc = { status: 'done', runId, report: JSON.parse(JSON.stringify(report)), markdown: toMarkdown(report) };
    await svc.db.set(`evals/${runId}`, doc);
    await svc.db.set('evals/latest', doc);
  } catch (e: any) {
    await svc.db.set('evals/latest', { status: 'failed', runId, error: String(e?.message ?? e).slice(0, 500) });
  }
  return new Response('ok');
};
