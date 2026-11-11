import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatDate } from '../../domain/dates';
import { useApi, useMutation } from '../../lib/api';
import { exportCsv } from '../../lib/export';
import { useSession } from '../../lib/session';
import { Dialog, Empty, ErrorState, Field, FormError, humanize, PageHeader, SearchInput, Segmented, Skeleton, SortHeader, sortRows, Spinner, useToast } from '../../ui';

export default function Projects() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useApi<any>('projects.list');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'live' | 'all' | 'archived'>('live');
  const [sort, setSort] = useState<[string, 1 | -1]>(['name', 1]);
  const [open, setOpen] = useState(params.get('new') === '1');
  const nav = useNavigate();
  const rows = useMemo(() => {
    const all = data?.items ?? [];
    const f = all.filter((p: any) => (status === 'all' || (status === 'archived' ? p.status === 'archived' : p.status !== 'archived')) && `${p.name} ${p.code} ${p.location}`.toLowerCase().includes(q.toLowerCase()));
    return sortRows(f, sort);
  }, [data, q, status, sort]);
  return (
    <div>
      <PageHeader title="Projects" description="Each project has its own requirements. Readiness is calculated separately for every subcontractor on every project."
        actions={<>
          <button className="btn-secondary" onClick={() => exportCsv('Projects', [{ key: 'name', label: 'Project' }, { key: 'code', label: 'Code' }, { key: 'status', label: 'Status' }, { key: 'assigned', label: 'Assigned' }, { key: 'ready', label: 'Ready' }, { key: 'action', label: 'Action required' }, { key: 'notReady', label: 'Not ready' }], rows)} disabled={!rows.length}>Export CSV</button>
          {can('projects.create') && <button className="btn-primary" onClick={() => setOpen(true)}>New project</button>}
        </>} />
      <div className="flex flex-wrap gap-3 mb-4">
        <SearchInput value={q} onChange={setQ} placeholder="Search projects" className="w-72" />
        <Segmented value={status} onChange={setStatus} options={[{ value: 'live', label: 'Current' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }]} />
      </div>
      <div className="panel overflow-x-auto">
        {loading && !data ? <Skeleton /> : error ? <div className="p-4"><ErrorState error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          <Empty title={data.items.length ? 'No projects match' : 'No projects yet'} action={!data.items.length && can('projects.create') ? <button className="btn-primary btn-sm" onClick={() => setOpen(true)}>Create your first project</button> : undefined}>
            {data.items.length ? 'Try a different search or filter.' : 'Create a project, apply a requirement template and assign subcontractors to see who is ready to work.'}
          </Empty>
        ) : (
          <table className="w-full min-w-[820px]">
            <thead><tr>
              <SortHeader label="Project" k="name" sort={sort} setSort={setSort} /><SortHeader label="Status" k="status" sort={sort} setSort={setSort} />
              <SortHeader label="Start" k="startDate" sort={sort} setSort={setSort} /><SortHeader label="Requirements" k="requirements" sort={sort} setSort={setSort} className="text-right" />
              <SortHeader label="Assigned" k="assigned" sort={sort} setSort={setSort} className="text-right" /><SortHeader label="Ready" k="ready" sort={sort} setSort={setSort} className="text-right" />
              <SortHeader label="Attention" k="action" sort={sort} setSort={setSort} className="text-right" /><SortHeader label="Not ready" k="notReady" sort={sort} setSort={setSort} className="text-right" />
            </tr></thead>
            <tbody>{rows.map((p: any) => (
              <tr key={p.id} className="tr-link" onClick={() => nav(`/app/projects/${p.id}`)}>
                <td className="td"><div className="font-medium">{p.name}</div><div className="text-xs text-faint">{[p.code, p.location].filter(Boolean).join(' · ')}</div></td>
                <td className="td">{humanize(p.status)}</td><td className="td text-muted">{formatDate(p.startDate)}</td>
                <td className="td text-right tabular-nums">{p.requirements}</td><td className="td text-right tabular-nums">{p.assigned}</td>
                <td className="td text-right tabular-nums text-ok">{p.ready}</td><td className="td text-right tabular-nums text-warn">{p.action}</td><td className="td text-right tabular-nums text-bad">{p.notReady}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <ProjectDialog open={open} onClose={() => { setOpen(false); if (params.get('new')) setParams({}); }} />
    </div>
  );
}

export function ProjectDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project?: any }) {
  const members = useApi<any>(open ? 'members.list' : null);
  const reqs = useApi<any>(open && !project ? 'requirements.list' : null);
  const create = useMutation(project ? 'projects.update' : 'projects.create');
  const toast = useToast();
  const nav = useNavigate();
  const blank = { name: '', code: '', description: '', location: '', address: '', status: 'planning', startDate: '', endDate: '', managerUid: '', adminUids: [] as string[], templateId: '' };
  const [f, setF] = useState(blank);
  useEffect(() => { if (open) setF(project ? { ...blank, ...project, startDate: project.startDate ?? '', endDate: project.endDate ?? '', managerUid: project.managerUid ?? '' } : blank); }, [open]); // eslint-disable-line
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const active = members.data?.members.filter((m: any) => m.status === 'active') ?? [];
  return (
    <Dialog open={open} onClose={onClose} title={project ? 'Edit project' : 'New project'} width="max-w-2xl" footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={create.busy || !f.name.trim()} onClick={async () => {
        try {
          const payload: any = { ...f, projectId: project?.id };
          if (project) delete payload.templateId;
          if (project && payload.status === 'archived') delete payload.status;
          const r = await create.run(payload);
          toast(project ? 'Project updated' : 'Project created');
          onClose();
          if (!project) nav(`/app/projects/${r.projectId}`);
        } catch { /* shown */ }
      }}>{create.busy && <Spinner />}{project ? 'Save changes' : 'Create project'}</button>
    </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Project name" required className="sm:col-span-2"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Reference / code"><input className="input" value={f.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. RSA-02" /></Field>
        <Field label="Status"><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)} disabled={f.status === 'archived'}>{['planning', 'active', 'on_hold', 'completed'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>
        <Field label="Location"><input className="input" value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="City or site name" /></Field>
        <Field label="Address"><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Start date"><input className="input" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
        <Field label="Expected completion"><input className="input" type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
        <Field label="Project manager"><select className="input" value={f.managerUid} onChange={(e) => set('managerUid', e.target.value)}><option value="">Unassigned</option>{active.map((m: any) => <option key={m.uid} value={m.uid}>{m.name || m.email}</option>)}</select></Field>
        <Field label="Project administrators" hint="Hold Ctrl/⌘ to pick several.">
          <select multiple className="input h-24 py-1" value={f.adminUids} onChange={(e) => set('adminUids', [...e.target.selectedOptions].map((o) => o.value))}>{active.map((m: any) => <option key={m.uid} value={m.uid}>{m.name || m.email}</option>)}</select>
        </Field>
        <Field label="Description" className="sm:col-span-2"><textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        {!project && (
          <Field label="Requirement template" hint="Copies the template's requirements into this project. You can adjust them afterwards." className="sm:col-span-2">
            <select className="input" value={f.templateId} onChange={(e) => set('templateId', e.target.value)}><option value="">None — I'll add requirements myself</option>{reqs.data?.templates.filter((t: any) => t.active).map((t: any) => <option key={t.id} value={t.id}>{t.name} ({t.items.length})</option>)}</select>
          </Field>
        )}
      </div>
      <div className="mt-4"><FormError error={create.error} /></div>
    </Dialog>
  );
}
