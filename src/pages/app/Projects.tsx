import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatDate } from '../../domain/dates';
import { useApi, useMutation } from '../../lib/api';
import { exportCsv } from '../../lib/export';
import { useSession } from '../../lib/session';
import {
  Drawer, Empty, ErrorState, Field, Icon, FilterSelect, FormError, humanize, PageHeader, Pagination, ReadinessBar, SampleTag, SearchInput, Skeleton, SortHeader,
  sortRows, Spinner, Toolbar, usePaged, useToast,
} from '../../ui';

const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived'];

export default function Projects() {
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useApi<any>('projects.list');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [pm, setPm] = useState('');
  const readiness = params.get('readiness') ?? '';
  const [sort, setSort] = useState<[string, 1 | -1]>(['name', 1]);
  const [open, setOpen] = useState(params.get('new') === '1');
  const nav = useNavigate();
  const rows = useMemo(() => {
    const all = (data?.items ?? []).filter((p: any) =>
      (status ? p.status === status : p.status !== 'archived') && (!pm || p.manager === pm) && (readiness !== 'not_ready' || p.notReady > 0) &&
      `${p.name} ${p.code} ${p.location} ${p.manager ?? ''}`.toLowerCase().includes(q.toLowerCase()));
    return sortRows(all, sort);
  }, [data, q, status, pm, readiness, sort]);
  const paged = usePaged(rows, 20);
  const managers = [...new Set((data?.items ?? []).map((p: any) => p.manager).filter(Boolean))] as string[];
  return (
    <div>
      <PageHeader title="Projects" description="Each project sets its own requirements. Readiness is worked out separately for every subcontractor on every project."
        actions={<>
          <button className="btn-secondary" disabled={!rows.length} onClick={() => exportCsv('Projects', [{ key: 'name', label: 'Project' }, { key: 'code', label: 'Reference' }, { key: 'location', label: 'Location' }, { key: 'manager', label: 'Project manager' }, { key: 'status', label: 'Status' }, { key: 'assigned', label: 'Subcontractors' }, { key: 'ready', label: 'Ready' }, { key: 'action', label: 'Action required' }, { key: 'notReady', label: 'Not ready' }], rows)}>Export CSV</button>
          {can('projects.create') && <button className="btn-primary" onClick={() => setOpen(true)}>New project</button>}
        </>} />
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder="Search projects" className="w-full sm:w-72" />
        <FilterSelect label="Status" all="Current" value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        {managers.length > 0 && <FilterSelect label="Manager" value={pm} onChange={setPm} options={managers.map((m) => ({ value: m, label: m }))} />}
        {readiness && <button className="btn-ghost btn-sm" onClick={() => setParams({})}>Showing projects with subcontractors not ready · Clear</button>}
      </Toolbar>
      {loading && !data ? <Skeleton /> : error ? <ErrorState error={error} onRetry={reload} /> : rows.length === 0 ? (
        <Empty title={data.items.length ? 'No projects match' : 'No projects yet'} action={!data.items.length && can('projects.create') ? <button className="btn-primary" onClick={() => setOpen(true)}>Create your first project</button> : undefined}>
          {data.items.length ? 'Try a different search or filter.' : 'Create a project, choose a requirement template and assign subcontractors to see who is ready to work.'}
        </Empty>
      ) : (
        <>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="table min-w-[920px]">
              <thead><tr>
                <SortHeader label="Project" k="name" sort={sort} setSort={setSort} /><SortHeader label="Location" k="location" sort={sort} setSort={setSort} />
                <SortHeader label="Project manager" k="manager" sort={sort} setSort={setSort} /><SortHeader label="Readiness" k="readyPct" sort={sort} setSort={setSort} className="w-64" />
                <SortHeader label="Status" k="status" sort={sort} setSort={setSort} /><SortHeader label="Last activity" k="lastActivityAt" sort={sort} setSort={setSort} />
              </tr></thead>
              <tbody>{paged.slice.map((p: any) => (
                <tr key={p.id} className="tr-link" onClick={() => nav(`/app/projects/${p.id}`)}>
                  <td className="td"><div className="font-medium">{p.name} {p.sample && <SampleTag />}</div><div className="text-sm text-faint">{p.code || '—'}</div></td>
                  <td className="td text-muted">{p.location || '—'}</td>
                  <td className="td text-muted">{p.manager ?? <span className="text-faint">Unassigned</span>}</td>
                  <td className="td">
                    {p.assigned === 0 ? <span className="text-faint text-sm">No subcontractors assigned</span> : <>
                      <div className="text-sm tnum"><span className="font-medium">{p.ready}</span><span className="text-muted"> of {p.assigned} ready</span>{p.notReady > 0 && <span className="text-muted"> · {p.notReady} not ready</span>}</div>
                      <ReadinessBar className="mt-2 max-w-[13rem]" ready={p.ready} action={p.action} notReady={p.notReady} total={p.assigned} />
                    </>}
                  </td>
                  <td className="td text-muted">{humanize(p.status)}</td>
                  <td className="td text-muted whitespace-nowrap">{formatDate(p.lastActivityAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pagination {...paged} />
        </>
      )}
      <ProjectDrawer open={open} onClose={() => { setOpen(false); if (params.get('new')) setParams({}); }} />
    </div>
  );
}

export function ProjectDrawer({ open, onClose, project }: { open: boolean; onClose: () => void; project?: any }) {
  const members = useApi<any>(open ? 'members.list' : null);
  const reqs = useApi<any>(open && !project ? 'requirements.list' : null);
  const save = useMutation(project ? 'projects.update' : 'projects.create');
  const toast = useToast();
  const nav = useNavigate();
  const blank = { name: '', code: '', description: '', location: '', address: '', status: 'active', startDate: '', endDate: '', managerUid: '', adminUids: [] as string[], templateId: '' };
  const [f, setF] = useState(blank);
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setTouched(false); setF(project ? { ...blank, ...project, startDate: project.startDate ?? '', endDate: project.endDate ?? '', managerUid: project.managerUid ?? '' } : blank); } }, [open]); // eslint-disable-line
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  // Sensible default: preselect the general onboarding template for a new project.
  useEffect(() => {
    if (!open || project || f.templateId) return;
    const t = reqs.data?.templates.filter((x: any) => x.active) ?? [];
    const general = t.find((x: any) => /general/i.test(x.name)) ?? t[0];
    if (general) set('templateId', general.id);
  }, [open, reqs.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = members.data?.members.filter((m: any) => m.status === 'active') ?? [];
  const dateErr = f.startDate && f.endDate && f.endDate < f.startDate ? 'Completion must be after the start date' : undefined;
  const submit = async () => {
    setTouched(true);
    if (!f.name.trim() || dateErr) return;
    try {
      const payload: any = { name: f.name, code: f.code, description: f.description, location: f.location, address: f.address, startDate: f.startDate, endDate: f.endDate, managerUid: f.managerUid, adminUids: f.adminUids, projectId: project?.id };
      if (f.status !== 'archived') payload.status = f.status;
      if (!project && f.templateId) payload.templateId = f.templateId;
      const r = await save.run(payload);
      toast(project ? 'Project updated' : 'Project created');
      onClose();
      if (!project) nav(`/app/projects/${r.projectId}`);
    } catch { /* shown */ }
  };
  return (
    <Drawer open={open} onClose={onClose} title={project ? 'Edit project' : 'New project'} description={project ? undefined : 'You can change any of this later.'} footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-primary" disabled={save.busy} onClick={submit}>{save.busy && <Spinner />}{project ? 'Save changes' : 'Create project'}</button>
    </>}>
      <div className="space-y-6">
          <Field label="Project name" required error={touched && !f.name.trim() ? 'Give the project a name' : undefined}><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Riverside Apartments, Phase 2" /></Field>
        <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Reference" optional><input className="input" value={f.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. RSA-02" /></Field>
            <Field label="Location" hint="City or site name, shown in lists."><input className="input" value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Manchester" /></Field>
        </div>
        {!project && (
            <Field label="Paperwork needed" hint="Pick the template closest to the work. You can add or remove items on the project afterwards.">
              <select className="input" value={f.templateId} onChange={(e) => set('templateId', e.target.value)}><option value="">None yet — I'll choose later</option>{reqs.data?.templates.filter((t: any) => t.active).map((t: any) => <option key={t.id} value={t.id}>{t.name} ({t.items.length} requirements)</option>)}</select>
            </Field>
        )}
        <details className="group rounded-md border border-line bg-paper" open={!!project}>
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-muted hover:text-ink list-none flex items-center gap-2"><span className="inline-block transition-transform group-open:rotate-90">{Icon.chevron()}</span>More details <span className="font-normal text-faint">(optional)</span></summary>
          <div className="px-4 pb-5 pt-1 space-y-5">
            <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Status"><select className="input" value={f.status} onChange={(e) => set('status', e.target.value)} disabled={f.status === 'archived'}>{STATUSES.filter((s) => s !== 'archived').map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select></Field>
            <Field label="Address" optional><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
            <Field label="Start date" optional><input className="input" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
            <Field label="Expected completion" optional error={dateErr}><input className="input" type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
            </div>
          <Field label="Description" optional><textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <Field label="Project manager" hint="Project managers see the projects they manage."><select className="input" value={f.managerUid} onChange={(e) => set('managerUid', e.target.value)}><option value="">Unassigned</option>{active.map((m: any) => <option key={m.uid} value={m.uid}>{m.name || m.email}</option>)}</select></Field>
          <div><div className="label">Project administrators</div>
            {active.length === 0 ? <p className="text-sm text-faint">Loading team…</p> : <div className="grid sm:grid-cols-2 gap-2">{active.map((m: any) => (
              <label key={m.uid} className="flex items-center gap-2.5 text-base"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={f.adminUids.includes(m.uid)} onChange={(e) => set('adminUids', e.target.checked ? [...f.adminUids, m.uid] : f.adminUids.filter((x) => x !== m.uid))} />{m.name || m.email}</label>
            ))}</div>}
          </div>

          </div>
        </details>
        <FormError error={save.error} />
      </div>
    </Drawer>
  );
}
