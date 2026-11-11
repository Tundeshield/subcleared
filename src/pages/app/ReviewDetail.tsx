import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { checkCriteria } from '../../domain/compliance';
import { formatDate, formatDateTime } from '../../domain/dates';
import { term } from '../../domain/locale';
import { api, dataChanged, useApi } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Callout, Checkbox, cx, Dialog, DocStatus, ErrorState, Field, FormError, Glyph, humanize, PageHeader, PageLoading, Segmented, Spinner, useToast, VerificationLabel } from '../../ui';
import { FilePreview } from './DocumentDetail';

type Decision = 'approve' | 'reject' | 'request_info';

export default function ReviewDetail() {
  const { versionId } = useParams();
  const { me } = useSession();
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
  useEffect(() => { if (v) setMeta({ ...v.metadata, values: { ...(v.metadata.values ?? {}) } }); }, [v?.id]); // eslint-disable-line
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
    toast('Proposed values copied in. Check each one against the document before deciding.', 'info');
  };
  const failed = checks.filter((c) => c.passed === false);
  const missingExpiry = data.requirement?.expiryRequired && !meta.expiryDate;
  const expired = meta.expiryDate && meta.expiryDate < new Date().toISOString().slice(0, 10);
  const isInsurance = /insur|endorse|indemnity/i.test(`${data.requirement?.category ?? ''} ${data.requirement?.name ?? ''}`);
  const market = me?.org?.settings.market;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const values = Object.fromEntries(Object.entries(meta.values ?? {}).filter(([, x]) => x !== '' && x !== undefined && x !== null));
      await api('reviews.decide', {
        versionId: v.id, decision, reason: reason || undefined, internalComment: comment || undefined, revision: rev ?? v.revision,
        metadata: { ...meta, values }, checklist: [...checks.map((c) => ({ key: c.criterion.key, label: c.criterion.label, passed: c.passed })), ...Object.entries(manual).map(([k, p]) => ({ key: k, label: k, passed: p }))],
      });
      dataChanged();
      toast(decision === 'approve' ? 'Approved — readiness updated' : decision === 'reject' ? 'Rejected — the subcontractor has been told why' : 'More information requested');
      nav('/app/reviews');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const blockedApprove = decision === 'approve' && (failed.length > 0 || missingExpiry);
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Reviews', to: '/app/reviews' }, { label: data.subcontractor.legalName, to: `/app/subcontractors/${data.subcontractor.id}` }, { label: data.requirement?.name ?? data.document.title }]}
        title={data.requirement?.name ?? data.document.title}
        meta={<><span>{data.subcontractor.legalName}</span><span>Version {v.versionNumber} · {v.fileName}</span><span>Submitted {formatDateTime(v.uploadedAt)} by {v.uploadedBy.name.replace(/ \(.+\)$/, '')}</span></>}
        actions={<DocStatus value={v.reviewStatus} />} />
      {lockErr && <div className="mb-6"><Callout tone="warn" title="Someone else is reviewing this">{lockErr}. You can look, but only they can decide until their claim lapses after 30 minutes of inactivity.</Callout></div>}
      <div className="grid xl:grid-cols-[1.3fr_1fr] gap-x-10 gap-y-8 items-start">
        <div className="min-w-0 xl:sticky xl:top-24 border border-line rounded-md overflow-hidden bg-paper"><FilePreview versionId={v.id} mimeType={v.mimeType} className="h-[78vh]" /></div>
        <div className="space-y-10 min-w-0">
          {data.requirement && (
            <section>
              <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Against the requirement <span className="text-sm text-faint font-normal">version {data.requirement.version}</span></h2>
              <p className="text-muted mt-3">{data.requirement.description}</p>
              <ul className="mt-4 space-y-2.5">
                {data.requirement.expiryRequired && <li className="flex gap-2.5 items-start"><Glyph tone={missingExpiry ? 'blocked' : expired ? 'attention' : 'ok'} className="w-4 h-4 mt-0.5" /><span>Expiry date recorded{expired ? ' — already expired' : ''}</span></li>}
                {checks.map((c) => <li key={c.criterion.key} className="flex gap-2.5 items-start"><Glyph tone={c.passed === true ? 'ok' : c.passed === false ? 'blocked' : 'none'} className="w-4 h-4 mt-0.5" /><span>{data.criteria.find((x: any) => x.key === c.criterion.key)?.description} <span className="text-faint">({c.detail})</span></span></li>)}
                {!data.requirement.expiryRequired && checks.length === 0 && <li className="text-muted">No structured checks — compare the document with the description above.</li>}
              </ul>
              {isInsurance && pending && (
                <div className="mt-6 space-y-2.5">
                  <div className="text-sm font-medium">Reviewer checks</div>
                  {['Named insured matches the subcontractor', `${market === 'US' ? 'Carrier' : 'Insurer'} and policy number are legible`, 'Policy dates cover the work period', 'Endorsements are present where required'].map((k) => (
                    <Checkbox key={k} checked={manual[k] === true} onChange={(x) => setManual({ ...manual, [k]: x ? true : null })} label={k} />
                  ))}
                  <p className="text-xs text-faint leading-relaxed pt-1">A {term(market, 'coi')} is evidence of cover, not proof of it. Approving records that it was reviewed against your stated requirements — not a legal coverage determination.</p>
                </div>
              )}
            </section>
          )}

          {(v.extraction.status !== 'not_configured' || proposed.length > 0) && (
            <section>
              <div className="flex items-end justify-between gap-3 pb-3 border-b border-line-strong">
                <div><h2 className="text-lg font-semibold">Extracted from the document</h2><p className="text-sm text-muted mt-0.5">{v.extraction.status === 'completed' ? `Read automatically by ${v.extraction.model}. Nothing becomes official until you confirm it.` : v.extraction.status === 'failed' ? 'The document couldn’t be read automatically — enter the details below.' : 'Reading the document…'}</p></div>
                {proposed.length > 0 && pending && <button className="btn-secondary btn-sm" onClick={applyProposed}>Use these values</button>}
              </div>
              {['queued', 'processing'].includes(v.extraction.status) && <button className="btn-ghost btn-sm mt-3" onClick={reload}><Spinner /> Check again</button>}
              {proposed.length > 0 && <table className="w-full mt-2"><tbody>{proposed.map(([k, f]: any) => (
                <tr key={k} className="border-b border-line"><td className="py-2.5 pr-3 text-muted text-sm">{[...data.metadataFields, ...data.valueFields].find((x: any) => x.key === k)?.label ?? k}</td><td className="py-2.5 pr-3">{String(f.value)}</td>
                  <td className="py-2.5 text-sm tnum text-right whitespace-nowrap">{f.confidence < 0.7 ? <span className="inline-flex items-center gap-1.5 font-medium"><Glyph tone="attention" className="w-3.5 h-3.5" />{Math.round(f.confidence * 100)}% · check</span> : <span className="text-faint">{Math.round(f.confidence * 100)}%</span>}</td></tr>
              ))}</tbody></table>}
              {v.extraction.status === 'completed' && proposed.length === 0 && <p className="text-muted mt-3">No details could be read. Enter them manually.</p>}
            </section>
          )}

          <section>
            <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Confirmed details</h2>
            <p className="text-sm text-muted mt-3">These become the official record when you decide.</p>
            <div className="mt-5 grid sm:grid-cols-2 gap-x-5 gap-y-4">
              {data.metadataFields.map((f: any) => (
                <Field key={f.key} label={f.label} required={f.key === 'expiryDate' && data.requirement?.expiryRequired}>
                  <input className={cx('input', fields[f.key] && fields[f.key].confidence < 0.7 && 'border-ink')} type={f.type === 'date' ? 'date' : 'text'} value={meta[f.key] ?? ''} onChange={(e) => setM(f.key, e.target.value)} disabled={!pending} />
                </Field>
              ))}
              {data.valueFields.map((f: any) => f.type === 'amount' ? (
                <Field key={f.key} label={f.label}><input className="input" inputMode="numeric" value={meta.values?.[f.key] ?? ''} onChange={(e) => setV(f.key, e.target.value.replace(/[^0-9.]/g, ''))} disabled={!pending} /></Field>
              ) : (
                <Field key={f.key} label={f.label}><select className="input" value={meta.values?.[f.key] === undefined ? '' : String(meta.values[f.key])} onChange={(e) => setV(f.key, e.target.value === '' ? undefined : e.target.value === 'true')} disabled={!pending}><option value="">Not recorded</option><option value="true">Shown on the document</option><option value="false">Not shown</option></select></Field>
              ))}
            </div>
            {data.previous && <p className="text-sm text-muted mt-5">Replaces version {data.previous.versionNumber}, approved {formatDate(data.previous.review?.at)}{data.previous.metadata.expiryDate ? `, which expires ${formatDate(data.previous.metadata.expiryDate)}` : ''}{data.previous.metadata.referenceNumber ? ` (reference ${data.previous.metadata.referenceNumber})` : ''}.</p>}
          </section>

          {pending && data.canReview ? (
            <section className="border-t border-line-strong pt-6">
              <h2 className="text-lg font-semibold">Decision</h2>
              <div className="mt-4 space-y-5">
                <Segmented label="Decision" value={decision} onChange={setDecision} options={[{ value: 'approve', label: 'Approve' }, { value: 'reject', label: 'Reject' }, { value: 'request_info', label: 'Ask for more' }]} />
                {blockedApprove && <Callout tone="bad">{missingExpiry ? 'Record the expiry date to approve. ' : ''}{failed.length ? `Doesn't meet: ${failed.map((f) => f.criterion.label).join(', ')}. Correct the values if they were entered wrongly, or reject.` : ''}</Callout>}
                {decision === 'approve' && expired && <Callout tone="warn">This document has already expired. You can record it, but the subcontractor stays not ready for this requirement until a current one arrives.</Callout>}
                {decision !== 'approve' && <Field label="What the subcontractor needs to do" required hint="Sent to them with a link to upload a replacement."><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={decision === 'reject' ? 'e.g. The named insured is a different company' : 'e.g. Please also send the additional insured endorsement page'} /></Field>}
                <Field label="Internal note" optional hint="Only visible to your team."><textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
                <FormError error={err} />
                <button className="btn-primary btn-lg w-full" disabled={busy || !!lockErr || (decision !== 'approve' && !reason.trim()) || blockedApprove} onClick={submit}>
                  {busy && <Spinner />}{decision === 'approve' ? 'Approve document' : decision === 'reject' ? 'Reject and let them know' : 'Ask for more information'}
                </button>
              </div>
            </section>
          ) : (
            <section className="border-t border-line-strong pt-6">
              <h2 className="text-lg font-semibold">Outcome</h2>
              <div className="mt-3 space-y-2">
                {v.review ? <p><span className="font-medium">{humanize(v.review.decision)}</span> by {v.review.reviewerName}, {formatDateTime(v.review.at)}</p> : <p className="text-muted">{humanize(v.reviewStatus)}</p>}
                {v.review?.reason && <p className="text-muted">Reason: {v.review.reason}</p>}
                <VerificationLabel value={v.verification} />
                {data.verifications.map((x: any) => <p key={x.id} className="text-sm text-muted">Verified via {humanize(x.method).toLowerCase()} with {x.source} (reference {x.reference}) by {x.verifiedBy.name}.</p>)}
                {v.reviewStatus === 'approved' && data.canVerify && v.verification !== 'independently_verified' && <button className="btn-secondary btn-sm mt-2" onClick={() => setVerify(true)}>Record independent verification</button>}
              </div>
            </section>
          )}
          {data.reviews.length > 0 && <section><h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Earlier decisions and notes</h2><ul>{data.reviews.map((r: any) => <li key={r.id} className="py-3 border-b border-line"><span className="font-medium">{humanize(r.decision)}</span> · {r.reviewerName} <span className="text-xs text-faint">{formatDateTime(r.at)}</span>{r.reason && <div className="text-sm text-muted">{r.reason}</div>}{r.internalComment && <div className="text-sm text-muted">Internal: {r.internalComment}</div>}</li>)}</ul></section>}
        </div>
      </div>
      {verify && <VerifyDialog versionId={v.id} market={market} onClose={() => { setVerify(false); reload(); }} />}
    </div>
  );
}

function VerifyDialog({ versionId, market, onClose }: { versionId: string; market?: any; onClose: () => void }) {
  const [f, setF] = useState({ method: 'broker_confirmation', source: '', reference: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open onClose={onClose} title="Record independent verification" description={`Only record this once you've confirmed the document with an authorised source — the broker, the ${market === 'US' ? 'carrier' : 'insurer'} or the official register.`} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={busy || !f.source.trim() || !f.reference.trim()} onClick={async () => { setBusy(true); setErr(null); try { await api('reviews.verify', { versionId, ...f }); dataChanged(); onClose(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }}>{busy && <Spinner />}Record verification</button>
    </>}>
      <div className="space-y-5">
        <Field label="How was it verified?"><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="broker_confirmation">Confirmed by the broker</option><option value="insurer_confirmation">Confirmed by the {market === 'US' ? 'carrier' : 'insurer'}</option><option value="register_lookup">Checked on an official register</option><option value="other">Another authorised source</option></select></Field>
        <Field label="Who confirmed it" required><input className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="Name and organisation, or the register's address" /></Field>
        <Field label="Confirmation reference" required><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Email date, call reference or register entry" /></Field>
        <Field label="Notes" optional><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <FormError error={err} />
      </div>
    </Dialog>
  );
}
