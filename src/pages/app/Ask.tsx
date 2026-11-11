import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dataChanged } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Callout, cx, Spinner, useToast } from '../../ui';

const ROUTES: Record<string, string> = { sub: '/app/subcontractors/', project: '/app/projects/', review: '/app/reviews/' };

/** Renders the assistant's answer: plain text, simple lists, and links to real records only. */
function Answer({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\[\[(?:sub|project|review):[^|\]]+\|[^\]]+\]\]|\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = part.match(/^\[\[(sub|project|review):([^|\]]+)\|([^\]]+)\]\]$/);
    if (m) return <Link key={i} to={`${ROUTES[m[1]]}${m[2]}`} className="font-medium underline underline-offset-4 decoration-line-strong hover:decoration-ink">{m[3]}</Link>;
    const b = part.match(/^\*\*([^*]+)\*\*$/);
    return b ? <strong key={i}>{b[1]}</strong> : <Fragment key={i}>{part}</Fragment>;
  });
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 leading-relaxed">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*[-•*]\s+/.test(l) || !l.trim())) return <ul key={i} className="space-y-1.5 list-disc pl-5">{lines.filter((l) => l.trim()).map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>)}</ul>;
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{/^\s*[-•*]\s+/.test(l) ? <>• {inline(l.replace(/^\s*[-•*]\s+/, ''))}</> : inline(l)}</Fragment>)}</p>;
      })}
    </div>
  );
}

export function AskBox({ projectId, suggestions, className }: { projectId?: string; suggestions?: string[]; className?: string }) {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ question: string; answer: string; action: any } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const askIt = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true); setErr(null);
    try { const r = await api<any>('assistant.ask', { question, projectId }); setRes({ question, ...r }); setQ(''); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setSending(true);
    try {
      const r = await api<any>('assistant.confirm', res!.action);
      const sent = r.results.filter((x: any) => x.status === 'sent').length;
      const skipped = r.results.filter((x: any) => x.status !== 'sent');
      toast(`${sent} reminder${sent === 1 ? '' : 's'} sent${skipped.length ? `; ${skipped.length} not sent (${skipped[0].detail})` : ''}`, skipped.length ? 'info' : undefined);
      setRes({ ...res!, action: null }); dataChanged();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setSending(false); }
  };
  const chips = suggestions ?? (projectId
    ? ['Who isn’t ready for this project, and why?', 'What has changed on this project this week?', 'Chase everyone with outstanding paperwork']
    : ['Who isn’t ready to work?', 'Which documents expire in the next 30 days?', 'What changed this week?']);
  return (
    <section className={cx('rounded-lg border border-line bg-paper', className)} aria-label="Ask SubCleared">
      <form className="flex items-center gap-2 p-2" onSubmit={(e) => { e.preventDefault(); askIt(q); }}>
        <span className="pl-2 text-faint" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </span>
        <input className="flex-1 min-w-0 bg-transparent outline-none py-2 text-md placeholder:text-faint" placeholder={projectId ? 'Ask about this project…' : 'Ask about your paperwork…'} value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} aria-label="Question" />
        <button className="btn-primary btn-sm" disabled={busy || !q.trim()}>{busy && <Spinner />}Ask</button>
      </form>
      {!res && !busy && (
        <div className="flex flex-wrap gap-2 px-3 pb-3">
          {chips.map((c) => <button key={c} type="button" className="text-sm rounded-full border border-line px-3 py-1 text-muted hover:text-ink hover:border-line-strong" onClick={() => askIt(c)}>{c}</button>)}
        </div>
      )}
      {err && <div className="px-3 pb-3"><Callout tone="bad">{err}</Callout></div>}
      {res && (
        <div className="border-t border-line px-4 py-4">
          <div className="text-sm text-faint mb-2">{res.question}</div>
          <Answer text={res.answer} />
          {res.action?.type === 'send_reminders' && (
            <div className="mt-4 rounded-md bg-raised p-4">
              <div className="font-medium">Send {res.action.items.length} reminder{res.action.items.length === 1 ? '' : 's'}?</div>
              <ul className="mt-2 text-sm text-muted space-y-1">{res.action.items.map((i: any) => <li key={`${i.projectId}:${i.subcontractorId}`}>{i.subcontractor} · {i.project}: {i.documents.join(', ')}</li>)}</ul>
              <p className="text-xs text-faint mt-2">Each contact gets a secure link listing exactly what’s outstanding. Nothing is sent until you confirm.</p>
              <div className="mt-3 flex gap-2">
                {can('requests.send') ? <button className="btn-primary btn-sm" disabled={sending} onClick={confirm}>{sending && <Spinner />}Send reminders</button> : <span className="text-sm text-muted">You don’t have permission to send requests.</span>}
                <button className="btn-ghost btn-sm" onClick={() => setRes({ ...res, action: null })}>Not now</button>
              </div>
            </div>
          )}
          <p className="text-xs text-faint mt-4">Answers come from your records in SubCleared. Check anything important by opening the linked record.</p>
          <button className="btn-quiet mt-2" onClick={() => setRes(null)}>Ask something else</button>
        </div>
      )}
    </section>
  );
}
