import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { describeCriterion } from '../../domain/compliance';
import { formatDate, formatDateTime } from '../../domain/dates';
import { DOCUMENT_TYPES, SUB_TYPES, VALUE_FIELDS } from '../../domain/library';
import { useApi, useMutation } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Checkbox, cx, Dialog, Drawer, Empty, ErrorState, Field, FormError, humanize, PageHeader, SearchInput, Segmented, Skeleton, Spinner, Tabs, Toolbar, useToast, newRowKey, withoutRowKey } from '../../ui';

const KIND_LABEL: Record<string, string> = { document: 'Document, reviewed', declaration: 'Periodic declaration', manual_check: 'Manual check' };

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
      <PageHeader title="Requirements &amp; templates" description="What subcontractors must provide. Templates group requirements for a type of work; each project copies what it needs and can adjust it. Every change is versioned, so past decisions keep the rules they were made under."
        actions={editable && (tab === 'library' ? <button className="btn-primary" onClick={() => setEdit({})}>New requirement</button> : <button className="btn-primary" onClick={() => setTpl({ items: [] })}>New template</button>)} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'library', label: 'Requirement library', count: data?.requirements.length }, { value: 'templates', label: 'Templates', count: data?.templates.length }]} />
      <div className="mt-8">
        {loading && !data ? <Skeleton /> : error ? <ErrorState error={error} onRetry={reload} /> : tab === 'library' ? (
          <>
            <Toolbar><SearchInput value={q} onChange={setQ} placeholder="Search requirements" className="w-full sm:w-72" /></Toolbar>
            {reqs.length === 0 ? <Empty title={data.requirements.length ? 'No requirements match' : 'No requirements yet'} action={editable && !data.requirements.length ? <button className="btn-primary" onClick={() => setEdit({})}>Create a requirement</button> : undefined} /> : (
              <div className="space-y-12">{byCat.map(([cat, items]) => (
                <section key={cat}>
                  <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">{cat}</h2>
                  <ul>{items.map((r: any) => (
                    <li key={r.id} className={cx('py-5 border-b border-line grid md:grid-cols-[1fr_auto] gap-x-8 gap-y-3', highlight === r.id && 'bg-accent/[0.05] -mx-3 px-3 rounded', !r.active && 'opacity-60')}>
                      <div className="min-w-0">
                        <div className="font-medium">{r.name}{!r.active && <span className="text-sm text-faint font-normal ml-2">Inactive</span>}</div>
                        <p className="text-muted mt-1 max-w-2xl">{r.description}</p>
                        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                          <div><dt className="inline text-faint">Satisfied by </dt><dd className="inline">{KIND_LABEL[r.kind]}</dd></div>
                          <div><dt className="inline text-faint">Default </dt><dd className="inline">{r.defaultMandatory ? 'Mandatory' : 'Optional'}</dd></div>
                          <div><dt className="inline text-faint">Validity </dt><dd className="inline">{r.expiryRequired ? 'Expires — date required' : r.renewalPeriodDays ? `Renew every ${r.renewalPeriodDays} days` : 'Does not expire'}</dd></div>
                          {r.subTypes.length > 0 && <div><dt className="inline text-faint">Only for </dt><dd className="inline">{r.subTypes.map(humanize).join(', ')}</dd></div>}
                          {r.jurisdiction && <div><dt className="inline text-faint">Jurisdiction </dt><dd className="inline">{r.jurisdiction}</dd></div>}
                        </dl>
                        {r.criteria.length > 0 && <div className="mt-2 text-sm text-muted">Checks: {r.criteria.map(describeCriterion).join('; ')}</div>}
                      </div>
                      <div className="flex md:flex-col md:items-end gap-x-4 gap-y-1 text-sm">
                        <span className="text-muted tnum">Used on {r.projects} project{r.projects === 1 ? '' : 's'}</span>
                        <button className="btn-quiet" onClick={() => setHist(r)}>Version {r.version}</button>
                        {editable && <button className="btn-secondary btn-sm md:mt-2" onClick={() => setEdit(r)}>Edit</button>}
                      </div>
                    </li>
                  ))}</ul>
                </section>
              ))}</div>
            )}
          </>
        ) : (
          data.templates.length === 0 ? <Empty title="No templates yet" action={editable ? <button className="btn-primary" onClick={() => setTpl({ items: [] })}>Create a template</button> : undefined}>Templates are reusable sets of requirements for a type of work.</Empty> : (
            <ul className="border-t border-line-strong">{data.templates.map((t: any) => (
              <li key={t.id} className={cx('py-6 border-b border-line grid md:grid-cols-[18rem_1fr_auto] gap-x-10 gap-y-3', !t.active && 'opacity-60')}>
                <div><div className="font-medium">{t.name}</div><p className="text-sm text-muted mt-1">{t.description}</p><p className="text-xs text-faint mt-2">Version {t.version} · updated {formatDate(t.updatedAt)}{!t.active && ' · inactive'}</p></div>
                <ul className="text-sm grid sm:grid-cols-2 gap-x-6 gap-y-1">{t.items.map((it: any) => { const r = data.requirements.find((x: any) => x.id === it.requirementId); return <li key={it.requirementId} className="flex justify-between gap-3"><span className="truncate">{r?.name ?? 'Removed requirement'}</span><span className="text-faint shrink-0">{it.mandatory ? 'Mandatory' : 'Optional'}</span></li>; })}</ul>
                <div>{editable && <button className="btn-secondary btn-sm" onClick={() => setTpl(t)}>Edit</button>}</div>
              </li>
            ))}</ul>
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
  const { me } = useSession();
  const [f, setF] = useState<any>({
    name: '', description: '', category: 'Insurance', kind: 'document', jurisdiction: '', subTypes: [], defaultMandatory: true, documentType: me?.org?.settings.market === 'US' ? 'Certificate of insurance' : 'Insurance certificate',
    expiryRequired: true, renewal: 'on_expiry', renewalPeriodDays: '', reviewRequired: true, instructions: '', active: true, ...initial, criteria: (initial?.criteria ?? []).map((c: any) => ({ ...c, _k: newRowKey() })),
  });
  const [touched, setTouched] = useState(false);
  const { run, busy, error } = useMutation(isNew ? 'requirements.create' : 'requirements.update');
  const toast = useToast();
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const setCrit = (i: number, patch: any) => set('criteria', f.criteria.map((c: any, j: number) => (j === i ? { ...c, ...patch } : c)));
  useEffect(() => { if (f.kind !== 'document') set('expiryRequired', false); }, [f.kind]); // eslint-disable-line
  const currency = me?.org?.settings.currency ?? 'USD';
  return (
    <Drawer open onClose={onClose} title={isNew ? 'New requirement' : initial.name} width="max-w-2xl"
      description={!isNew ? `Saving creates version ${initial.version + 1}. Past readiness decisions keep the version they used, and approved documents are re-checked against any new checks.` : 'Define what a subcontractor must provide and how it is judged.'}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={async () => {
          setTouched(true);
          if (!f.name.trim()) return;
          const payload = { ...f, requirementId: initial.id, renewalPeriodDays: f.renewalPeriodDays === '' ? null : Number(f.renewalPeriodDays), criteria: f.criteria.map((c: any) => ({ ...withoutRowKey(c), value: c.type === 'min_amount' ? Number(c.value) : c.value })) };
          try { const r = await run(payload); toast(isNew ? 'Requirement created' : `Saved as version ${r.version}`); onClose(); } catch { /* shown */ }
        }}>{busy && <Spinner />}{isNew ? 'Create requirement' : 'Save new version'}</button>
      </>}>
      <div className="space-y-9">
        <fieldset className="space-y-5">
          <legend className="eyebrow mb-4">What it is</legend>
          <Field label="Name" required error={touched && !f.name.trim() ? 'Give the requirement a name' : undefined}><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Category"><input className="input" list="cats" value={f.category} onChange={(e) => set('category', e.target.value)} /><datalist id="cats">{['Insurance', 'Licensing', 'Registration', 'Health & safety', 'Tax', 'Contractual', 'Declarations'].map((c) => <option key={c} value={c} />)}</datalist></Field>
            <Field label="Jurisdiction" optional hint="For reference and reporting."><input className="input" value={f.jurisdiction ?? ''} onChange={(e) => set('jurisdiction', e.target.value)} placeholder="e.g. Texas, England and Wales" /></Field>
          </div>
          <Field label="Description" optional><textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        </fieldset>
        <fieldset className="space-y-5">
          <legend className="eyebrow mb-4">How it's satisfied</legend>
          <Segmented label="How it's satisfied" value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'document', label: 'Document' }, { value: 'declaration', label: 'Declaration' }, { value: 'manual_check', label: 'Manual check' }]} />
          <p className="text-sm text-muted">{f.kind === 'document' ? 'The subcontractor uploads a document and a reviewer approves it.' : f.kind === 'declaration' ? 'A periodic declaration recorded by your team — no upload needed.' : 'Your team checks something (for example a register) and records the result.'}</p>
          {f.kind === 'document' ? (
            <div className="grid sm:grid-cols-2 gap-5">
              <Field label="Document type"><select className="input" value={f.documentType ?? ''} onChange={(e) => set('documentType', e.target.value)}>{DOCUMENT_TYPES.map((d) => <option key={d}>{d}</option>)}</select></Field>
              <Field label="Renewal"><select className="input" value={f.renewal} onChange={(e) => set('renewal', e.target.value)}><option value="none">No renewal</option><option value="on_expiry">Renew when it expires</option><option value="annual">Renew annually</option></select></Field>
            </div>
          ) : <Field label="Renew every (days)" optional hint="Leave empty if a confirmation never lapses."><input className="input max-w-[10rem]" type="number" min={1} value={f.renewalPeriodDays ?? ''} onChange={(e) => set('renewalPeriodDays', e.target.value)} /></Field>}
          <div className="space-y-3">
            <Checkbox checked={f.defaultMandatory} onChange={(v) => set('defaultMandatory', v)} label="Mandatory by default" hint="Each project can still make it optional." />
            {f.kind === 'document' && <Checkbox checked={f.expiryRequired} onChange={(v) => set('expiryRequired', v)} label="Has an expiry date" hint="Reviewers must record the expiry to approve. Untick for documents that don't expire." />}
            {f.kind === 'document' && <Checkbox checked={f.reviewRequired} onChange={(v) => set('reviewRequired', v)} label="Needs reviewer approval" hint="If unticked, it's accepted once it passes security checks." />}
            {!isNew && <Checkbox checked={f.active} onChange={(v) => set('active', v)} label="Active" hint="Inactive requirements stop counting toward readiness." />}
          </div>
        </fieldset>
        {f.kind === 'document' && (
          <fieldset>
            <legend className="eyebrow mb-2">Checks</legend>
            <p className="text-sm text-muted mb-4">Values the reviewer confirms from the document, such as minimum limits. Approval is blocked if a confirmed value falls short.</p>
            <div className="space-y-3">{f.criteria.map((c: any, i: number) => (
              <div key={c._k} className="grid grid-cols-[1.3fr_0.9fr_0.9fr_auto] gap-2 items-center">
                <select className="input" value={c.key} onChange={(e) => { const vf = VALUE_FIELDS.find((x) => x.key === e.target.value)!; setCrit(i, { key: vf.key, label: vf.label, type: vf.type === 'amount' ? 'min_amount' : 'boolean' }); }} aria-label="Value checked">
                  {VALUE_FIELDS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                </select>
                <select className="input" value={c.type} onChange={(e) => setCrit(i, { type: e.target.value })} aria-label="Rule"><option value="min_amount">At least</option><option value="boolean">Must be shown</option></select>
                {c.type === 'min_amount' ? <input className="input" type="number" min={0} value={c.value ?? ''} onChange={(e) => setCrit(i, { value: e.target.value, currency })} aria-label={`Minimum (${currency})`} placeholder={currency} /> : <span className="text-sm text-muted px-1">On the document</span>}
                <button className="btn-ghost btn-sm" onClick={() => set('criteria', f.criteria.filter((_: any, j: number) => j !== i))} aria-label="Remove check">Remove</button>
              </div>
            ))}</div>
            <button className="btn-secondary btn-sm mt-4" onClick={() => set('criteria', [...f.criteria, { _k: newRowKey(), key: 'glEachOccurrence', label: VALUE_FIELDS[0].label, type: 'min_amount', value: 1000000, currency }])}>Add a check</button>
          </fieldset>
        )}
        <fieldset>
          <legend className="eyebrow mb-2">Applies to</legend>
          <p className="text-sm text-muted mb-4">Leave everything unticked to apply to every subcontractor. Anyone not matching is automatically not applicable, with this setting given as the reason.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2.5">{SUB_TYPES.map((t) => <Checkbox key={t} checked={f.subTypes.includes(t)} onChange={(v) => set('subTypes', v ? [...f.subTypes, t] : f.subTypes.filter((x: string) => x !== t))} label={<span className="text-sm">{humanize(t)}</span>} />)}</div>
        </fieldset>
        <Field label="Instructions for subcontractors" optional hint="Shown next to the upload button in the portal."><textarea className="input" rows={2} value={f.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} /></Field>
        <FormError error={error} />
      </div>
    </Drawer>
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
  const byCat = useMemo(() => { const m = new Map<string, any[]>(); for (const r of requirements.filter((x) => x.active)) m.set(r.category, [...(m.get(r.category) ?? []), r]); return [...m.entries()]; }, [requirements]);
  return (
    <Drawer open onClose={onClose} title={initial.id ? initial.name : 'New template'} width="max-w-2xl"
      description={initial.id ? `Saving creates version ${initial.version + 1}. Projects using an earlier version stay as they are until someone re-applies the template.` : 'A reusable set of requirements for a type of work.'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !name.trim()} onClick={async () => { try { await run({ templateId: initial.id, name, description, items, active }); toast('Template saved'); onClose(); } catch { /* shown */ } }}>{busy && <Spinner />}Save template</button></>}>
      <div className="space-y-6">
        <Field label="Name" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description" optional><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {initial.id && <Checkbox checked={active} onChange={setActive} label="Active" hint="Inactive templates can't be applied to new projects." />}
        <div>
          <div className="label">Requirements <span className="text-faint font-normal tnum">({items.length} selected)</span></div>
          {byCat.map(([cat, list]) => (
            <div key={cat} className="mt-4">
              <div className="eyebrow mb-1">{cat}</div>
              {list.map((r) => { const it = has(r.id); return (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-line">
                  <Checkbox checked={!!it} onChange={(v) => setItems(v ? [...items, { requirementId: r.id, mandatory: r.defaultMandatory }] : items.filter((x) => x.requirementId !== r.id))} label={r.name} />
                  {it && <Segmented size="sm" label={`${r.name} mandatory`} value={it.mandatory ? 'm' : 'o'} onChange={(v) => setItems(items.map((x) => (x.requirementId === r.id ? { ...x, mandatory: v === 'm' } : x)))} options={[{ value: 'm', label: 'Mandatory' }, { value: 'o', label: 'Optional' }]} />}
                </div>
              ); })}
            </div>
          ))}
        </div>
        <FormError error={error} />
      </div>
    </Drawer>
  );
}

function HistoryDialog({ req, onClose }: { req: any; onClose: () => void }) {
  const { data } = useApi<any>('requirements.history', { requirementId: req.id });
  return (
    <Dialog open onClose={onClose} title={`${req.name}: version history`} width="max-w-2xl">
      {!data ? <Skeleton rows={3} /> : <ol className="border-t border-line">{data.versions.map((v: any) => (
        <li key={v.version} className="py-4 border-b border-line">
          <div className="flex justify-between gap-3"><span className="font-medium">Version {v.version}</span><span className="text-xs text-faint">{formatDateTime(v.updatedAt)}{v.changedBy ? ` · ${v.changedBy}` : ''}</span></div>
          <div className="text-sm text-muted mt-1">{v.defaultMandatory ? 'Mandatory' : 'Optional'} · {v.expiryRequired ? 'expiry required' : 'no expiry'} · {v.reviewRequired ? 'review required' : 'accepted automatically'}{v.active ? '' : ' · inactive'}</div>
          {v.criteria?.length > 0 && <div className="text-sm text-muted mt-1">Checks: {v.criteria.map(describeCriterion).join('; ')}</div>}
        </li>
      ))}</ol>}
    </Dialog>
  );
}
