import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatDate, formatDateTime } from '../../domain/dates';
import { METADATA_FIELDS, VALUE_FIELDS } from '../../domain/library';
import { api, useApi, useMutation } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Callout, Checkbox, Confirm, cx, Dialog, DocStatus, Empty, ErrorState, FormError, humanize, KeyValue, PageHeader, PageLoading, Section, Spinner, useToast, VerificationLabel } from '../../ui';
import { openFile, UploadDialog } from './shared';

export function FilePreview({ versionId, mimeType, fetcher }: { versionId: string; mimeType: string; fetcher?: () => Promise<{ url: string }> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true; setUrl(null); setErr(null);
    (fetcher ? fetcher() : api('files.url', { versionId })).then((r) => alive && setUrl(r.url)).catch((e) => alive && setErr(e.message));
    // Signed URLs last 5 minutes; refresh before they lapse.
    const t = setInterval(() => (fetcher ? fetcher() : api('files.url', { versionId })).then((r) => alive && setUrl(r.url)).catch(() => undefined), 240_000);
    return () => { alive = false; clearInterval(t); };
  }, [versionId]); // eslint-disable-line
  if (err) return <div className="p-6 text-sm text-bad">{err}</div>;
  if (!url) return <div className="h-[70vh] grid place-items-center text-muted"><Spinner /></div>;
  return mimeType === 'application/pdf'
    ? <iframe title="Document preview" src={url} className="w-full h-[75vh] bg-white rounded-b-md" />
    : <div className="p-3 bg-raised/40 rounded-b-md"><img src={url} alt="Document preview" className="max-h-[75vh] mx-auto" /></div>;
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
  if (!current) return <Section><Empty title="No uploaded versions yet" /></Section>;
  const m = current.metadata;
  const verif = data.verifications.filter((x: any) => x.versionId === current.id);
  return (
    <div>
      <PageHeader eyebrow={<><Link to="/app/documents" className="hover:text-ink">Documents</Link> · <Link to={`/app/subcontractors/${data.subcontractor.id}?tab=documents`} className="hover:text-ink">{data.subcontractor.legalName}</Link></>}
        title={d.title} description={data.requirement ? `Evidence for: ${data.requirement.name}` : 'Ad-hoc document'}
        actions={<>
          <button className="btn-secondary" onClick={() => openFile(current.id, true).catch((e) => toast(e.message, 'bad'))}>Download</button>
          {can('documents.upload') && !d.archived && <button className="btn-secondary" onClick={() => setReplace(true)}>Upload replacement</button>}
          {can('documents.upload') && <button className="btn-secondary" onClick={() => setProjects(true)}>Projects</button>}
          {can('documents.archive') && <button className={d.archived ? 'btn-secondary' : 'btn-ghost text-bad'} onClick={() => setArchive(true)}>{d.archived ? 'Restore' : 'Archive'}</button>}
        </>} />
      {d.archived && <div className="mb-4"><Callout tone="info">Archived. It no longer counts toward compliance; every version and decision is kept.</Callout></div>}
      <div className="grid xl:grid-cols-[1.5fr_1fr] gap-6">
        <div className="panel min-w-0">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line text-sm"><span className="truncate">v{current.versionNumber} · {current.fileName}</span><DocStatus value={current.reviewStatus} /></div>
          {current.reviewStatus === 'quarantined' ? <div className="p-6"><Callout tone="bad" title="Blocked by security checks">{current.scan.detail}</Callout></div> : <FilePreview versionId={current.id} mimeType={current.mimeType} />}
        </div>
        <div className="space-y-6 min-w-0">
          <Section title="Confirmed details" actions={['awaiting_review', 'under_review', 'submitted'].includes(current.reviewStatus) && can('documents.review') && <Link className="btn-primary btn-sm" to={`/app/reviews/${current.id}`}>Review</Link>}>
            <div className="p-4 space-y-3">
              <KeyValue items={[
                ...METADATA_FIELDS.map((f) => [f.label, f.type === 'date' ? (m as any)[f.key] && formatDate((m as any)[f.key]) : (m as any)[f.key]] as [string, any]),
                ...VALUE_FIELDS.filter((f) => m.values?.[f.key] !== undefined).map((f) => [f.label, f.type === 'amount' ? Number(m.values[f.key]).toLocaleString('en-GB') : m.values[f.key] ? 'Yes' : 'No'] as [string, any]),
              ]} />
              <div className="pt-2 border-t border-line"><VerificationLabel value={current.verification} /></div>
              {verif.map((v: any) => <div key={v.id} className="text-xs text-muted">Verified via {humanize(v.method)} with {v.source} (ref {v.reference}) by {v.verifiedBy.name}, {formatDateTime(v.at)}</div>)}
              <div className="text-xs text-faint">Security: {current.scan.status === 'clean' ? current.scan.detail ?? 'Passed' : current.scan.detail} · SHA-256 {current.sha256?.slice(0, 16)}…</div>
            </div>
          </Section>
          <Section title="Versions" description="Select a version to inspect it.">
            <ul className="divide-y divide-line">{versions.map((v: any) => (
              <li key={v.id}><button onClick={() => setSelected(v.id)} className={cx('w-full text-left px-4 py-2.5 hover:bg-raised/60', v.id === current.id && 'bg-raised')}>
                <div className="flex justify-between gap-2 text-sm"><span>v{v.versionNumber} · <span className="text-muted">{v.fileName}</span></span><DocStatus value={v.reviewStatus} /></div>
                <div className="text-xs text-faint">{formatDateTime(v.uploadedAt)} · {v.uploadedBy.name}{v.id === d.approvedVersionId ? ' · in force' : ''}</div>
              </button></li>
            ))}</ul>
          </Section>
          <Section title="Review history">
            {data.reviews.length === 0 ? <Empty title="Not reviewed yet" /> : <ul className="divide-y divide-line">{data.reviews.map((r: any) => (
              <li key={r.id} className="px-4 py-2.5 text-sm"><div><span className="font-medium">{humanize(r.decision)}</span> <span className="text-muted">by {r.reviewerName} · v{versions.find((v: any) => v.id === r.versionId)?.versionNumber}</span></div>
                {r.reason && <div className="text-muted">Reason: {r.reason}</div>}{r.internalComment && <div className="text-muted">Internal: {r.internalComment}</div>}
                {r.requirementVersion && <div className="text-xs text-faint">Against requirement v{r.requirementVersion}</div>}
                <div className="text-xs text-faint">{formatDateTime(r.at)}</div></li>
            ))}</ul>}
          </Section>
        </div>
      </div>
      <UploadDialog open={replace} onClose={() => setReplace(false)} subcontractorId={data.subcontractor.id} documentId={d.id} requirementId={d.requirementId} requirements={data.requirement ? [data.requirement] : []} />
      <Confirm open={archive} onClose={() => setArchive(false)} title={d.archived ? 'Restore document?' : 'Archive document?'} confirmLabel={d.archived ? 'Restore' : 'Archive'} danger={!d.archived} busy={update.busy}
        onConfirm={async () => { await update.run({ documentId: d.id, archived: !d.archived }); setArchive(false); toast(d.archived ? 'Restored' : 'Archived'); }}>
        {d.archived ? 'It will count toward compliance again.' : 'It will stop counting toward compliance. Nothing is deleted.'}
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
    <Dialog open onClose={onClose} title="Associated projects" description="By default a document applies to every project that needs it. Restrict it when the evidence is project-specific (e.g. a site RAMS)." footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={async () => { await run({ documentId: doc.id, projectIds: sel }); toast('Saved'); onClose(); }}>{busy && <Spinner />}Save</button></>}>
      {!sub.data ? <Spinner /> : <div className="space-y-2">
        <Checkbox checked={sel.length === 0} onChange={(v) => v && setSel([])} label="All projects that require it" />
        {sub.data.projects.map((p: any) => <Checkbox key={p.id} checked={sel.includes(p.id)} onChange={(v) => setSel(v ? [...sel, p.id] : sel.filter((x) => x !== p.id))} label={`Only ${p.name}`} />)}
      </div>}
      <FormError error={error} />
    </Dialog>
  );
}
