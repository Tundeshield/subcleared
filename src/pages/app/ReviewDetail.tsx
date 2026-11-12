import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { insuranceEyeChecks, TRUST } from '../../domain/assessment';
import { checkCriteria } from '../../domain/compliance';
import { fieldLabel } from '../../domain/extraction';
import { formatDate, formatDateTime } from '../../domain/dates';
import { term } from '../../domain/locale';
import { api, dataChanged, useApi } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Callout, Checkbox, cx, Dialog, Disclosure, DocStatus, ErrorState, Field, FormError, Glyph, humanize, Icon, PageHeader, PageLoading, Segmented, Spinner, useToast, VerificationLabel } from '../../ui';
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
  const [prefilled, setPrefilled] = useState<string[]>([]);
  useEffect(() => {
    if (!v) return;
    const next: any = { ...v.metadata, values: { ...(v.metadata.values ?? {}) } };
    const filled: string[] = [];
    const empty = !Object.keys(v.metadata).some((k) => k !== 'values') && !Object.keys(v.metadata.values ?? {}).length;
    // Confident readings fill the form; unsure ones are left for the reviewer to enter or accept.
    if (empty && ['awaiting_review', 'under_review', 'submitted'].includes(v.reviewStatus)) {
      for (const [k, f] of Object.entries<any>(v.extraction.fields ?? {})) {
        if (f.value === null || f.value === undefined || f.confidence < TRUST) continue;
        if (data.metadataFields.some((x: any) => x.key === k)) { next[k] = String(f.value); filled.push(k); }
        else if (data.valueFields.some((x: any) => x.key === k)) { next.values[k] = f.value; filled.push(k); }
      }
    }
    setMeta(next); setPrefilled(filled);
  }, [v?.id, v?.extraction?.status]); // eslint-disable-line
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
  const unsureLeft = proposed.filter(([k, f]: any) => f.confidence < TRUST && (data.metadataFields.some((x: any) => x.key === k) ? !meta[k] : data.valueFields.some((x: any) => x.key === k) && meta.values?.[k] === undefined)).length;
  const setM = (k: string, val: any) => setMeta((m: any) => ({ ...m, [k]: val }));
  const setV = (k: string, val: any) => setMeta((m: any) => ({ ...m, values: { ...m.values, [k]: val } }));
  const applyProposed = () => {
    const next = { ...meta, values: { ...meta.values } };
    for (const [k, f] of Object.entries(fields) as any) {
      if (f.value === null || f.value === undefined) continue;
      if (data.metadataFields.some((x: any) => x.key === k)) next[k] = String(f.value); else if (data.valueFields.some((x: any) => x.key === k)) next.values[k] = f.value;
    }
    setMeta(next);
    toast('Values copied in. Check each one against the document before deciding.', 'info');
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
        metadata: { ...meta, values }, checklist: [
          ...checks.map((c) => ({ key: c.criterion.key, label: c.criterion.label, passed: c.passed })),
          ...(data.assessment?.checks ?? []).map((c: any) => ({ key: `auto:${c.key}`, label: `${c.label} (automatic)`, passed: c.outcome === 'pass' ? true : c.outcome === 'fail' ? false : null })),
          ...Object.entries(manual).map(([k, p]) => ({ key: k, label: `${k} (by reviewer)`, passed: p })),
        ],
      });
      dataChanged();
      toast(decision === 'approve' ? 'Approved — readiness updated' : decision === 'reject' ? 'Rejected — the subcontractor has been told why' : 'Correction requested — the subcontractor has been told what to change');
      // Keep going: open the next document waiting for a decision, if there is one.
      const queue = await api<any>('reviews.queue', {}).catch(() => null);
      const nextItem = queue?.items?.find((i: any) => i.versionId !== v.id && !i.lockedBy);
      nav(nextItem ? `/app/reviews/${nextItem.versionId}` : '/app/reviews');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const blockedApprove = decision === 'approve' && (failed.length > 0 || missingExpiry);
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Documents to review', to: '/app/reviews' }, { label: data.subcontractor.legalName, to: `/app/subcontractors/${data.subcontractor.id}` }, { label: data.requirement?.name ?? data.document.title }]}
        title={data.requirement?.name ?? data.document.title}
        meta={<><span>{data.subcontractor.legalName}</span><span>Version {v.versionNumber} · {v.fileName}</span><span>Submitted {formatDateTime(v.uploadedAt)} by {v.uploadedBy.name.replace(/ \(.+\)$/, '')}</span></>}
        actions={<DocStatus value={v.reviewStatus} />} />
      {lockErr && <div className="mb-6"><Callout tone="warn" title="Someone else is reviewing this">{lockErr}. You can look, but only they can decide until their claim lapses after 30 minutes of inactivity.</Callout></div>}
      <div className="grid xl:grid-cols-[1.3fr_1fr] gap-x-10 gap-y-8 items-start">
        <div className="min-w-0 xl:sticky xl:top-24 border border-line rounded-md overflow-hidden bg-paper"><FilePreview versionId={v.id} mimeType={v.mimeType} className="h-[78vh]" /></div>
        <div className="space-y-10 min-w-0">
          <AssessmentBanner a={data.assessment} readingOn={data.readingOn} extraction={v.extraction} />

          <section>
            <h2 className="text-lg font-semibold pb-3 border-b border-line-strong"><span className="text-faint tnum mr-2">1</span>What the document says</h2>
            <ReadingSummary v={v} kindLabels={data.kindLabels} readingOn={data.readingOn} onReload={reload} unsure={proposed.filter(([, f]: any) => f.confidence < TRUST).length} />
            {(proposed.length > 0 || readingNotes(v).length > 0) && (
              <div className="mt-4 border-t border-line">
                {proposed.length > 0 && (
                  <Disclosure title="Details read" note={proposed.length} attention={proposed.some(([, f]: any) => f.confidence < TRUST)} defaultOpen>
                    <table className="w-full text-sm">
                      <thead className="sr-only"><tr><th>Field</th><th>Read as</th><th>Confidence</th></tr></thead>
                      <tbody>{proposed.map(([k, f]: any) => (
                        <tr key={k} className="border-b border-line last:border-0 align-top">
                          <td className="py-2 pr-3 text-muted w-[38%]">{fieldLabel(k, v.extraction.kind)}</td>
                          <td className="py-2 pr-3 text-ink text-[0.9375rem] break-words">{fmtValue(f.value)}</td>
                          <td className="py-2 tnum text-right whitespace-nowrap">{f.confidence < TRUST ? <span className="inline-flex items-center gap-1.5 font-medium"><Glyph tone="attention" className="w-3.5 h-3.5" />Unsure</span> : <span className="text-faint">{Math.round(f.confidence * 100)}%</span>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </Disclosure>
                )}
                {proposed.some(([, f]: any) => f.source) && (
                  <Disclosure title="Where each detail was found" note={`${proposed.filter(([, f]: any) => f.source).length} quoted`}>
                    <ul className="space-y-3 text-sm">{proposed.filter(([, f]: any) => f.source).map(([k, f]: any) => (
                      <li key={k}>
                        <div className="flex justify-between gap-3"><span className="font-medium">{fieldLabel(k, v.extraction.kind)}</span><span className={cx('tnum shrink-0', f.confidence < TRUST ? 'font-medium' : 'text-faint')}>{f.confidence < TRUST && <Glyph tone="attention" className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />}{Math.round(f.confidence * 100)}%</span></div>
                        <div className="text-muted mt-0.5 break-words">{f.page ? `Page ${f.page}: ` : ''}“{f.source}”</div>
                      </li>
                    ))}</ul>
                  </Disclosure>
                )}
                {readingNotes(v).length > 0 && (
                  <Disclosure title="Notes from the reading" note={readingNotes(v).length} attention={(v.extraction.issues ?? []).length > 0} defaultOpen={!!pending && (v.extraction.issues ?? []).length > 0}>
                    <ul className="space-y-2 text-sm text-muted list-disc pl-4">{readingNotes(v).map((n, i) => <li key={i}>{n}</li>)}</ul>
                  </Disclosure>
                )}
              </div>
            )}
            {v.extraction.status === 'completed' && proposed.length === 0 && <p className="text-muted mt-3">Nothing could be read confidently. Enter the details below from the document.</p>}
          </section>

          {data.requirement && (
            <section>
              <h2 className="text-lg font-semibold pb-3 border-b border-line-strong"><span className="text-faint tnum mr-2">2</span>Compared with what you asked for</h2>
              <p className="text-sm text-muted mt-3">{data.requirement.name}{data.requirement.description ? ` — ${data.requirement.description}` : ''}</p>
              {data.assessment?.checks?.length ? (
                <ul className="mt-4 space-y-3">
                  {data.assessment.checks.map((c: any) => (
                    <li key={c.key} className="flex gap-2.5 items-start">
                      <Glyph tone={c.outcome === 'pass' ? 'ok' : c.outcome === 'fail' ? 'blocked' : c.outcome === 'warn' ? 'attention' : 'none'} className="w-4 h-4 mt-0.5 shrink-0" />
                      <span className="min-w-0"><span className="font-medium">{c.label}</span><span className="sr-only"> — {OUTCOME[c.outcome]}</span><span className="block text-sm text-muted">{c.detail}</span></span>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="mt-4 space-y-2.5">
                  {data.requirement.expiryRequired && <li className="flex gap-2.5 items-start"><Glyph tone={missingExpiry ? 'blocked' : expired ? 'attention' : 'ok'} className="w-4 h-4 mt-0.5" /><span>Expiry date recorded{expired ? ' — already expired' : ''}</span></li>}
                  {checks.map((c) => <li key={c.criterion.key} className="flex gap-2.5 items-start"><Glyph tone={c.passed === true ? 'ok' : c.passed === false ? 'blocked' : 'none'} className="w-4 h-4 mt-0.5" /><span>{data.criteria.find((x: any) => x.key === c.criterion.key)?.description} <span className="text-faint">({c.detail})</span></span></li>)}
                  {!data.requirement.expiryRequired && checks.length === 0 && <li className="text-muted">No structured conditions. Compare the document with the description above.</li>}
                </ul>
              )}
              {isInsurance && pending && (() => {
                // Ask a person only for what the automatic comparison couldn't establish. A passed check is
                // shown as done (and recorded as automatic); anything unclear or unread becomes a box to tick.
                const items = insuranceEyeChecks(data.assessment?.checks ?? [], fields, market).map((x) => ({ k: x.label, auto: x.automatic }));
                const done = items.filter((x) => x.auto);
                const todo = items.filter((x) => !x.auto);
                return (
                  <div className="mt-6 space-y-2.5">
                    {todo.length > 0 && <div className="text-sm font-medium">Check by eye</div>}
                    {todo.map(({ k }) => <Checkbox key={k} checked={manual[k] === true} onChange={(x) => setManual({ ...manual, [k]: x ? true : null })} label={k} />)}
                    {done.length > 0 && <p className="text-sm text-muted flex items-start gap-2 pt-1"><Glyph tone="ok" className="w-3.5 h-3.5 mt-1 shrink-0" /><span>Checked automatically: {done.map((x) => x.k.charAt(0).toLowerCase() + x.k.slice(1)).join('; ')}.</span></p>}
                  </div>
                );
              })()}
              <p className="text-xs text-faint leading-relaxed mt-4">This comparison uses what was read from the document and your requirement. It isn’t a review decision, and {isInsurance ? `${/^[aeiou]/i.test(term(market, 'coi')) ? 'an' : 'a'} ${term(market, 'coi')} is evidence of cover, not proof of it` : 'it doesn’t verify the document with the issuer'}.</p>
            </section>
          )}

          <section>
            <h2 className="text-lg font-semibold pb-3 border-b border-line-strong"><span className="text-faint tnum mr-2">3</span>Confirmed details</h2>
            <p className="text-sm text-muted mt-3">{prefilled.length ? `${prefilled.length === 1 ? '1 detail was' : `${prefilled.length} details were`} filled in from the document. Check them against it — they become the official record when you decide.` : 'These become the official record when you decide.'}</p>
            {pending && unsureLeft > 0 && <button className="btn-quiet mt-2" onClick={applyProposed}>Also fill in the {unsureLeft} unsure value{unsureLeft === 1 ? '' : 's'}</button>}
            {(() => {
              // Show what this requirement needs first; everything else is one click away.
              const criteriaKeys = new Set((data.requirement?.criteria ?? []).map((c: any) => c.key));
              const insurance = /insur|endorse|indemnity/i.test(`${data.requirement?.category ?? ''} ${data.requirement?.name ?? ''}`);
              const essential = new Set(['issuer', 'referenceNumber', 'expiryDate', ...(insurance ? ['namedInsured', 'issueDate'] : ['issueDate'])]);
              const hasValue = (k: string, inValues = false) => { const x = inValues ? meta.values?.[k] : meta[k]; return x !== undefined && x !== null && x !== ''; };
              const metaField = (f: any) => (
                <Field key={f.key} label={f.label} required={f.key === 'expiryDate' && data.requirement?.expiryRequired}>
                  <input className={cx('input', fields[f.key] && fields[f.key].confidence < 0.7 && 'border-ink')} type={f.type === 'date' ? 'date' : 'text'} value={meta[f.key] ?? ''} onChange={(e) => setM(f.key, e.target.value)} disabled={!pending} />
                </Field>
              );
              const valueField = (f: any) => f.type === 'amount' ? (
                <Field key={f.key} label={f.label}><input className="input" inputMode="numeric" value={meta.values?.[f.key] ?? ''} onChange={(e) => setV(f.key, e.target.value.replace(/[^0-9.]/g, ''))} disabled={!pending} /></Field>
              ) : (
                <Field key={f.key} label={f.label}><select className="input" value={meta.values?.[f.key] === undefined ? '' : String(meta.values[f.key])} onChange={(e) => setV(f.key, e.target.value === '' ? undefined : e.target.value === 'true')} disabled={!pending}><option value="">Not recorded</option><option value="true">Shown on the document</option><option value="false">Not shown</option></select></Field>
              );
              const mainMeta = data.metadataFields.filter((f: any) => essential.has(f.key) || hasValue(f.key));
              const mainValues = data.valueFields.filter((f: any) => criteriaKeys.has(f.key) || hasValue(f.key, true));
              const moreMeta = data.metadataFields.filter((f: any) => !mainMeta.includes(f));
              const moreValues = data.valueFields.filter((f: any) => !mainValues.includes(f));
              return (
                <>
                  <div className="mt-5 grid sm:grid-cols-2 gap-x-5 gap-y-4">{mainMeta.map(metaField)}{mainValues.map(valueField)}</div>
                  {moreMeta.length + moreValues.length > 0 && (
                    <Disclosure className="mt-5 border-t" title="More details" note="optional">
                      <div className="grid sm:grid-cols-2 gap-x-5 gap-y-4">{moreMeta.map(metaField)}{moreValues.map(valueField)}</div>
                    </Disclosure>
                  )}
                </>
              );
            })()}
            {data.previous && <p className="text-sm text-muted mt-5">Replaces version {data.previous.versionNumber}, approved {formatDate(data.previous.review?.at)}{data.previous.metadata.expiryDate ? `, which expires ${formatDate(data.previous.metadata.expiryDate)}` : ''}{data.previous.metadata.referenceNumber ? ` (reference ${data.previous.metadata.referenceNumber})` : ''}.</p>}
          </section>

          {pending && data.canReview ? (
            <section className="border-t border-line-strong pt-6">
              <h2 className="text-lg font-semibold"><span className="text-faint tnum mr-2">4</span>Your decision</h2>
              <div className="mt-4 space-y-5">
                <Segmented label="Decision" value={decision} onChange={setDecision} options={[{ value: 'approve', label: 'Approve' }, { value: 'request_info', label: 'Request correction' }, { value: 'reject', label: 'Reject' }]} />
                {blockedApprove && <Callout tone="bad">{missingExpiry ? 'Record the expiry date to approve. ' : ''}{failed.length ? `Doesn't meet: ${failed.map((f) => f.criterion.label).join(', ')}. Correct the values if they were entered wrongly, or reject.` : ''}</Callout>}
                {decision === 'approve' && expired && <Callout tone="warn">This document has already expired. You can record it, but the subcontractor stays not ready for this requirement until a current one arrives.</Callout>}
                {decision !== 'approve' && <Field label="What the subcontractor needs to do" required hint="Sent to them with a link to upload a replacement."><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={decision === 'reject' ? 'e.g. The named insured is a different company' : 'e.g. Please also send the additional insured endorsement page'} /></Field>}
                <Field label="Internal note" optional hint="Only visible to your team."><textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
                <FormError error={err} />
                <button className="btn-primary btn-lg w-full" disabled={busy || !!lockErr || (decision !== 'approve' && !reason.trim()) || blockedApprove} onClick={submit}>
                  {busy && <Spinner />}{decision === 'approve' ? 'Approve document' : decision === 'reject' ? 'Reject and explain why' : 'Request a correction'}
                </button>
              </div>
            </section>
          ) : (
            <section className="border-t border-line-strong pt-6">
              <h2 className="text-lg font-semibold"><span className="text-faint tnum mr-2">4</span>Decision and verification</h2>
              <div className="mt-3 space-y-2">
                {v.review ? <p><span className="font-medium">{humanize(v.review.decision)}</span> by {v.review.reviewerName}, {formatDateTime(v.review.at)}</p> : <p className="text-muted">{humanize(v.reviewStatus)}</p>}
                {v.review?.reason && <p className="text-muted">Reason: {v.review.reason}</p>}
                <VerificationLabel value={v.verification} />
                {data.verifications.map((x: any) => <p key={x.id} className="text-sm text-muted">Verified via {humanize(x.method).toLowerCase()} with {x.source} (reference {x.reference}) by {x.verifiedBy.name}.</p>)}
                {v.reviewStatus === 'approved' && data.canVerify && v.verification !== 'independently_verified' && <button className="btn-secondary btn-sm mt-2" onClick={() => setVerify(true)}>Record independent verification</button>}
              </div>
            </section>
          )}
          {data.reviews.length > 0 && <section className="border-t border-line-strong"><Disclosure title="Earlier decisions and notes" note={data.reviews.length}><ul>{data.reviews.map((r: any) => <li key={r.id} className="py-3 border-b border-line last:border-0"><span className="font-medium">{humanize(r.decision)}</span> · {r.reviewerName} <span className="text-xs text-faint">{formatDateTime(r.at)}</span>{r.reason && <div className="text-sm text-muted">{r.reason}</div>}{r.internalComment && <div className="text-sm text-muted">Internal: {r.internalComment}</div>}</li>)}</ul></Disclosure></section>}
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

const OUTCOME: Record<string, string> = { pass: 'meets it', warn: 'worth noting', fail: 'doesn’t meet it', unclear: 'check by eye' };
function fmtValue(v: any) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
  return String(v);
}

function AssessmentBanner({ a, readingOn, extraction }: { a: any; readingOn: boolean; extraction: any }) {
  if (!a || a.triage === 'not_read') {
    if (['queued', 'processing'].includes(extraction.status)) return null;
    return <Callout tone="info" title="Check this one by eye">{extraction.status === 'skipped' ? extraction.skippedReason : !readingOn ? 'Automatic reading isn’t switched on for this workspace, so compare the document with the requirement yourself.' : 'The document couldn’t be read automatically. Compare it with the requirement yourself.'}</Callout>;
  }
  const tone = a.triage === 'looks_good' ? 'ok' : a.triage === 'problem' ? 'bad' : 'warn';
  const title = a.triage === 'looks_good' ? 'Looks right' : a.triage === 'problem' ? 'Doesn’t match the requirement' : 'A few things to check';
  return <Callout tone={tone as any} title={title}>{a.summary}</Callout>;
}

/** Always visible: what the document was read as, and anything that changes how to treat it. */
function ReadingSummary({ v, kindLabels, readingOn, onReload, unsure }: { v: any; kindLabels: Record<string, string>; readingOn: boolean; onReload: () => void; unsure: number }) {
  const x = v.extraction;
  return (
    <div className="mt-3 space-y-1.5">
      {['queued', 'processing'].includes(x.status) && <div className="flex items-center gap-2 text-muted"><Spinner /> Reading the document… <button className="btn-ghost btn-sm" onClick={onReload}>Check again</button></div>}
      {x.status === 'failed' && <p className="text-muted">Couldn’t be read automatically ({x.error}). Enter the details below.</p>}
      {x.status === 'skipped' && <p className="text-muted">{x.skippedReason}</p>}
      {x.status === 'not_configured' && <p className="text-muted">{readingOn ? 'Not read yet.' : 'Automatic reading is off. Enter the details below from the document.'}</p>}
      {x.status === 'completed' && x.kind && (
        <p><span className="font-medium">Reads as {(kindLabels[x.kind] ?? x.kind).toLowerCase()}</span>{x.kindConfidence < TRUST && <span className="text-muted"> (not certain)</span>}{unsure > 0 && <span className="text-muted"> · {unsure} {unsure === 1 ? 'detail' : 'details'} to check</span>}</p>
      )}
      {v.duplicateOf && <p className="flex items-center gap-2 text-sm"><Glyph tone="attention" className="w-3.5 h-3.5" />An identical file was already submitted on {formatDate(v.duplicateOf.at)}.</p>}
      {x.status === 'completed' && <p className="text-xs text-faint">Read automatically{x.escalated ? ' and checked by a second model' : ''}. Nothing is official until you confirm it.</p>}
    </div>
  );
}

function readingNotes(v: any): string[] {
  const x = v.extraction;
  const notes: string[] = [...(x.issues ?? [])];
  if (v.intake) notes.push(`Arrived by email from ${v.intake.from}${v.intake.subject ? ` (“${v.intake.subject}”)` : ''} on ${formatDateTime(v.intake.receivedAt)}.`);
  if (x.reusedFrom) notes.push('This exact file was read before, so that reading was reused.');
  return notes;
}
