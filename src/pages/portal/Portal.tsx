// External subcontractor portal. Mobile-first: one column, large touch
// targets, camera-friendly file input, explicit upload progress, and success
// shown only after the server confirms the file was checked and stored.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { api } from '../../lib/api';
import { ACCEPT, precheck, uploadDocument } from '../../lib/upload';
import { cx, Field, FormError, Glyph, toneText, Icon, Logo, Progress, Spinner, Tabs } from '../../ui';

type Phase = { k: 'opening' } | { k: 'code'; hint: string; org: string; devCode?: string } | { k: 'ready' } | { k: 'error'; title: string; message: string };

const TONE: Record<string, any> = { approved: 'ok', expiring_soon: 'attention', awaiting_review: 'progress', review_required: 'progress', submitted: 'progress', expired: 'blocked', rejected: 'blocked', overdue: 'blocked', missing: 'blocked', requested: 'blocked', not_applicable: 'na' };

export default function Portal() {
  const { token = '' } = useParams();
  const key = `sc.portal.${token.slice(0, 16)}`;
  const [phase, setPhase] = useState<Phase>({ k: 'opening' });
  const [session, setSession] = useState<string | null>(() => sessionStorage.getItem(key));
  const [state, setState] = useState<any>(null);
  const [tab, setTab] = useState<'todo' | 'library' | 'history' | 'contact'>('todo');
  const [notice, setNotice] = useState<{ file: string; req: string } | null>(null);

  const fail = (e: any) => {
    const title = e.code === 'link_expired' ? 'This link has expired' : e.code === 'link_revoked' ? 'This link has been withdrawn' : e.code === 'sub_inactive' ? 'Document collection is paused' : e.status === 429 ? 'Please wait a moment' : 'This link isn’t valid';
    setPhase({ k: 'error', title, message: e.message });
  };
  const load = useCallback(async (s: string) => {
    try { setState(await api('portal.state', { session: s }, { portal: true })); setPhase({ k: 'ready' }); } catch (e: any) {
      if (e.code === 'portal_session') { sessionStorage.removeItem(key); setSession(null); open(); } else fail(e);
    }
  }, [key]); // eslint-disable-line
  const open = useCallback(async (code?: string) => {
    try {
      const r = await api('portal.open', { token, code }, { portal: true });
      if (r.needsCode) { setPhase({ k: 'code', hint: r.emailHint, org: r.orgName, devCode: r.devCode }); return; }
      sessionStorage.setItem(key, r.session); setSession(r.session); await load(r.session);
    } catch (e: any) { if (code && ['code_wrong', 'code_expired', 'code_locked'].includes(e.code)) throw e; fail(e); }
  }, [token, key, load]); // eslint-disable-line
  useEffect(() => { if (session) load(session); else open(); }, []); // eslint-disable-line

  if (phase.k === 'opening' || (phase.k === 'ready' && !state)) return <Shell><div className="py-24 text-muted flex flex-col items-start gap-3"><Spinner className="w-5 h-5" /><p>Opening your secure link…</p></div></Shell>;
  if (phase.k === 'error') return <Shell><div className="py-16"><Glyph tone="blocked" className="w-6 h-6" /><h1 className="text-2xl font-medium mt-4">{phase.title}</h1><p className="text-muted mt-3 leading-relaxed">{phase.message}</p><p className="text-sm text-faint mt-8 leading-relaxed">For security, links are personal, time-limited and can be withdrawn. Contact the company that sent it if you still need to submit documents.</p></div></Shell>;
  if (phase.k === 'code') return <Shell><CodeStep phase={phase} onSubmit={(c) => open(c)} onResend={() => open()} /></Shell>;

  const s = state;
  const todo = s.requirements.filter((r: any) => r.needsAction);
  const others = s.requirements.filter((r: any) => !r.needsAction);
  const onDone = (req: string) => (f: string) => { setNotice({ file: f, req }); load(session!); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  return (
    <Shell org={s.organisation.name}>
      <div className="pt-8 pb-6">
        <p className="text-sm text-muted">{s.organisation.name} has asked for documents from</p>
        <h1 className="text-2xl font-medium mt-1 leading-tight">{s.subcontractor.legalName}</h1>
        {s.projects.length > 0 && <p className="text-muted mt-2">For {s.projects.join(', ')}</p>}
        <dl className="grid grid-cols-3 mt-7 border-t border-ink">
          {[['Still needed', s.summary.needed], ['Being reviewed', s.summary.review], ['Accepted', s.summary.accepted]].map(([l, n]) => (
            <div key={l as string} className="pt-3"><dd className={cx('text-2xl tnum', l === 'Accepted' && Number(n) > 0 && 'text-success')}>{n}</dd><dt className="text-sm text-muted">{l}</dt></div>
          ))}
        </dl>
        {s.openRequests.filter((r: any) => r.message || r.dueDate).map((r: any) => (
          <div key={r.id} className="mt-6 border-l-2 border-accent pl-4 text-[0.9375rem]">{r.message && <p>“{r.message}” <span className="text-muted">— {r.from}</span></p>}{r.dueDate && <p className="text-muted mt-0.5">Please send by <span className="text-ink font-medium">{formatDate(r.dueDate)}</span>.</p>}</div>
        ))}
      </div>
      {notice && (
        <div className="mb-6 rounded-md bg-accent/[0.09] px-4 py-3.5 flex gap-3" role="status">
          <Glyph tone="ok" className="w-5 h-5 mt-0.5" />
          <div className="flex-1"><div className="font-medium">Received: {notice.req}</div><p className="text-sm text-muted mt-0.5">{notice.file} passed our security checks and is now with {s.organisation.name} for review.</p></div>
          <button className="text-faint self-start p-1" onClick={() => setNotice(null)} aria-label="Dismiss">{Icon.x()}</button>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'todo', label: 'To do', count: todo.length }, { value: 'library', label: 'Accepted', count: s.library.length }, { value: 'history', label: 'History' }, { value: 'contact', label: 'Your details' }]} />
      <div className="py-6">
        {tab === 'todo' && <>
          {todo.length === 0 && <div className="flex gap-3 py-2"><Glyph tone="ok" className="w-5 h-5 mt-0.5" /><div><div className="font-medium">Nothing needed right now</div><p className="text-muted mt-1">Everything requested has been sent. We'll email you if anything changes or a document is due for renewal.</p></div></div>}
          <div className="space-y-4">{todo.map((r: any) => <RequirementCard key={r.id} r={r} session={session!} onDone={onDone(r.name)} />)}</div>
          {others.length > 0 && <><h2 className="eyebrow mt-10 mb-3">Already sent</h2><div className="border-t border-line">{others.map((r: any) => <RequirementCard key={r.id} r={r} session={session!} onDone={onDone(r.name)} compact />)}</div></>}
        </>}
        {tab === 'library' && (s.library.length === 0 ? <p className="text-muted">Nothing has been accepted yet.</p> : <ul className="border-t border-line">{s.library.map((d: any) => (
          <li key={d.versionId} className="py-4 border-b border-line flex items-center justify-between gap-3">
            <div className="min-w-0"><div className="font-medium">{d.title}</div><div className="text-sm text-muted truncate">{d.fileName}</div><div className="text-sm text-faint">{d.expiryDate ? `Valid until ${formatDate(d.expiryDate)}` : 'Does not expire'}</div></div>
            <ViewButton session={session!} versionId={d.versionId} />
          </li>
        ))}</ul>)}
        {tab === 'history' && (s.history.length === 0 ? <p className="text-muted">Nothing sent yet.</p> : <ol className="border-t border-line">{s.history.map((h: any) => (
          <li key={h.versionId} className="py-4 border-b border-line">
            <div className="flex justify-between gap-3"><span className="font-medium">{h.requirement}</span><span className={cx('text-sm whitespace-nowrap', h.status === 'Accepted' ? 'text-success' : /Not accepted|Blocked|More information/.test(h.status) ? 'text-danger font-medium' : 'text-muted')}>{h.status}</span></div>
            <div className="text-sm text-muted mt-0.5 break-all">{h.fileName} · version {h.versionNumber}</div><div className="text-xs text-faint">{formatDateTime(h.uploadedAt)} · {h.uploadedBy}</div>
            {h.reason && <p className="text-sm mt-1.5 border-l-2 border-ink pl-3">{h.reason}</p>}
          </li>
        ))}</ol>)}
        {tab === 'contact' && <ContactForm s={s} session={session!} onSaved={() => load(session!)} />}
      </div>
      <p className="text-xs text-faint pb-12 leading-relaxed">This secure link is for {s.contact.email} and works until {formatDate(s.linkExpiresAt)}. {s.organisation.name} only sees what you send here — nothing is shared with other companies.</p>
    </Shell>
  );
}

function Shell({ children, org }: { children: React.ReactNode; org?: string }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-canvas/95 backdrop-blur sticky top-0 z-10"><div className="max-w-xl mx-auto px-5 h-14 flex items-center justify-between gap-3"><Logo /><span className="text-xs text-faint truncate">{org ? `Secure upload for ${org}` : 'Secure document upload'}</span></div></header>
      <main className="max-w-xl mx-auto px-5">{children}</main>
    </div>
  );
}

function CodeStep({ phase, onSubmit, onResend }: { phase: { hint: string; org: string; devCode?: string }; onSubmit: (c: string) => Promise<void>; onResend: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="py-16">
      <h1 className="text-2xl font-medium">Confirm it's you</h1>
      <p className="text-muted mt-3 leading-relaxed">We've sent a 6-digit code to <span className="text-ink">{phase.hint}</span> to open {phase.org}'s portal.</p>
      <form className="mt-8 space-y-5" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await onSubmit(code.trim()); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
        <Field label="Code"><input className="input h-14 text-2xl tracking-[0.5em] font-mono text-center" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></Field>
        <FormError error={err} />
        <button className="btn-primary btn-lg w-full" disabled={code.length !== 6 || busy}>{busy && <Spinner />}Continue</button>
        <button type="button" className="btn-ghost w-full" onClick={onResend}>Send a new code</button>
        {phase.devCode && <p className="text-xs text-faint">Local development code: {phase.devCode}</p>}
      </form>
    </div>
  );
}

function RequirementCard({ r, session, onDone, compact }: { r: any; session: string; onDone: (fileName: string) => void; compact?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<null | 'preparing' | 'uploading' | 'verifying'>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(!compact);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const canUpload = r.kind === 'document';
  const pick = (f: File | null) => { setErr(null); if (f) { const p = precheck(f); if (p) { setErr(p); return; } } setFile(f); };
  const send = async () => {
    if (!file) return;
    setErr(null); abort.current = new AbortController();
    try {
      await uploadDocument({ portal: session }, file, r.id, (s, p) => { setStage(s); setProgress(p); }, abort.current.signal);
      const name = file.name; setFile(null); onDone(name);
    } catch (e: any) { setErr(e.code === 'portal_session' ? 'Your session has ended. Open the link from your email again and retry.' : e.message); } finally { setStage(null); }
  };
  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="font-medium text-md">{r.name}{!r.mandatory && <span className="text-sm text-faint font-normal"> · optional</span>}</h3>{r.projects.length > 0 && !compact && <p className="text-sm text-faint">{r.projects.join(', ')}</p>}</div>
      <span className={cx('inline-flex items-center gap-1.5 text-sm whitespace-nowrap', toneText(TONE[r.status] ?? 'none'))}><Glyph tone={TONE[r.status] ?? 'none'} className="w-3.5 h-3.5" />{r.label}</span>
    </div>
  );
  if (compact && !expanded) return <div className="py-4 border-b border-line">{header}{canUpload && <button className="btn-quiet mt-2" onClick={() => setExpanded(true)}>{r.status === 'approved' || r.status === 'expiring_soon' ? 'Send a newer version' : 'Replace what you sent'}</button>}</div>;
  return (
    <div className={cx(compact ? 'py-4 border-b border-line' : 'rounded-md border border-line-strong bg-paper p-5')}>
      {header}
      {r.rejectionReason && <div className="mt-3 border-l-2 border-ink pl-3"><div className="text-sm font-medium">Why it wasn't accepted</div><p className="text-sm text-muted mt-0.5">{r.rejectionReason}</p></div>}
      {r.expiryDate && <p className="text-sm text-muted mt-2">{r.status === 'expired' ? 'Expired' : 'Expires'} {formatDate(r.expiryDate)}</p>}
      {(r.instructions || r.description) && r.needsAction && <p className="text-[0.9375rem] text-muted mt-3 leading-relaxed">{r.instructions || r.description}</p>}
      {!canUpload && r.needsAction && <p className="text-sm text-muted mt-3">This is checked directly by the contractor — they'll be in touch if they need anything.</p>}
      {canUpload && (
        <div className="mt-5">
          <input ref={input} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ''; }} aria-label={`Choose a file for ${r.name}`} />
          {file && !stage && <div className="flex items-center gap-2.5 mb-3 py-2.5 border-y border-line"><span className="text-accent">{Icon.file()}</span><span className="truncate flex-1">{file.name}</span><span className="text-sm text-faint tnum">{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>}
          {stage && <div className="mb-4"><div className="text-sm text-muted mb-1.5">{stage === 'preparing' ? 'Getting ready…' : stage === 'uploading' ? `Uploading… ${Math.round(progress * 100)}%` : 'Checking the file and saving…'}</div><Progress value={stage === 'verifying' ? 1 : progress} /></div>}
          <FormError error={err} />
          <div className="flex gap-2 mt-2">
            {!file ? <button className={cx('flex-1 btn-lg', r.needsAction ? 'btn-primary' : 'btn-secondary')} onClick={() => input.current?.click()} disabled={!!stage}>{Icon.upload()}{r.needsAction ? 'Choose a file or take a photo' : 'Choose a file'}</button>
              : <><button className="btn-primary btn-lg flex-1" onClick={send} disabled={!!stage}>{stage && <Spinner />}Send</button>{stage ? <button className="btn-secondary btn-lg" onClick={() => abort.current?.abort()}>Cancel</button> : <button className="btn-secondary btn-lg" onClick={() => setFile(null)}>Change</button>}</>}
          </div>
          <p className="text-xs text-faint mt-2.5">PDF, JPEG or PNG · up to 15 MB</p>
        </div>
      )}
    </div>
  );
}

function ViewButton({ session, versionId }: { session: string; versionId: string }) {
  const [busy, setBusy] = useState(false);
  return <button className="btn-secondary btn-sm" disabled={busy} onClick={async () => { setBusy(true); const w = window.open('', '_blank'); try { const r = await api('portal.fileUrl', { session, versionId }, { portal: true }); if (w) w.location.href = r.url; } catch { w?.close(); } finally { setBusy(false); } }}>{busy ? <Spinner /> : 'View'}</button>;
}

function ContactForm({ s, session, onSaved }: { s: any; session: string; onSaved: () => void }) {
  const [name, setName] = useState(s.contact.name);
  const [phone, setPhone] = useState(s.contact.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-5" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); setMsg(null); try { await api('portal.updateContact', { session, name, phone }, { portal: true }); setMsg('Saved.'); onSaved(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
      <Field label="Your name"><input className="input h-12" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Telephone"><input className="input h-12" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="Email" hint={`To change your email address, ask ${s.organisation.name} — it's how we confirm it's you.`}><input className="input h-12" value={s.contact.email} disabled /></Field>
      <FormError error={err} />{msg && <p className="text-sm text-success flex items-center gap-2"><Glyph tone="ok" className="w-4 h-4" />{msg}</p>}
      <button className="btn-primary btn-lg w-full" disabled={busy}>{busy && <Spinner />}Save your details</button>
    </form>
  );
}
