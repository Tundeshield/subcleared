import { useEffect, useRef, useState } from 'react';
import { addDays } from '../../domain/dates';
import { api, useApi, useMutation } from '../../lib/api';
import { ACCEPT, uploadDocument } from '../../lib/upload';
import { Callout, Checkbox, cx, Dialog, Field, FormError, Icon, Progress, Spinner, useToast } from '../../ui';

/** Request documents from one subcontractor's contacts via secure links. */
export function RequestDialog({ open, onClose, subcontractorId, projectId, requirementIds: preset, type = 'request' }: {
  open: boolean; onClose: () => void; subcontractorId: string; projectId?: string; requirementIds?: string[]; type?: 'request' | 'portal_access';
}) {
  const detail = useApi<any>(open ? 'subs.get' : null, { subcontractorId });
  const { run, busy, error } = useMutation('requests.create');
  const [contacts, setContacts] = useState<string[]>([]);
  const [reqs, setReqs] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const [days, setDays] = useState(14);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<any[] | null>(null);
  const toast = useToast();
  const d = detail.data;
  useEffect(() => {
    if (!open) { setResult(null); return; }
    if (!d) return;
    const primary = d.subcontractor.contacts.find((c: any) => c.primary) ?? d.subcontractor.contacts[0];
    setContacts(primary ? [primary.id] : []);
    if (preset?.length) setReqs(preset);
    else {
      const outstanding = new Set<string>();
      for (const p of d.projects) if (!projectId || p.id === projectId) for (const r of p.results) if (['missing', 'requested', 'overdue', 'rejected', 'expired', 'expiring_soon'].includes(r.status)) outstanding.add(r.requirementId);
      setReqs([...outstanding]);
    }
    setDue(addDays(new Date().toISOString().slice(0, 10), 14));
    setDays(type === 'portal_access' ? 90 : 14);
  }, [open, d, projectId, preset, type]);
  const applicable = d ? d.requirements.filter((r: any) => r.kind === 'document' && (d.projects.some((p: any) => (!projectId || p.id === projectId) && p.results.some((x: any) => x.requirementId === r.id && x.status !== 'not_applicable')) || reqs.includes(r.id))) : [];
  return (
    <Dialog open={open} onClose={onClose} width="max-w-2xl" title={type === 'portal_access' ? 'Invite to subcontractor portal' : 'Request documents'} description={d?.subcontractor.legalName}
      footer={result ? <button className="btn-primary" onClick={onClose}>Done</button> : <>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !contacts.length || (type === 'request' && !reqs.length)} onClick={async () => {
          try {
            const r = await run({ subcontractorId, type, contactIds: contacts, requirementIds: type === 'request' ? reqs : [], projectIds: projectId ? [projectId] : [], dueDate: type === 'request' ? due || undefined : undefined, expiresInDays: days, message: message || undefined });
            setResult(r.results);
            toast(type === 'request' ? 'Request sent' : 'Portal invitation sent');
          } catch { /* shown */ }
        }}>{busy && <Spinner />}{type === 'request' ? 'Send request' : 'Send invitation'}</button>
      </>}>
      {!d ? <Spinner /> : result ? (
        <div className="space-y-3">
          {result.map((r) => (
            <div key={r.requestId} className="rounded border border-line p-3">
              <div className="flex items-center justify-between gap-2"><span className="font-medium text-sm">{r.contact}</span>
                <span className={cx('text-xs', r.emailStatus === 'failed' ? 'text-bad' : 'text-ok')}>{r.emailStatus === 'sent' ? 'Email sent' : r.emailStatus === 'dev_logged' ? 'Email captured (dev mailbox)' : r.emailStatus === 'failed' ? `Email failed: ${r.emailError}` : r.emailStatus}</span></div>
              <div className="mt-2 flex gap-2"><input className="input h-8 text-xs font-mono" readOnly value={r.url} onFocus={(e) => e.target.select()} /><button className="btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(r.url).then(() => toast('Link copied'))}>Copy</button></div>
              <p className="text-xs text-faint mt-1.5">This secure link works only for {r.contact} and expires {new Date(r.expiresAt).toLocaleDateString('en-GB')}. You can revoke it from the subcontractor's Activity tab.</p>
            </div>
          ))}
        </div>
      ) : d.subcontractor.contacts.length === 0 ? (
        <Callout tone="warn" title="No contacts">Add a contact with an email address to this subcontractor first.</Callout>
      ) : (
        <div className="space-y-5">
          <fieldset><legend className="label">Send to</legend><div className="space-y-2">
            {d.subcontractor.contacts.map((c: any) => <Checkbox key={c.id} checked={contacts.includes(c.id)} onChange={(v) => setContacts(v ? [...contacts, c.id] : contacts.filter((x) => x !== c.id))} label={<>{c.name} <span className="text-muted">· {c.email}</span></>} hint={c.roles?.join(', ')} />)}
          </div><p className="hint">Each contact gets their own link, so access can be revoked individually.</p></fieldset>
          {type === 'request' && (
            <fieldset><legend className="label">Documents to request</legend>
              {applicable.length === 0 ? <p className="text-sm text-muted">No document requirements apply yet. Assign this subcontractor to a project with requirements first.</p> : (
                <div className="grid sm:grid-cols-2 gap-2">{applicable.map((r: any) => <Checkbox key={r.id} checked={reqs.includes(r.id)} onChange={(v) => setReqs(v ? [...reqs, r.id] : reqs.filter((x) => x !== r.id))} label={r.name} hint={r.category} />)}</div>
              )}
            </fieldset>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            {type === 'request' && <Field label="Due date"><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>}
            <Field label="Link expires after" hint={type === 'portal_access' ? 'Up to 90 days. Contacts confirm their email with a one-time code.' : 'Up to 30 days.'}>
              <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>{(type === 'portal_access' ? [30, 60, 90] : [3, 7, 14, 21, 30]).map((n) => <option key={n} value={n}>{n} days</option>)}</select>
            </Field>
          </div>
          <Field label="Message (optional)"><textarea className="input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything the subcontractor should know" /></Field>
          <FormError error={error} />
        </div>
      )}
    </Dialog>
  );
}

/** Internal upload on behalf of a subcontractor. */
export function UploadDialog({ open, onClose, subcontractorId, requirementId, requirements, documentId }: { open: boolean; onClose: () => void; subcontractorId: string; requirementId?: string; requirements: { id: string; name: string; kind: string }[]; documentId?: string }) {
  const [req, setReq] = useState(requirementId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);
  const abort = useRef<AbortController | null>(null);
  const toast = useToast();
  useEffect(() => { if (open) { setReq(requirementId ?? ''); setFile(null); setStage(null); setError(null); setDone(null); setProgress(0); } }, [open, requirementId]);
  const docReqs = requirements.filter((r) => r.kind === 'document');
  return (
    <Dialog open={open} onClose={() => { abort.current?.abort(); onClose(); }} title="Upload document" footer={done ? <button className="btn-primary" onClick={onClose}>Done</button> : <>
      <button className="btn-secondary" onClick={() => { abort.current?.abort(); onClose(); }}>Cancel</button>
      <button className="btn-primary" disabled={!file || (!req && !documentId) || !!stage} onClick={async () => {
        setError(null); abort.current = new AbortController();
        try {
          const r = await uploadDocument({ internal: { subcontractorId, documentId } }, file!, req || undefined, (s, p) => { setStage(s); setProgress(p); }, abort.current.signal);
          setDone(r); toast('Document uploaded and queued for review');
        } catch (e: any) { setError(e.message); } finally { setStage(null); }
      }}>{stage && <Spinner />}Upload</button>
    </>}>
      {done ? <Callout tone="ok" title="Uploaded">The file passed security checks and is waiting for review. It does not count toward compliance until a reviewer approves it.</Callout> : (
        <div className="space-y-4">
          {!documentId && <Field label="Requirement" required><select className="input" value={req} onChange={(e) => setReq(e.target.value)}><option value="">Choose…</option>{docReqs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>}
          <FileDrop file={file} onFile={setFile} disabled={!!stage} />
          {stage && <div><div className="flex justify-between text-xs text-muted mb-1"><span>{stage === 'preparing' ? 'Preparing…' : stage === 'uploading' ? `Uploading ${Math.round(progress * 100)}%` : 'Checking file and saving…'}</span></div><Progress value={stage === 'verifying' ? 1 : progress} /></div>}
          <FormError error={error} />
        </div>
      )}
    </Dialog>
  );
}

export function FileDrop({ file, onFile, disabled, large }: { file: File | null; onFile: (f: File | null) => void; disabled?: boolean; large?: boolean }) {
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
      className={cx('rounded-md border border-dashed text-center transition-colors', large ? 'p-8' : 'p-5', drag ? 'border-accent bg-accent/5' : 'border-line-strong', disabled && 'opacity-60')}>
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} disabled={disabled} aria-label="Choose file" />
      {file ? (
        <div className="flex items-center justify-center gap-3 text-sm"><span className="text-accent">{Icon.file('w-5 h-5')}</span><span className="truncate max-w-[16rem]">{file.name}</span><span className="text-faint">{(file.size / 1024 / 1024).toFixed(2)} MB</span>{!disabled && <button className="link" onClick={() => onFile(null)}>Change</button>}</div>
      ) : (
        <div>
          <button type="button" className={cx('btn-secondary', large && 'btn-lg')} onClick={() => input.current?.click()} disabled={disabled}>{Icon.upload()} Choose file</button>
          <p className="text-xs text-faint mt-2">PDF, JPEG or PNG, up to 15 MB{large ? '. You can also take a photo of the document.' : ''}</p>
        </div>
      )}
    </div>
  );
}

export async function openFile(versionId: string, download = false) {
  // Open the window synchronously so popup blockers allow it, then point it at the signed URL.
  const w = window.open('', '_blank');
  try {
    const r = await api('files.url', { versionId, download });
    if (w) w.location.href = r.url; else window.location.href = r.url;
  } catch (e: any) { w?.close(); throw e; }
}
