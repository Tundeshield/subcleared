import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../../domain/dates';
import { api, dataChanged, useApi } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Callout, ErrorState, Field, Glyph, PageHeader, Skeleton, Spinner, useToast } from '../../ui';

/** Emailed documents SubCleared couldn't match with confidence. Everything else is attached automatically. */
export default function Inbox() {
  const { data, error, loading, reload } = useApi<any>('intake.list', { all: true });
  if (loading && !data) return <Skeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const waiting = data.items.filter((i: any) => i.status === 'needs_match');
  const processing = data.items.filter((i: any) => i.status === 'processing');
  return (
    <div className="max-w-3xl">
      <PageHeader title="Emailed documents" description="Documents sent to your intake address. SubCleared attaches them itself when it’s sure who sent them and what they are; anything less certain waits here for you." />
      <IntakeAddress data={data} onChange={reload} />
      {processing.length > 0 && <p className="mt-6 text-sm text-muted flex items-center gap-2"><Spinner /> Reading {processing.length} new attachment{processing.length === 1 ? '' : 's'}…</p>}
      <section className="mt-8">
        <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Waiting for you</h2>
        {waiting.length === 0 ? <p className="text-muted mt-4">Nothing to match. New attachments that can’t be matched automatically will appear here.</p> : (
          <ul>{waiting.map((i: any) => <Item key={i.id} item={i} data={data} onDone={() => { reload(); dataChanged(); }} />)}</ul>
        )}
      </section>
      {data.failed?.length > 0 && (
        <section className="mt-8"><Callout tone="warn" title={`${data.failed.length} email${data.failed.length === 1 ? '' : 's'} couldn’t be processed yet`}>
          {data.failed.map((f: any) => <div key={f.id}>From {f.from}{f.subject ? ` (“${f.subject}”)` : ''} — {f.attempts >= 3 ? 'tried three times; ask the sender to upload through their link' : 'SubCleared will try again automatically within the hour'}.</div>)}
        </Callout></section>
      )}
      {data.empty?.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Emails with nothing to file</h2>
          <p className="text-sm text-muted mt-3">These arrived without a PDF or image attached. Replies to requests also reach the person who sent the request.</p>
          <ul>{data.empty.map((m: any) => (
            <li key={m.id} className="py-3 border-b border-line text-sm"><div className="font-medium">{m.subject || '(no subject)'}</div><div className="text-muted">From {m.fromName ? `${m.fromName} <${m.from}>` : m.from} · {formatDateTime(m.receivedAt)}</div>{m.text && <div className="text-faint mt-1 line-clamp-2">{m.text}</div>}</li>
          ))}</ul>
        </section>
      )}
      {data.recent.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Recently handled</h2>
          <ul>{data.recent.map((r: any) => (
            <li key={r.id} className="py-3 border-b border-line flex gap-3 items-start text-sm">
              <Glyph tone={r.status === 'attached' ? 'ok' : r.status === 'rejected' ? 'blocked' : 'none'} className="w-3.5 h-3.5 mt-1 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium break-words">{r.fileName}</div>
                <div className="text-muted">
                  {r.status === 'attached' && <>Attached to <Link className="link" to={`/app/reviews/${r.attached.versionId}`}>{r.attached.subcontractorName} · {r.attached.requirementName}</Link>{r.attached.automatic ? ' automatically' : ` by ${r.attached.by}`}</>}
                  {r.status === 'duplicate' && 'Already on file (identical copy), so nothing was added'}
                  {r.status === 'rejected' && `Not accepted: ${r.rejectedReason}`}
                </div>
                <div className="text-xs text-faint mt-0.5">From {r.from} · {formatDateTime(r.receivedAt)}</div>
              </div>
            </li>
          ))}</ul>
        </section>
      )}
    </div>
  );
}

function IntakeAddress({ data, onChange }: { data: any; onChange: () => void }) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!data.configured) return <div className="mt-6"><Callout tone="info" title="Email intake isn’t connected yet">Emailed documents arrive through Resend. Receiving needs to be switched on for this deployment before documents can be emailed in. Until then, subcontractors upload through their secure links.</Callout></div>;
  if (!data.address) {
    return (
      <div className="mt-6 rounded-lg border border-line p-5">
        <div className="font-medium">Get an address for emailed documents</div>
        <p className="text-muted mt-1">Subcontractors and brokers can email certificates to it, or you can forward them. Attachments are scanned, read and filed against the right subcontractor.</p>
        {can('settings.manage') ? <button className="btn-primary mt-4" disabled={busy} onClick={async () => { setBusy(true); try { await api('intake.setup', {}); onChange(); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } }}>{busy && <Spinner />}Create address</button> : <p className="text-sm text-faint mt-3">Ask an administrator to set this up.</p>}
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-lg border border-line p-5">
      <div className="text-sm text-muted">Your intake address</div>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <code className="font-mono text-[0.9375rem] break-all">{data.address}</code>
        <button className="btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(data.address); toast('Address copied'); }}>Copy</button>
      </div>
      <p className="text-sm text-faint mt-2">Share it with subcontractors and brokers, or forward emails to it. Only PDF, JPG and PNG attachments are kept.{!data.readingOn ? ' Automatic reading is off, so matching uses the sender’s address only.' : ''}</p>
    </div>
  );
}

function Item({ item, data, onDone }: { item: any; data: any; onDone: () => void }) {
  const [sub, setSub] = useState(item.suggestion?.subcontractorId ?? '');
  const [req, setReq] = useState(item.suggestion?.requirementId ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const run = async (discard: boolean) => {
    setBusy(discard ? 'discard' : 'attach');
    try {
      await api('intake.resolve', discard ? { intakeId: item.id, discard: true } : { intakeId: item.id, subcontractorId: sub, requirementId: req });
      toast(discard ? 'Discarded' : 'Attached — it’s now waiting for review'); onDone();
    } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(null); }
  };
  const fields = item.extraction?.fields ?? {};
  return (
    <li className="py-5 border-b border-line">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium break-words">{item.fileName}</div>
          <div className="text-sm text-muted">From {item.fromName ? `${item.fromName} <${item.from}>` : item.from}{item.subject ? ` · “${item.subject}”` : ''}</div>
          <div className="text-xs text-faint mt-0.5">{formatDateTime(item.receivedAt)}</div>
        </div>
        <button className="btn-secondary btn-sm" onClick={async () => { const r = await api<any>('intake.fileUrl', { intakeId: item.id }); window.open(r.url, '_blank', 'noopener'); }}>Open file</button>
      </div>
      {(fields.namedInsured?.value || fields.expiryDate?.value) && <p className="text-sm mt-3">Reads as {[fields.namedInsured?.value && `“${fields.namedInsured.value}”`, fields.expiryDate?.value && `expiring ${fields.expiryDate.value}`].filter(Boolean).join(', ')}.</p>}
      {item.suggestion?.reasons?.length > 0 && <ul className="text-sm text-muted mt-2 space-y-0.5">{item.suggestion.reasons.map((r: string) => <li key={r}>• {r}</li>)}</ul>}
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <Field label="Subcontractor"><select className="input" value={sub} onChange={(e) => setSub(e.target.value)}><option value="">Choose…</option>{data.subcontractors.map((s: any) => <option key={s.id} value={s.id}>{s.legalName}</option>)}</select></Field>
        <Field label="Which document is it?"><select className="input" value={req} onChange={(e) => setReq(e.target.value)}><option value="">Choose…</option>{data.requirements.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
      </div>
      <div className="mt-4 flex gap-2">
        <button className="btn-primary btn-sm" disabled={!sub || !req || !!busy} onClick={() => run(false)}>{busy === 'attach' && <Spinner />}Attach</button>
        <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => run(true)}>{busy === 'discard' && <Spinner />}Not a document we need</button>
      </div>
    </li>
  );
}

