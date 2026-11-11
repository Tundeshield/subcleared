// External subcontractor portal. Mobile-first: one column, large touch
// targets, camera-friendly file input, explicit upload progress, and success
// shown only after the server confirms the file was checked and stored.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { api } from '../../lib/api';
import { ACCEPT, precheck, uploadDocument } from '../../lib/upload';
import { cx, Field, FormError, Icon, Logo, Progress, Spinner, Tabs } from '../../ui';

type Phase = { k: 'opening' } | { k: 'code'; hint: string; org: string; devCode?: string } | { k: 'ready' } | { k: 'error'; title: string; message: string };

export default function Portal() {
  const { token = '' } = useParams();
  const key = `sc.portal.${token.slice(0, 16)}`;
  const [phase, setPhase] = useState<Phase>({ k: 'opening' });
  const [session, setSession] = useState<string | null>(() => sessionStorage.getItem(key));
  const [state, setState] = useState<any>(null);
  const [tab, setTab] = useState<'todo' | 'library' | 'history' | 'contact'>('todo');
  const [notice, setNotice] = useState<{ file: string; req: string } | null>(null);

  const fail = (e: any) => {
    const title = e.code === 'link_expired' ? 'This link has expired' : e.code === 'link_revoked' ? 'This link was withdrawn' : e.code === 'sub_inactive' ? 'Document collection paused' : e.status === 429 ? 'Please wait a moment' : 'This link isn’t valid';
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

  if (phase.k === 'opening' || (phase.k === 'ready' && !state)) return <Shell><div className="py-24 grid place-items-center text-muted"><Spinner className="w-6 h-6" /><p className="mt-3 text-sm">Opening your secure link…</p></div></Shell>;
  if (phase.k === 'error') return <Shell><div className="py-16"><div className="text-bad">{Icon.alert('w-6 h-6')}</div><h1 className="text-xl font-semibold mt-3">{phase.title}</h1><p className="text-muted mt-2">{phase.message}</p><p className="text-sm text-faint mt-6">For security, links are personal, time-limited and can be withdrawn. Contact the company that sent it if you still need to submit documents.</p></div></Shell>;
  if (phase.k === 'code') return <Shell><CodeStep phase={phase} onSubmit={(c) => open(c)} onResend={() => open()} /></Shell>;

  const s = state;
  const todo = s.requirements.filter((r: any) => r.needsAction);
  const others = s.requirements.filter((r: any) => !r.needsAction);
  return (
    <Shell org={s.organisation.name}>
      <div className="pt-6 pb-4">
        <p className="text-sm text-muted">{s.organisation.name} · compliance documents</p>
        <h1 className="text-2xl font-semibold mt-1">{s.subcontractor.legalName}</h1>
        {s.projects.length > 0 && <p className="text-sm text-muted mt-1">For {s.projects.join(', ')}</p>}
        <div className="grid grid-cols-3 gap-2 mt-5">
          {[['Needed', s.summary.needed, 'text-bad'], ['In review', s.summary.review, 'text-info'], ['Accepted', s.summary.accepted, 'text-ok']].map(([l, n, c]) => (
            <div key={l as string} className="panel px-3 py-2.5"><div className="text-xs text-muted">{l}</div><div className={cx('text-xl font-semibold tabular-nums', n ? (c as string) : 'text-ink')}>{n}</div></div>
          ))}
        </div>
        {s.openRequests.filter((r: any) => r.message || r.dueDate).map((r: any) => (
          <div key={r.id} className="mt-3 rounded border border-line bg-surface px-3 py-2.5 text-sm">{r.message && <p>“{r.message}” <span className="text-muted">— {r.from}</span></p>}{r.dueDate && <p className="text-muted">Please submit by <span className="text-ink">{formatDate(r.dueDate)}</span>.</p>}</div>
        ))}
      </div>
      {notice && (
        <div className="mb-4 rounded border border-ok/30 bg-ok/5 px-3 py-3 text-sm flex gap-2" role="status">
          <span className="text-ok mt-0.5">{Icon.check()}</span>
          <span className="flex-1"><span className="font-medium">Received: {notice.req}.</span> {notice.file} passed our security checks and is now waiting for review. You can close this page or upload the next document.</span>
          <button className="text-faint" onClick={() => setNotice(null)} aria-label="Dismiss">{Icon.x()}</button>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'todo', label: 'To do', count: todo.length }, { value: 'library', label: 'My documents', count: s.library.length }, { value: 'history', label: 'History' }, { value: 'contact', label: 'Contact' }]} />
      <div className="py-5 space-y-3">
        {tab === 'todo' && <>
          {todo.length === 0 && <div className="rounded border border-ok/30 bg-ok/5 px-4 py-4"><div className="font-medium text-ok">Nothing needed right now</div><p className="text-sm text-muted mt-1">Everything requested has been received. We’ll email you if anything changes or a document is due for renewal.</p></div>}
          {todo.map((r: any) => <RequirementCard key={r.id} r={r} session={session!} onDone={(f) => { setNotice({ file: f, req: r.name }); load(session!); }} />)}
          {others.length > 0 && <><h2 className="eyebrow pt-4">Everything else</h2>{others.map((r: any) => <RequirementCard key={r.id} r={r} session={session!} onDone={(f) => { setNotice({ file: f, req: r.name }); load(session!); }} />)}</>}
        </>}
        {tab === 'library' && (s.library.length === 0 ? <p className="text-muted text-sm">No accepted documents yet.</p> : s.library.map((d: any) => (
          <div key={d.versionId} className="panel px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0"><div className="font-medium truncate">{d.title}</div><div className="text-xs text-muted truncate">{d.fileName}</div><div className="text-xs text-faint">{d.expiryDate ? `Valid until ${formatDate(d.expiryDate)}` : 'No expiry'}</div></div>
            <ViewButton session={session!} versionId={d.versionId} />
          </div>
        )))}
        {tab === 'history' && (s.history.length === 0 ? <p className="text-muted text-sm">Nothing submitted yet.</p> : <ul className="panel divide-y divide-line">{s.history.map((h: any) => (
          <li key={h.versionId} className="px-4 py-3 text-sm"><div className="flex justify-between gap-2"><span className="font-medium truncate">{h.requirement}</span><span className={cx('text-xs whitespace-nowrap', h.status === 'Accepted' ? 'text-ok' : /Not accepted|Blocked/.test(h.status) ? 'text-bad' : 'text-muted')}>{h.status}</span></div>
            <div className="text-xs text-muted truncate">{h.fileName} · v{h.versionNumber} · {formatDateTime(h.uploadedAt)} · {h.uploadedBy}</div>{h.reason && <div className="text-xs text-bad mt-1">{h.reason}</div>}</li>
        ))}</ul>)}
        {tab === 'contact' && <ContactForm s={s} session={session!} onSaved={() => load(session!)} />}
      </div>
      <p className="text-xs text-faint pb-10">Secure link for {s.contact.email}, valid until {formatDate(s.linkExpiresAt)}. {s.organisation.name} only sees documents you submit here; nothing is shared with other companies.</p>
    </Shell>
  );
}

function Shell({ children, org }: { children: React.ReactNode; org?: string }) {
  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-surface/80 backdrop-blur sticky top-0 z-10"><div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between"><Logo /><span className="text-xs text-faint truncate ml-3">{org ? `Secure portal for ${org}` : 'Secure document portal'}</span></div></header>
      <main className="max-w-xl mx-auto px-4">{children}</main>
    </div>
  );
}

function CodeStep({ phase, onSubmit, onResend }: { phase: { hint: string; org: string; devCode?: string }; onSubmit: (c: string) => Promise<void>; onResend: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="py-14">
      <h1 className="text-xl font-semibold">Confirm it’s you</h1>
      <p className="text-muted mt-2">We sent a 6-digit code to <span className="text-ink">{phase.hint}</span> to open {phase.org}’s portal.</p>
      <form className="mt-6 space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { await onSubmit(code.trim()); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
        <Field label="Code"><input className="input h-12 text-xl tracking-[0.4em] font-mono text-center" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></Field>
        <FormError error={err} />
        <button className="btn-primary btn-lg w-full" disabled={code.length !== 6 || busy}>{busy && <Spinner />}Continue</button>
        <button type="button" className="btn-ghost w-full" onClick={onResend}>Send a new code</button>
        {phase.devCode && <p className="text-xs text-warn">Local development code: {phase.devCode}</p>}
      </form>
    </div>
  );
}

function RequirementCard({ r, session, onDone }: { r: any; session: string; onDone: (fileName: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<null | 'preparing' | 'uploading' | 'verifying'>(null);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const tone = r.needsAction ? (['expired', 'rejected', 'overdue'].includes(r.status) ? 'text-bad' : 'text-warn') : r.status === 'approved' ? 'text-ok' : 'text-info';
  const canUpload = r.kind === 'document';
  const pick = (f: File | null) => { setErr(null); setDone(null); if (f) { const p = precheck(f); if (p) { setErr(p); return; } } setFile(f); };
  const send = async () => {
    if (!file) return;
    setErr(null); abort.current = new AbortController();
    try {
      await uploadDocument({ portal: session }, file, r.id, (s, p) => { setStage(s); setProgress(p); }, abort.current.signal);
      setDone(file.name); onDone(file.name); setFile(null);
    } catch (e: any) { setErr(e.code === 'portal_session' ? 'Your session ended. Reload the page from your email link and try again.' : e.message); } finally { setStage(null); }
  };
  return (
    <div className={cx('panel p-4', r.needsAction && 'border-line-strong')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="font-medium">{r.name}{!r.mandatory && <span className="text-xs text-faint font-normal"> · optional</span>}</h3>{r.projects.length > 0 && <p className="text-xs text-faint">{r.projects.join(', ')}</p>}</div>
        <span className={cx('text-xs font-medium whitespace-nowrap', tone)}>{r.label}</span>
      </div>
      {r.rejectionReason && <div className="mt-2 rounded bg-bad/10 border border-bad/20 px-3 py-2 text-sm"><span className="font-medium text-bad">Why it wasn’t accepted: </span>{r.rejectionReason}</div>}
      {r.expiryDate && <p className="text-sm text-muted mt-2">{r.status === 'expired' ? 'Expired' : 'Expires'} {formatDate(r.expiryDate)}</p>}
      {(r.instructions || r.description) && r.needsAction && <p className="text-sm text-muted mt-2">{r.instructions || r.description}</p>}
      {!canUpload && r.needsAction && <p className="text-sm text-muted mt-2">{r.name} is confirmed directly with the contractor — they’ll be in touch.</p>}
      {done && <div className="mt-3 rounded border border-ok/30 bg-ok/5 px-3 py-2.5 text-sm flex gap-2"><span className="text-ok mt-0.5">{Icon.check()}</span><span><span className="font-medium">Received.</span> {done} passed our security checks and is now waiting for review.</span></div>}
      {canUpload && (
        <div className="mt-3">
          <input ref={input} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ''; }} aria-label={`Choose file for ${r.name}`} />
          {file && !stage && <div className="flex items-center gap-2 text-sm mb-2 rounded bg-raised px-3 py-2"><span className="text-accent">{Icon.file()}</span><span className="truncate flex-1">{file.name}</span><span className="text-xs text-faint">{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>}
          {stage && <div className="mb-3"><div className="text-xs text-muted mb-1">{stage === 'preparing' ? 'Preparing…' : stage === 'uploading' ? `Uploading… ${Math.round(progress * 100)}%` : 'Checking the file and saving…'}</div><Progress value={stage === 'verifying' ? 1 : progress} /></div>}
          <FormError error={err} />
          <div className="flex gap-2 mt-2">
            {!file ? <button className={cx('flex-1 btn-lg', r.needsAction ? 'btn-primary' : 'btn-secondary')} onClick={() => input.current?.click()} disabled={!!stage}>{Icon.upload()}{r.status === 'approved' || r.status === 'expiring_soon' ? 'Upload a newer version' : r.status === 'awaiting_review' ? 'Replace submission' : 'Choose file or take photo'}</button>
              : <><button className="btn-primary btn-lg flex-1" onClick={send} disabled={!!stage}>{stage && <Spinner />}Submit</button>{stage ? <button className="btn-secondary btn-lg" onClick={() => abort.current?.abort()}>Cancel</button> : <button className="btn-secondary btn-lg" onClick={() => setFile(null)}>Change</button>}</>}
          </div>
          <p className="text-xs text-faint mt-2">PDF, JPEG or PNG · up to 15 MB</p>
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
    <form className="panel p-4 space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); setMsg(null); try { await api('portal.updateContact', { session, name, phone }, { portal: true }); setMsg('Saved.'); onSaved(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
      <Field label="Your name"><input className="input h-11" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <Field label="Phone"><input className="input h-11" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="Email" hint={`To change your email address, ask ${s.organisation.name} — it’s how we confirm it’s you.`}><input className="input h-11" value={s.contact.email} disabled /></Field>
      <FormError error={err} />{msg && <p className="text-sm text-ok">{msg}</p>}
      <button className="btn-primary btn-lg w-full" disabled={busy}>{busy && <Spinner />}Save contact details</button>
    </form>
  );
}
