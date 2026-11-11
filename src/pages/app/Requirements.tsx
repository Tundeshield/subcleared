import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { describeCriterion } from '../../domain/compliance';
import { formatDateTime } from '../../domain/dates';
import { DOCUMENT_TYPES, SUB_TYPES, VALUE_FIELDS } from '../../domain/library';
import { useApi, useMutation } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Checkbox, cx, Dialog, Empty, ErrorState, Field, FormError, humanize, PageHeader, SearchInput, Section, Skeleton, Spinner, Tabs, useToast } from '../../ui';

export default function Requirements() {
  const { can } = useSession();
  const [params] = useSearchParams();
  const { data, error, loading, reload } = useApi<any>('requirements.list');
  const [tab, setTab] = useState<'library' | 'templates'>('library');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const [tpl, setTpl] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const highlight = params.get('highlight');
  const editable = can('requirements.manage');
  const reqs = useMemo(() => (data?.requirements ?? []).filter((r: any) => `${r.name} ${r.category} ${r.description}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const byCat = useMemo(() => { const m = new Map<string, any[]>(); for (const r of reqs) m.set(r.category, [...(m.get(r.category) ?? []), r]); return [...m.entries()]; }, [reqs]);
  return (
    <div>
      <PageHeader title="Requirements" description="Define what subcontractors must provide. Templates bundle requirements for a type of work; projects copy them and can be adjusted. Every change is versioned."
        actions={editable && (tab === 'library' ? <button className="btn-primary" onClick={() => setEdit({})}>New requirement</button> : <button className="btn-primary" onClick={() => setTpl({ items: [] })}>New template</button>)} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'library', label: 'Requirement library', count: data?.requirements.length }, { value: 'templates', label: 'Templates', count: data?.templates.length }]} />
      <div className="mt-5">
        {loading && !data ? <div className="panel"><Skeleton /></div> : error ? <ErrorState error={error} onRetry={reload} /> : tab === 'library' ? (
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Search requirements" className="w-72 mb-4" />
            {reqs.length === 0 ? <div className="panel"><Empty title={data.requirements.length ? 'No matches' : 'No requirements yet'} action={editable && !data.requirements.length ? <button className="btn-primary btn-sm" onClick={() => setEdit({})}>Create a requirement</button> : undefined} /></div> : (
              <div className="space-y-5">{byCat.map(([cat, items]) => (
                <Section key={cat} title={cat}>
                  <div className="overflow-x-auto"><table className="w-full min-w-[820px]">
                    <thead><tr><th className="th">Requirement</th><th className="th">Type</th><th className="th">Default</th><th className="th">Expiry</th><th className="th">Review</th><th className="th">Criteria</th><th className="th text-right">Projects</th><th className="th">Version</th><th className="th" /></tr></thead>
                    <tbody>{items.map((r: any) => (
                      <tr key={r.id} className={cx(highlight === r.id && 'bg-accent/5', !r.active && 'opacity-60')}>
                        <td className="td"><div className="font-medium">{r.name}{!r.active && <span className="text-xs text-faint ml-2">Inactive</span>}</div><div className="text-xs text-muted max-w-md">{r.description}</div>{r.subTypes.length > 0 && <div className="text-xs text-faint">Only for: {r.subTypes.map(humanize).join(', ')}</div>}</td>
                        <td className="td text-muted">{r.kind === 'document' ? r.documentType ?? 'Document' : humanize(r.kind)}</td>
                        <td className="td text-muted">{r.defaultMandatory ? 'Mandatory' : 'Optional'}</td>
                        <td className="td text-muted">{r.expiryRequired ? 'Required' : r.renewal === 'periodic' && r.renewalPeriodDays ? `Every ${r.renewalPeriodDays} days` : 'No'}</td>
                        <td className="td text-muted">{r.reviewRequired ? 'Required' : 'Auto-accept'}</td>
                        <td className="td text-muted text-xs">{r.criteria.length ? r.criteria.map(describeCriterion).join('; ') : '—'}</td>
                        <td className="td text-right tabular-nums">{r.projects}</td>
                        <td className="td"><button className="link text-sm" onClick={() => setHist(r)}>v{r.version}</button></td>
                        <td className="td text-right">{editable && <button className="btn-ghost btn-sm" onClick={() => setEdit(r)}>Edit</button>}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </Section>
              ))}</div>
            )}
          </>
        ) : (
          data.templates.length === 0 ? <div className="panel"><Empty title="No templates yet" action={editable ? <button className="btn-primary btn-sm" onClick={() => setTpl({ items: [] })}>Create a template</button> : undefined} /></div> : (
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{data.templates.map((t: any) => (
              <div key={t.id} className={cx('panel p-4 flex flex-col', !t.active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold">{t.name}</h3><p className="text-sm text-muted mt-0.5">{t.description}</p></div><span className="text-xs text-faint whitespace-nowrap">v{t.version}</span></div>
                <ul className="mt-3 text-sm space-y-1 flex-1">{t.items.map((it: any) => { const r = data.requirements.find((x: any) => x.id === it.requirementId); return <li key={it.requirementId} className="flex justify-between gap-2"><span className="truncate">{r?.name ?? 'Removed requirement'}</span><span className="text-xs text-faint">{it.mandatory ? 'Mandatory' : 'Optional'}</span></li>; })}</ul>
                <div className="mt-4 flex justify-between items-center text-xs text-faint"><span>Updated {formatDateTime(t.updatedAt)}</span>{editable && <button className="btn-ghost btn-sm" onClick={() => setTpl(t)}>Edit</button>}</div>
              </div>
            ))}</div>
          )
        )}
      </div>
      {edit && <RequirementBuilder initial={edit} onClose={() => setEdit(null)} />}
      {tpl && <TemplateEditor initial={tpl} requirements={data.requirements} onClose={() => setTpl(null)} />}
      {hist && <HistoryDialog req={hist} onClose={() => setHist(null)} />}
    </div>
  );
}

function RequirementBuilder({ initial, onClose }: { initial: any; onClose: () => void }) {
  const isNew = !initial.id;
  const [f, setF] = useState<any>({
    name: '', description: '', category: 'Insurance', kind: 'document', jurisdiction: '', subTypes: [], defaultMandatory: true, documentType: 'Certificate of insurance',
    expiryRequired: true, renewal: 'on_expiry', renewalPeriodDays: '', reviewRequired: true, criteria: [], instructions: '', active: true, ...initial,
  });
  const { run, busy, error } = useMutation(isNew ? 'requirements.create' : 'requirements.update');
  const toast = useToast();
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const setCrit = (i: number, k: string, v: any) => set('criteria', f.criteria.map((c: any, j: number) => (j === i ? { ...c, [k]: v } : c)));
  useEffect(() => { if (f.kind !== 'document') set('expiryRequired', false); }, [f.kind]); // eslint-disable-line
  return (
    <Dialog open onClose={onClose} title={isNew ? 'New requirement' : `Edit ${initial.name}`} width="max-w-3xl"
      description={!isNew ? `Saving creates version ${initial.version + 1}. Past evaluations keep the version they used; approvals are re-checked against new criteria.` : undefined}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !f.name.trim()} onClick={async () => {
          const payload = { ...f, requirementId: initial.id, renewalPeriodDays: f.renewalPeriodDays === '' ? null : Number(f.renewalPeriodDays), criteria: f.criteria.map((c: any) => ({ ...c, value: c.type === 'min_amount' ? Number(c.value) : c.value })) };
          try { const r = await run(payload); toast(isNew ? 'Requirement created' : `Saved as version ${r.version}`); onClose(); } catch { /* shown */ }
        }}>{busy && <Spinner />}{isNew ? 'Create requirement' : 'Save new version'}</button>
      </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Name" required><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Category"><input className="input" list="cats" value={f.category} onChange={(e) => set('category', e.target.value)} /><datalist id="cats">{['Insurance', 'Licensing', 'Health & safety', 'Corporate', 'Contractual', 'Declarations'].map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Description" className="sm:col-span-2"><textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="How it's satisfied">
          <select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="document">Document upload, reviewed</option><option value="declaration">Periodic declaration (recorded confirmation)</option><option value="manual_check">Manual compliance check</option>
          </select>
        </Field>
        {f.kind === 'document' ? <Field label="Document type expected"><select className="input" value={f.documentType ?? ''} onChange={(e) => set('documentType', e.target.value)}>{DOCUMENT_TYPES.map((d) => <option key={d}>{d}</option>)}</select></Field>
          : <Field label="Renew every (days)" hint="Leave empty if a confirmation never lapses."><input className="input" type="number" min={1} value={f.renewalPeriodDays ?? ''} onChange={(e) => set('renewalPeriodDays', e.target.value)} /></Field>}
        <Field label="Applicable jurisdiction" hint="For your reference and reporting."><input className="input" value={f.jurisdiction ?? ''} onChange={(e) => set('jurisdiction', e.target.value)} placeholder="e.g. England & Wales, California" /></Field>
        <Field label="Renewal behaviour"><select className="input" value={f.renewal} onChange={(e) => set('renewal', e.target.value)}><option value="none">No renewal</option><option value="on_expiry">Renew on expiry</option><option value="annual">Annual</option><option value="periodic">Periodic</option></select></Field>
        <div className="sm:col-span-2 grid sm:grid-cols-3 gap-3">
          <Checkbox checked={f.defaultMandatory} onChange={(v) => set('defaultMandatory', v)} label="Mandatory by default" hint="Projects can override." />
          {f.kind === 'document' && <Checkbox checked={f.expiryRequired} onChange={(v) => set('expiryRequired', v)} label="Expiry date required" hint="Reviewers must record one to approve." />}
          {f.kind === 'document' && <Checkbox checked={f.reviewRequired} onChange={(v) => set('reviewRequired', v)} label="Reviewer approval required" hint="Off = accepted once it passes security checks." />}
          {!isNew && <Checkbox checked={f.active} onChange={(v) => set('active', v)} label="Active" hint="Inactive requirements stop counting." />}
        </div>
        <fieldset className="sm:col-span-2"><legend className="label">Applies only to these subcontractor types</legend><p className="hint -mt-1 mb-2">Leave all unticked to apply to everyone. Others are automatically not applicable, with this setting shown as the reason.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">{SUB_TYPES.map((t) => <Checkbox key={t} checked={f.subTypes.includes(t)} onChange={(v) => set('subTypes', v ? [...f.subTypes, t] : f.subTypes.filter((x: string) => x !== t))} label={humanize(t)} />)}</div>
        </fieldset>
        {f.kind === 'document' && (
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between"><div><div className="label mb-0">Review criteria</div><p className="hint mt-0.5">Structured checks against the values a reviewer confirms (e.g. minimum limits). Approval is blocked when a recorded value fails.</p></div>
              <button className="btn-ghost btn-sm" onClick={() => set('criteria', [...f.criteria, { key: 'glEachOccurrence', label: 'GL each occurrence', type: 'min_amount', value: 1000000 }])}>Add criterion</button></div>
            <div className="space-y-2 mt-2">{f.criteria.map((c: any, i: number) => (
              <div key={i} className="grid grid-cols-[1.2fr_1fr_0.8fr_auto] gap-2 items-center">
                <select className="input" value={c.key} onChange={(e) => { const vf = VALUE_FIELDS.find((x) => x.key === e.target.value); setCrit(i, 'key', e.target.value); if (vf) { setCrit(i, 'label', vf.label); setCrit(i, 'type', vf.type === 'amount' ? 'min_amount' : 'boolean'); } }} aria-label="Field">
                  {VALUE_FIELDS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                </select>
                <select className="input" value={c.type} onChange={(e) => setCrit(i, 'type', e.target.value)} aria-label="Check"><option value="min_amount">At least</option><option value="boolean">Must be confirmed</option></select>
                {c.type === 'min_amount' ? <input className="input" type="number" min={0} value={c.value ?? ''} onChange={(e) => setCrit(i, 'value', e.target.value)} aria-label="Minimum" /> : <span className="text-sm text-muted px-2">Yes</span>}
                <button className="btn-ghost btn-sm text-bad" onClick={() => set('criteria', f.criteria.filter((_: any, j: number) => j !== i))} aria-label="Remove criterion">Remove</button>
              </div>
            ))}</div>
          </div>
        )}
        <Field label="Instructions for subcontractors" className="sm:col-span-2" hint="Shown on the upload page."><textarea className="input" rows={2} value={f.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} /></Field>
      </div>
      <div className="mt-4"><FormError error={error} /></div>
    </Dialog>
  );
}

function TemplateEditor({ initial, requirements, onClose }: { initial: any; requirements: any[]; onClose: () => void }) {
  const [name, setName] = useState(initial.name ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [items, setItems] = useState<{ requirementId: string; mandatory: boolean }[]>(initial.items ?? []);
  const [active, setActive] = useState(initial.active ?? true);
  const { run, busy, error } = useMutation('templates.save');
  const toast = useToast();
  const has = (id: string) => items.find((i) => i.requirementId === id);
  return (
    <Dialog open onClose={onClose} title={initial.id ? `Edit ${initial.name}` : 'New template'} width="max-w-2xl"
      description={initial.id ? `Saving creates version ${initial.version + 1}. Projects that applied an earlier version are not changed until someone re-applies it.` : undefined}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !name.trim()} onClick={async () => { try { await run({ templateId: initial.id, name, description, items, active }); toast('Template saved'); onClose(); } catch { /* shown */ } }}>{busy && <Spinner />}Save template</button></>}>
      <div className="space-y-4">
        <Field label="Name" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {initial.id && <Checkbox checked={active} onChange={setActive} label="Active" />}
        <div><div className="label">Requirements ({items.length})</div>
          <div className="border border-line rounded divide-y divide-line max-h-80 overflow-y-auto">{requirements.filter((r) => r.active).map((r) => {
            const it = has(r.id);
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <Checkbox checked={!!it} onChange={(v) => setItems(v ? [...items, { requirementId: r.id, mandatory: r.defaultMandatory }] : items.filter((x) => x.requirementId !== r.id))} label={r.name} hint={r.category} />
                {it && <select className="input h-8 w-auto text-xs" value={it.mandatory ? 'm' : 'o'} onChange={(e) => setItems(items.map((x) => (x.requirementId === r.id ? { ...x, mandatory: e.target.value === 'm' } : x)))} aria-label={`${r.name} mandatory`}><option value="m">Mandatory</option><option value="o">Optional</option></select>}
              </div>
            );
          })}</div>
        </div>
        <FormError error={error} />
      </div>
    </Dialog>
  );
}

function HistoryDialog({ req, onClose }: { req: any; onClose: () => void }) {
  const { data } = useApi<any>('requirements.history', { requirementId: req.id });
  return (
    <Dialog open onClose={onClose} title={`${req.name} — version history`} width="max-w-2xl">
      {!data ? <Spinner /> : <ol className="space-y-3">{data.versions.map((v: any) => (
        <li key={v.version} className="rounded border border-line p-3 text-sm">
          <div className="flex justify-between"><span className="font-medium">Version {v.version}</span><span className="text-xs text-faint">{formatDateTime(v.updatedAt)}{v.changedBy ? ` · ${v.changedBy}` : ''}</span></div>
          <div className="text-muted mt-1">{v.defaultMandatory ? 'Mandatory' : 'Optional'} · {v.expiryRequired ? 'expiry required' : 'no expiry'} · {v.reviewRequired ? 'review required' : 'auto-accept'}{v.active ? '' : ' · inactive'}</div>
          {v.criteria?.length > 0 && <div className="text-xs text-muted mt-1">Criteria: {v.criteria.map(describeCriterion).join('; ')}</div>}
        </li>
      ))}</ol>}
    </Dialog>
  );
}
