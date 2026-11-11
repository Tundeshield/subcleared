import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { money } from '../../domain/locale';
import { METADATA_FIELDS, VALUE_FIELDS } from '../../domain/library';
import { api, useApi, useMutation } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Callout, Checkbox, Confirm, cx, Dialog, DocStatus, Empty, ErrorState, FormError, humanize, KeyValue, Menu, MoreButton, PageHeader, PageLoading, SampleTag, Spinner, useToast, VerificationLabel } from '../../ui';
import { openFile, UploadDialog } from './shared';

export function FilePreview({ versionId, mimeType, fetcher, className }: { versionId: string; mimeType: string; fetcher?: () => Promise<{ url: string }>; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true; setUrl(null); setErr(null);
    const get = () => (fetcher ? fetcher() : api('files.url', { versionId }));
    get().then((r) => alive && setUrl(r.url)).catch((e) => alive && setErr(e.message));
    const t = setInterval(() => get().then((r) => alive && setUrl(r.url)).catch(() => undefined), 240_000); // signed links last 5 minutes
    return () => { alive = false; clearInterval(t); };
  }, [versionId]); // eslint-disable-line
  if (err) return <div className="p-6 text-sm">{err}</div>;
  if (!url) return <div className={cx('grid place-items-center text-muted', className ?? 'h-[70vh]')}><Spinner /></div>;
  return mimeType === 'application/pdf'
    ? <iframe title="Document preview" src={url} className={cx('w-full bg-white', className ?? 'h-[75vh]')} />
    : <div className="p-4 bg-raised/40"><img src={url} alt="Document preview" className="max-h-[75vh] mx-auto" /></div>;
}

export function metadataRows(m: any) {
  return [
    ...METADATA_FIELDS.map((f) => [f.label, f.type === 'date' ? (m[f.key] ? formatDate(m[f.key]) : null) : m[f.key]] as [string, any]),
    ...VALUE_FIELDS.filter((f) => m.values?.[f.key] !== undefined).map((f) => [f.label, f.type === 'amount' ? money(Number(m.values[f.key])) : m.values[f.key] ? 'Shown on document' : 'Not shown'] as [string, any]),
  ];
}

export default function DocumentDetail() {
  const { id } = useParams();
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<any>('documents.get', { documentId: id });
  const [selected, setSelected] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [archive, setArchive] = useState(false);
  const [projects, setProjects] = useState(false);
  const update = useMutation('documents.update');
  const toast = useToast();
  if (loading && !data) return <PageLoading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const d = data.document;
  const versions = data.versions;
  const current = versions.find((v: any) => v.id === (selected ?? d.approvedVersionId ?? d.currentVersionId)) ?? versions[0];
  if (!current) return <Empty title="No uploaded versions yet" />;
  const verif = data.verifications.filter((x: any) => x.versionId === current.id);
  const pending = ['awaiting_review', 'under_review', 'submitted'].includes(current.reviewStatus);
  return (
    <div>
      <PageHeader crumbs={[{ label: 'Documents', to: '/app/documents' }, { label: data.subcontractor.legalName, to: `/app/subcontractors/${data.subcontractor.id}?tab=documents` }, { label: d.title }]}
        title={d.title}
        meta={<><span>{data.requirement ? `Evidence for ${data.requirement.name}` : 'Ad-hoc document'}</span><span>{data.projects.length ? `Projects: ${data.projects.map((p: any) => p.name).join(', ')}` : 'Applies to every project that needs it'}</span></>}
        actions={<>
          {pending && can('documents.review') && <Link className="btn-primary" to={`/app/reviews/${current.id}`}>Review this version</Link>}
          <button className="btn-secondary" onClick={() => openFile(current.id, true).catch((e) => toast(e.message, 'bad'))}>Download</button>
          <Menu trigger={(t) => <MoreButton label="More document actions" {...t} />} items={[
            can('documents.upload') && !d.archived && { label: 'Upload a new version', onClick: () => setReplace(true) },
            can('documents.upload') && { label: 'Change associated projects', onClick: () => setProjects(true) },
            can('documents.archive') && { label: d.archived ? 'Restore document' : 'Archive document', onClick: () => setArchive(true), danger: !d.archived },
          ]} />
        </>} />
      {d.archived && <div className="mb-6"><Callout title="Archived">This document no longer counts toward readiness. Every version and decision is kept.</Callout></div>}
      <div className="grid xl:grid-cols-[1.45fr_1fr] gap-x-12 gap-y-10">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 pb-3 text-sm"><span className="truncate text-muted">Version {current.versionNumber} · {current.fileName}</span><DocStatus value={current.reviewStatus} /></div>
          <div className="border border-line rounded-md overflow-hidden bg-paper">
            {current.reviewStatus === 'quarantined' ? <div className="p-6"><Callout tone="bad" title="Blocked by security checks">{current.scan.detail}</Callout></div> : <FilePreview versionId={current.id} mimeType={current.mimeType} />}
          </div>
        </div>
        <div className="space-y-10 min-w-0">
          <section>
            <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Confirmed details</h2>
            <KeyValue items={metadataRows(current.metadata)} />
            <div className="mt-4 space-y-1.5">
              <VerificationLabel value={current.verification} />
              {verif.map((v: any) => <p key={v.id} className="text-sm text-muted">Verified via {humanize(v.method).toLowerCase()} with {v.source} (reference {v.reference}) by {v.verifiedBy.name}, {formatDateTime(v.at)}.</p>)}
              <p className="text-xs text-faint">Security: {current.scan.detail ?? humanize(current.scan.status)}{current.sha256 ? ` · fingerprint ${current.sha256.slice(0, 12)}` : ''}</p>
              {/insur|endorse|indemnity/i.test(`${data.requirement?.category ?? ''}`) && <p className="text-xs text-faint leading-relaxed">An insurance certificate is evidence of cover, not proof of it. “Reviewed” means it was checked against your stated requirements; it is not a legal coverage determination.</p>}
            </div>
          </section>
          <section>
            <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Versions</h2>
            <ol>{versions.map((v: any) => (
              <li key={v.id}><button onClick={() => setSelected(v.id)} aria-current={v.id === current.id} className={cx('w-full text-left py-3 border-b border-line flex items-start justify-between gap-3 hover:bg-raised/50 -mx-2 px-2 rounded', v.id === current.id && 'bg-raised/70')}>
                <span className="min-w-0"><span className="block">Version {v.versionNumber}{v.id === d.approvedVersionId && <span className="text-success text-sm"> · in force</span>}</span><span className="block text-sm text-faint truncate">{v.fileName} · {formatDateTime(v.uploadedAt)} · {v.uploadedBy.name}</span></span>
                <DocStatus value={v.reviewStatus} />
              </button></li>
            ))}</ol>
          </section>
          <section>
            <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Review history</h2>
            {data.reviews.length === 0 ? <p className="text-muted mt-4">Not reviewed yet.</p> : <ol>{data.reviews.map((r: any) => (
              <li key={r.id} className="py-3.5 border-b border-line">
                <div><span className="font-medium">{humanize(r.decision)}</span> <span className="text-muted">by {r.reviewerName} · version {versions.find((v: any) => v.id === r.versionId)?.versionNumber}</span></div>
                {r.reason && <p className="text-sm text-muted mt-1">Reason given to the subcontractor: {r.reason}</p>}
                {r.internalComment && <p className="text-sm text-muted mt-1">Internal note: {r.internalComment}</p>}
                <div className="text-xs text-faint mt-1">{formatDateTime(r.at)}{r.requirementVersion ? ` · against requirement version ${r.requirementVersion}` : ''}</div>
              </li>
            ))}</ol>}
          </section>
        </div>
      </div>
      <UploadDialog open={replace} onClose={() => setReplace(false)} subcontractorId={data.subcontractor.id} documentId={d.id} requirementId={d.requirementId} requirements={data.requirement ? [data.requirement] : []} />
      <Confirm open={archive} onClose={() => setArchive(false)} title={d.archived ? 'Restore this document?' : 'Archive this document?'} confirmLabel={d.archived ? 'Restore' : 'Archive'} danger={!d.archived} busy={update.busy}
        onConfirm={async () => { await update.run({ documentId: d.id, archived: !d.archived }); setArchive(false); toast(d.archived ? 'Restored' : 'Archived'); }}>
        {d.archived ? 'It will count toward readiness again.' : 'It stops counting toward readiness. Nothing is deleted.'}
      </Confirm>
      {projects && <ProjectsDialog doc={d} subId={data.subcontractor.id} onClose={() => setProjects(false)} />}
    </div>
  );
}

function ProjectsDialog({ doc, subId, onClose }: { doc: any; subId: string; onClose: () => void }) {
  const sub = useApi<any>('subs.get', { subcontractorId: subId });
  const [sel, setSel] = useState<string[]>(doc.projectIds);
  const { run, busy, error } = useMutation('documents.update');
  const toast = useToast();
  return (
    <Dialog open onClose={onClose} title="Associated projects" description="By default a document counts for every project that needs it. Restrict it when the evidence is site-specific, such as a method statement." footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={async () => { await run({ documentId: doc.id, projectIds: sel }); toast('Saved'); onClose(); }}>{busy && <Spinner />}Save</button></>}>
      {!sub.data ? <Spinner /> : <div className="space-y-3">
        <Checkbox checked={sel.length === 0} onChange={(v) => v && setSel([])} label="Every project that requires it" />
        {sub.data.projects.map((p: any) => <Checkbox key={p.id} checked={sel.includes(p.id)} onChange={(v) => setSel(v ? [...sel, p.id] : sel.filter((x) => x !== p.id))} label={`Only ${p.name}`} />)}
      </div>}
      <div className="mt-3"><FormError error={error} /></div>
    </Dialog>
  );
}

export { SampleTag };
