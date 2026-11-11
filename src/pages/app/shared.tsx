import { useEffect, useRef, useState } from 'react';
import { READINESS_LABELS } from '../../domain/compliance';
import { addDays } from '../../domain/dates';
import { api, useApi, useMutation } from '../../lib/api';
import { ACCEPT, uploadDocument } from '../../lib/upload';
import { Callout, Checkbox, cx, Dialog, Field, FormError, Glyph, humanize, Icon, Progress, Spinner, useToast } from '../../ui';

/** Plain-language line for an audit event. */
export function activityLine(e: any): string {
  const who = e.actor.name.replace(/ \(.+\)$/, '');
  const what = e.entity.label ?? '';
  const map: Record<string, string> = {
    'document.uploaded': `submitted ${what}`, 'document.replaced': `submitted a new version of ${what}`, 'document.approved': `approved ${what}`, 'document.rejected': `rejected ${what}`,
    'document.info_requested': `asked for more information on ${what}`, 'document.archived': `archived ${what}`, 'document.restored': `restored ${what}`, 'document.viewed': `viewed ${what}`, 'document.downloaded': `downloaded ${what}`,
    'document.upload_blocked': `had an upload blocked by security checks (${what})`, 'document.metadata_corrected': `corrected the details of ${what}`, 'document.independently_verified': `recorded independent verification of ${what}`,
    'request.sent': `requested documents from ${what.split(' — ')[1] ?? what}`, 'request.portal_invited': `invited ${what.split(' — ')[1] ?? what} to the portal`, 'request.link_revoked': `revoked the upload link for ${what}`,
    'subcontractor.created': `added ${what}`, 'subcontractor.updated': `updated ${what}`, 'subcontractor.imported': 'imported subcontractors', 'subcontractor.suspended': `suspended ${what}`, 'subcontractor.archived': `archived ${what}`,
    'subcontractor.restored': `restored ${what}`, 'subcontractor.note_added': `added a note to ${what}`, 'subcontractor.status_changed': `changed the status of ${what}`, 'subcontractor.contact_self_updated': 'updated their contact details',
    'project.created': `created ${what}`, 'project.updated': `updated ${what}`, 'project.template_applied': `applied a template to ${what}`, 'project.subcontractor_assigned': `assigned ${what.replace(' → ', ' to ')}`,
    'project.subcontractor_removed': 'removed a subcontractor from the project', 'project.requirement_added': 'added a project requirement', 'project.requirement_changed': 'changed a project requirement', 'project.requirement_removed': 'removed a project requirement',
    'project.archived': `archived ${what}`, 'project.restored': `restored ${what}`, 'requirement.created': `created the requirement ${what}`, 'requirement.changed': `updated the requirement ${what}`,
    'requirement.marked_not_applicable': `marked a requirement not applicable for ${what}`, 'requirement.manually_confirmed': `recorded a confirmation for ${what}`, 'template.created': `created the template ${what}`, 'template.changed': `updated the template ${what}`,
    'requirement.decision_revoked': 'revoked a requirement decision', 'portal.link_opened': 'opened their upload link', 'notification.renewal_reminder': `sent a renewal reminder for ${what}`,
    'member.joined': 'joined the team', 'member.invited': `invited ${what}`, 'organisation.sample_loaded': 'loaded sample data', 'organisation.sample_removed': 'removed sample data',
  };
  if (e.action === 'compliance.status_changed') return `${what}: ${(READINESS_LABELS as any)[e.before?.readiness]?.toLowerCase() ?? 'new'} → ${(READINESS_LABELS as any)[e.after?.readiness]?.toLowerCase() ?? 'updated'}`;
  return `${who} ${map[e.action] ?? humanize(e.action.split('.').slice(1).join(' ')).toLowerCase()}`;
}

/** Request documents from a subcontractor's contacts via secure, expiring links. */
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
    <Dialog open={open} onClose={onClose} width="max-w-2xl" title={type === 'portal_access' ? 'Invite to the subcontractor portal' : 'Request documents'} description={d ? `${d.subcontractor.legalName}${projectId ? ` · ${d.projects.find((p: any) => p.id === projectId)?.name ?? ''}` : ''}` : undefined}
      footer={result ? <button className="btn-primary" onClick={onClose}>Done</button> : <>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !contacts.length || (type === 'request' && !reqs.length)} onClick={async () => {
          try {
            const r = await run({ subcontractorId, type, contactIds: contacts, requirementIds: type === 'request' ? reqs : [], projectIds: projectId ? [projectId] : [], dueDate: type === 'request' ? due || undefined : undefined, expiresInDays: days, message: message || undefined });
            setResult(r.results);
            toast(type === 'request' ? 'Request sent' : 'Invitation sent');
          } catch { /* shown */ }
        }}>{busy && <Spinner />}{type === 'request' ? 'Send request' : 'Send invitation'}</button>
      </>}>
      {!d ? <Spinner /> : result ? (
        <div className="space-y-4">
          {result.map((r) => (
            <div key={r.requestId} className="border-t border-line pt-4">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{r.contact}</span>
                <span className="text-sm flex items-center gap-1.5">{r.emailStatus === 'failed' ? <><Glyph tone="blocked" className="w-3.5 h-3.5" />Email not sent: {r.emailError}</> : <><Glyph tone="ok" className="w-3.5 h-3.5" />{r.emailStatus === 'dev_logged' ? 'Email captured (dev mailbox)' : 'Email sent'}</>}</span></div>
              <div className="mt-2 flex gap-2"><input className="input h-9 text-xs font-mono" readOnly value={r.url} onFocus={(e) => e.target.select()} aria-label="Secure link" /><button className="btn-secondary btn-sm h-9" onClick={() => navigator.clipboard.writeText(r.url).then(() => toast('Link copied'))}>Copy</button></div>
              <p className="hint">Only works for {r.contact}. Expires {new Date(r.expiresAt).toLocaleDateString()}. Revoke it any time from the subcontractor's Activity tab.</p>
            </div>
          ))}
        </div>
      ) : d.subcontractor.contacts.length === 0 ? (
        <Callout tone="warn" title="No contacts yet">Add a contact with an email address to this subcontractor first.</Callout>
      ) : (
        <div className="space-y-6">
          <fieldset><legend className="label">Send to</legend><div className="space-y-2.5">
            {d.subcontractor.contacts.map((c: any) => <Checkbox key={c.id} checked={contacts.includes(c.id)} onChange={(v) => setContacts(v ? [...contacts, c.id] : contacts.filter((x) => x !== c.id))} label={<>{c.name} <span className="text-muted">{c.email}</span></>} hint={c.roles?.map(humanize).join(', ')} />)}
          </div><p className="hint">Each contact gets their own link, so access can be withdrawn individually.</p></fieldset>
          {type === 'request' && (
            <fieldset><legend className="label">Documents to request</legend>
              {applicable.length === 0 ? <p className="text-sm text-muted">No document requirements apply yet. Assign this subcontractor to a project with requirements first.</p> : (
                <div className="grid sm:grid-cols-2 gap-2.5">{applicable.map((r: any) => <Checkbox key={r.id} checked={reqs.includes(r.id)} onChange={(v) => setReqs(v ? [...reqs, r.id] : reqs.filter((x) => x !== r.id))} label={r.name} />)}</div>
              )}
            </fieldset>
          )}
          <div className="grid sm:grid-cols-2 gap-5">
            {type === 'request' && <Field label="Due date" optional><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>}
            <Field label="Link expires after" hint={type === 'portal_access' ? 'Contacts confirm their email with a one-time code.' : undefined}>
              <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>{(type === 'portal_access' ? [30, 60, 90] : [3, 7, 14, 21, 30]).map((n) => <option key={n} value={n}>{n} days</option>)}</select>
            </Field>
          </div>
          <Field label="Message" optional><textarea className="input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Anything the subcontractor should know" /></Field>
          <FormError error={error} />
        </div>
      )}
    </Dialog>
  );
}

/** Upload a document on a subcontractor's behalf. */
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
    <Dialog open={open} onClose={() => { abort.current?.abort(); onClose(); }} title={documentId ? 'Upload a new version' : 'Upload a document'} footer={done ? <button className="btn-primary" onClick={onClose}>Done</button> : <>
      <button className="btn-secondary" onClick={() => { abort.current?.abort(); onClose(); }}>Cancel</button>
      <button className="btn-primary" disabled={!file || (!req && !documentId) || !!stage} onClick={async () => {
        setError(null); abort.current = new AbortController();
        try {
          const r = await uploadDocument({ internal: { subcontractorId, documentId } }, file!, req || undefined, (s, p) => { setStage(s); setProgress(p); }, abort.current.signal);
          setDone(r); toast('Uploaded — waiting for review');
        } catch (e: any) { setError(e.message); } finally { setStage(null); }
      }}>{stage && <Spinner />}Upload</button>
    </>}>
      {done ? <Callout tone="ok" title="Uploaded">The file passed security checks and is waiting for review. It won't count toward readiness until a reviewer approves it.</Callout> : (
        <div className="space-y-5">
          {!documentId && <Field label="Requirement" required><select className="input" value={req} onChange={(e) => setReq(e.target.value)}><option value="">Choose a requirement…</option>{docReqs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>}
          <FileDrop file={file} onFile={setFile} disabled={!!stage} />
          {stage && <div><div className="text-sm text-muted mb-1.5">{stage === 'preparing' ? 'Preparing…' : stage === 'uploading' ? `Uploading ${Math.round(progress * 100)}%` : 'Checking the file and saving…'}</div><Progress value={stage === 'verifying' ? 1 : progress} /></div>}
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
      className={cx('rounded-md border border-dashed transition-colors', large ? 'p-8' : 'p-6', drag ? 'border-field bg-field/[0.05]' : 'border-line-strong', disabled && 'opacity-60')}>
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} disabled={disabled} aria-label="Choose file" />
      {file ? (
        <div className="flex items-center gap-3"><span className="text-field">{Icon.file('w-5 h-5')}</span><span className="truncate flex-1">{file.name}</span><span className="text-sm text-faint tnum">{(file.size / 1024 / 1024).toFixed(2)} MB</span>{!disabled && <button className="btn-quiet" onClick={() => onFile(null)}>Change</button>}</div>
      ) : (
        <div className="text-center">
          <button type="button" className="btn-secondary" onClick={() => input.current?.click()} disabled={disabled}>{Icon.upload()} Choose a file</button>
          <p className="text-sm text-faint mt-2.5">or drag it here · PDF, JPEG or PNG up to 15 MB</p>
        </div>
      )}
    </div>
  );
}

export async function openFile(versionId: string, download = false) {
  // Open the window synchronously so popup blockers allow it, then point it at the short-lived signed URL.
  const w = window.open('', '_blank');
  try {
    const r = await api('files.url', { versionId, download });
    if (w) w.location.href = r.url; else window.location.href = r.url;
  } catch (e: any) { w?.close(); throw e; }
}
