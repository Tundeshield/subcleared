import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { checkCriteria } from '../../domain/compliance';
import { formatDate, formatDateTime } from '../../domain/dates';
import { api, dataChanged, useApi } from '../../lib/api';
import { Callout, Checkbox, cx, Dialog, DocStatus, ErrorState, Field, FormError, humanize, PageHeader, PageLoading, Section, Segmented, Spinner, useToast, VerificationLabel } from '../../ui';
import { FilePreview } from './DocumentDetail';

type Decision = 'approve' | 'reject' | 'request_info';

export default function ReviewDetail() {
  const { versionId } = useParams();
  const { data, error, loading, reload } = useApi<any>('reviews.get', { versionId });
  const [meta, setMeta] = useState<any>({ values: {} });
  const [decision, setDecision] = useState<Decision>('approve');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [manual, setManual] = useState<Record<string, boolean | null>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lockErr, setLockErr] = useState<string | null>(null);
  const [verify, setVerify] = useState(false);
  const [rev, setRev] = useState<number | null>(null);
  const toast = useToast();
  const nav = useNavigate();
  const v = data?.version;
  const pending = v && ['awaiting_review', 'under_review', 'submitted'].includes(v.reviewStatus);
  useEffect(() => { if (v) setMeta({ ...v.metadata, values: { ...(v.metadata.values ?? {}) } }); }, [v?.id, v?.revision]); // eslint-disable-line
  // Claim the review so a colleague can't decide it at the same time.
  useEffect(() => {
    if (!v || !pending || !data.canReview) return;
    api('reviews.claim', { versionId: v.id }).then((r) => { setLockErr(null); setRev(r.revision ?? null); }).catch((e) => setLockErr(e.message));
    return () => { api('reviews.claim', { versionId: v.id, release: true }).catch(() => undefined); };
  }, [v?.id]); // eslint-disable-line
  const checks = useMemo(() => (data?.requirement ? checkCriteria(data.requirement.criteria, meta) : []), [data, meta]);
  if (loading && !data) return <PageLoading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const fields = v.extraction.fields ?? {};
  const proposed = Object.entries(fields).filter(([, f]: any) => f.value !== null && f.value !== undefined);
  const setM = (k: string, val: any) => setMeta((m: any) => ({ ...m, [k]: val }));
  const setV = (k: string, val: any) => setMeta((m: any) => ({ ...m, values: { ...m.values, [k]: val } }));
  const applyProposed = () => {
    const next = { ...meta, values: { ...meta.values } };
    for (const [k, f] of Object.entries(fields) as any) {
      if (f.value === null || f.value === undefined) continue;
      if (data.metadataFields.some((x: any) => x.key === k)) next[k] = String(f.value); else next.values[k] = f.value;
    }
    setMeta(next);
    toast('Proposed values copied into the form. Check each one before deciding.', 'info');
  };
  const failed = checks.filter((c) => c.passed === false);
  const missingExpiry = data.requirement?.expiryRequired && !meta.expiryDate;
  const expired = meta.expiryDate && meta.expiryDate < new Date().toISOString().slice(0, 10);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const values = Object.fromEntries(Object.entries(meta.values ?? {}).filter(([, x]) => x !== '' && x !== undefined && x !== null));
      await api('reviews.decide', {
        versionId: v.id, decision, reason: reason || undefined, internalComment: comment || undefined, revision: rev ?? v.revision,
        metadata: { ...meta, values }, checklist: [...checks.map((c) => ({ key: c.criterion.key, label: c.criterion.label, passed: c.passed })), ...Object.entries(manual).map(([k, p]) => ({ key: k, label: k, passed: p }))],
      });
      dataChanged();
      toast(decision === 'approve' ? 'Approved — readiness updated' : decision === 'reject' ? 'Rejected — the subcontractor has been told why' : 'Information requested');
      nav('/app/reviews');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const isInsurance = /insur|endorse/i.test(`${data.requirement?.category ?? ''} ${data.requirement?.documentType ?? ''}`);
  return (
    <div>
      <PageHeader eyebrow={<><Link to="/app/reviews" className="hover:text-ink">Reviews</Link> · <Link to={`/app/subcontractors/${data.subcontractor.id}`} className="hover:text-ink">{data.subcontractor.legalName}</Link></>}
        title={data.requirement?.name ?? data.document.title}
        description={<>v{v.versionNumber} · {v.fileName} · uploaded {formatDateTime(v.uploadedAt)} by {v.uploadedBy.name}</>}
        actions={<DocStatus value={v.reviewStatus} />} />
      {lockErr && <div className="mb-4"><Callout tone="warn" title="Someone else is reviewing this">{lockErr}. You can look, but only they can decide until their claim lapses (30 minutes of inactivity).</Callout></div>}
      <div className="grid xl:grid-cols-[1.35fr_1fr] gap-6 items-start">
        <div className="panel min-w-0 xl:sticky xl:top-20"><FilePreview versionId={v.id} mimeType={v.mimeType} /></div>
        <div className="space-y-5 min-w-0">
          {data.requirement && (
            <Section title="Requirement" description={`Version ${data.requirement.version}${data.requirement.reviewRequired ? '' : ' · review optional'}`}>
              <div className="p-4 text-sm space-y-2">
                <p className="text-muted">{data.requirement.description}</p>
                <ul className="space-y-1">
                  {data.requirement.expiryRequired && <li className={cx(missingExpiry ? 'text-bad' : 'text-ok')}>{missingExpiry ? '✕' : '✓'} Expiry date recorded{expired ? <span className="text-bad"> — already expired</span> : ''}</li>}
                  {checks.map((c) => <li key={c.criterion.key} className={c.passed === true ? 'text-ok' : c.passed === false ? 'text-bad' : 'text-muted'}>{c.passed === true ? '✓' : c.passed === false ? '✕' : '○'} {data.criteria.find((x: any) => x.key === c.criterion.key)?.description} <span className="text-faint">({c.detail})</span></li>)}
                </ul>
                {isInsurance && (
                  <div className="pt-2 border-t border-line space-y-1.5">
                    <div className="text-xs text-muted">Reviewer checks (recorded with your decision)</div>
                    {['Named insured matches the subcontractor', 'Insurer and policy number legible', 'Policy dates cover the work period', 'Endorsements present where required'].map((k) => (
                      <Checkbox key={k} checked={manual[k] === true} onChange={(x) => setManual({ ...manual, [k]: x ? true : null })} label={k} />
                    ))}
                    <p className="text-xs text-faint">A certificate of insurance is evidence of coverage, not proof. Approving records that it was reviewed against your stated requirements; it is not a legal coverage determination.</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {(v.extraction.status !== 'not_configured' || proposed.length > 0) && (
            <Section title="AI-proposed values" description={v.extraction.status === 'completed' ? `Proposed by ${v.extraction.model}. Nothing is official until you confirm it.` : v.extraction.status === 'failed' ? 'Extraction failed — enter values manually.' : 'Extraction in progress…'}
              actions={proposed.length > 0 && pending && <button className="btn-secondary btn-sm" onClick={applyProposed}>Use proposed values</button>}>
              <div className="p-4 text-sm">
                {v.extraction.status === 'failed' && <p className="text-warn">{v.extraction.error}</p>}
                {['queued', 'processing'].includes(v.extraction.status) && <button className="btn-ghost btn-sm" onClick={reload}><Spinner /> Refresh</button>}
                {proposed.length > 0 && <table className="w-full"><tbody>{proposed.map(([k, f]: any) => (
                  <tr key={k} className="border-t border-line/60"><td className="py-1.5 pr-3 text-muted">{[...data.metadataFields, ...data.valueFields].find((x: any) => x.key === k)?.label ?? k}</td><td className="py-1.5 pr-3">{String(f.value)}</td>
                    <td className={cx('py-1.5 text-xs tabular-nums', f.confidence < 0.7 ? 'text-warn' : 'text-faint')}>{Math.round(f.confidence * 100)}%{f.confidence < 0.7 && ' · check'}</td></tr>
                ))}</tbody></table>}
                {v.extraction.status === 'completed' && proposed.length === 0 && <p className="text-muted">No fields could be read. Enter them manually.</p>}
              </div>
            </Section>
          )}

          <Section title="Confirmed details" description="These become the official record when you decide.">
            <div className="p-4 grid sm:grid-cols-2 gap-3">
              {data.metadataFields.map((f: any) => (
                <Field key={f.key} label={f.label} required={f.key === 'expiryDate' && data.requirement?.expiryRequired}>
                  <input className={cx('input', fields[f.key] && fields[f.key].confidence < 0.7 && 'border-warn/50')} type={f.type === 'date' ? 'date' : 'text'} value={meta[f.key] ?? ''} onChange={(e) => setM(f.key, e.target.value)} disabled={!pending} />
                </Field>
              ))}
              {data.valueFields.map((f: any) => f.type === 'amount' ? (
                <Field key={f.key} label={f.label}><input className="input" inputMode="numeric" value={meta.values?.[f.key] ?? ''} onChange={(e) => setV(f.key, e.target.value.replace(/[^0-9.]/g, ''))} disabled={!pending} /></Field>
              ) : (
                <Field key={f.key} label={f.label}><select className="input" value={meta.values?.[f.key] === undefined ? '' : String(meta.values[f.key])} onChange={(e) => setV(f.key, e.target.value === '' ? undefined : e.target.value === 'true')} disabled={!pending}><option value="">Not recorded</option><option value="true">Yes — shown on document</option><option value="false">No</option></select></Field>
              ))}
            </div>
            {data.previous && <div className="px-4 pb-4 text-xs text-muted">Replacing v{data.previous.versionNumber} ({data.previous.fileName}), approved {formatDate(data.previous.review?.at)}, which expired/expires {formatDate(data.previous.metadata.expiryDate) || 'never'}{data.previous.metadata.referenceNumber ? `, ref ${data.previous.metadata.referenceNumber}` : ''}.</div>}
          </Section>

          {pending && data.canReview ? (
            <Section title="Decision">
              <div className="p-4 space-y-4">
                <Segmented value={decision} onChange={setDecision} options={[{ value: 'approve', label: 'Approve' }, { value: 'reject', label: 'Reject' }, { value: 'request_info', label: 'Request info' }]} />
                {decision === 'approve' && (failed.length > 0 || missingExpiry) && <Callout tone="bad">{missingExpiry ? 'An expiry date is required to approve. ' : ''}{failed.length ? `Fails: ${failed.map((f) => f.criterion.label).join(', ')}. Correct the values or reject.` : ''}</Callout>}
                {decision === 'approve' && expired && <Callout tone="warn">This document has already expired. Approving records it, but the subcontractor stays not ready for this requirement.</Callout>}
                {decision !== 'approve' && <Field label="Reason for the subcontractor" required hint="Sent to the subcontractor with a link to upload a replacement."><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={decision === 'reject' ? 'e.g. The named insured is a different company' : 'e.g. Please send the page showing the additional insured endorsement'} /></Field>}
                <Field label="Internal comment" hint="Only visible to your organisation."><textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
                <FormError error={err} />
                <button className="btn-primary w-full btn-lg" disabled={busy || !!lockErr || (decision !== 'approve' && !reason.trim()) || (decision === 'approve' && (failed.length > 0 || missingExpiry))} onClick={submit}>
                  {busy && <Spinner />}{decision === 'approve' ? 'Approve document' : decision === 'reject' ? 'Reject and notify' : 'Request information'}
                </button>
              </div>
            </Section>
          ) : (
            <Section title="Outcome"><div className="p-4 text-sm space-y-2">
              {v.review ? <><div><span className="font-medium">{humanize(v.review.decision)}</span> by {v.review.reviewerName} · {formatDateTime(v.review.at)}</div>{v.review.reason && <div className="text-muted">Reason: {v.review.reason}</div>}</> : <div className="text-muted">{humanize(v.reviewStatus)}</div>}
              <VerificationLabel value={v.verification} />
              {data.verifications.map((x: any) => <div key={x.id} className="text-xs text-muted">Verified via {humanize(x.method)} with {x.source} (ref {x.reference}) by {x.verifiedBy.name}</div>)}
              {v.reviewStatus === 'approved' && data.canVerify && v.verification !== 'independently_verified' && <button className="btn-secondary btn-sm" onClick={() => setVerify(true)}>Record independent verification</button>}
            </div></Section>
          )}
          {data.reviews.length > 0 && <Section title="Comments and decisions"><ul className="divide-y divide-line">{data.reviews.map((r: any) => <li key={r.id} className="px-4 py-2.5 text-sm"><span className="font-medium">{humanize(r.decision)}</span> · {r.reviewerName} <span className="text-xs text-faint">{formatDateTime(r.at)}</span>{r.reason && <div className="text-muted">{r.reason}</div>}{r.internalComment && <div className="text-muted">Internal: {r.internalComment}</div>}</li>)}</ul></Section>}
        </div>
      </div>
      {verify && <VerifyDialog versionId={v.id} onClose={() => { setVerify(false); reload(); }} />}
    </div>
  );
}

function VerifyDialog({ versionId, onClose }: { versionId: string; onClose: () => void }) {
  const [f, setF] = useState({ method: 'broker_confirmation', source: '', reference: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose} title="Record independent verification" description="Only record this when you have confirmed the document with an authorised source — for example the broker, the insurer or the licensing register." footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={busy || !f.source.trim() || !f.reference.trim()} onClick={async () => { setBusy(true); setErr(null); try { await api('reviews.verify', { versionId, ...f }); dataChanged(); onClose(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}>{busy && <Spinner />}Record verification</button>
    </>}>
      <div className="space-y-4">
        <Field label="How was it verified?"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="broker_confirmation">Confirmed by the broker</option><option value="insurer_confirmation">Confirmed by the insurer</option><option value="register_lookup">Checked on an official register</option><option value="other">Other authorised source</option></select></Field>
        <Field label="Who confirmed it" required><input className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="e.g. Jane Doe, Acme Brokers / register URL" /></Field>
        <Field label="Confirmation reference" required><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Email date, call reference, register entry number" /></Field>
        <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <FormError error={err} />
      </div>
    </Dialog>
  );
}
