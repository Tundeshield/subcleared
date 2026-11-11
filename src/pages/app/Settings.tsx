import { useEffect, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { formatDateTime } from '../../domain/dates';
import { COUNTRIES, CURRENCIES, LOCALES, MARKETS, setFormatting } from '../../domain/locale';
import { api, useApi, useMutation } from '../../lib/api';
import { exportCsv } from '../../lib/export';
import { useSession } from '../../lib/session';
import { Callout, Checkbox, Confirm, cx, Empty, ErrorState, Field, FilterSelect, FormError, humanize, PageHeader, Pagination, Skeleton, Spinner, Toolbar, usePaged, useToast } from '../../ui';

const SECTIONS = [['organisation', 'Organisation'], ['profile', 'Profile and notifications'], ['delivery', 'Email delivery'], ['audit', 'Audit log'], ['data', 'Sample data']] as const;

export default function Settings() {
  const { section = 'organisation' } = useParams();
  const { can } = useSession();
  const visible = SECTIONS.filter(([k]) => (k === 'audit' ? can('audit.view') : ['delivery', 'data'].includes(k) ? can('settings.manage') : true));
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid lg:grid-cols-[14rem_1fr] gap-x-12 gap-y-6 items-start">
        <nav aria-label="Settings sections" className="flex lg:flex-col gap-1 overflow-x-auto">
          {visible.map(([k, l]) => <NavLink key={k} to={`/app/settings/${k}`} className={({ isActive }) => cx('relative rounded px-3 py-2 text-[0.9375rem] whitespace-nowrap', isActive ? 'bg-ink/[0.05] font-medium lg:before:absolute lg:before:left-0 lg:before:top-2 lg:before:bottom-2 lg:before:w-[2px] lg:before:bg-accent' : 'text-muted hover:text-ink')}>{l}</NavLink>)}
        </nav>
        <div className="min-w-0 max-w-4xl">
          {section === 'organisation' && <OrgSettings />}
          {section === 'profile' && <Profile />}
          {section === 'delivery' && <Delivery />}
          {section === 'audit' && <Audit />}
          {section === 'data' && <SampleData />}
        </div>
      </div>
    </div>
  );
}

function OrgSettings() {
  const { me, can, refresh } = useSession();
  const org = me!.org!;
  const [f, setF] = useState<any>({ name: org.name, country: org.country, ...org.settings, market: org.settings.market ?? 'OTHER', locale: org.settings.locale ?? 'en-GB', currency: org.settings.currency ?? 'USD', reminderText: org.settings.reminderSchedule.join(', ') });
  const { run, busy, error } = useMutation('org.updateSettings');
  const toast = useToast();
  const editable = can('settings.manage');
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const zones: string[] = (Intl as any).supportedValuesOf ? (Intl as any).supportedValuesOf('timeZone') : [f.timezone];
  return (
    <div className="space-y-12">
      {!editable && <Callout>Only owners and administrators can change these settings.</Callout>}
      <section>
        <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Organisation</h2>
        <div className="grid sm:grid-cols-2 gap-5 pt-5">
          <Field label="Name"><input className="input" value={f.name} disabled={!editable} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Country"><select className="input" value={COUNTRIES.some((c) => c.name === f.country) ? f.country : 'Other'} disabled={!editable} onChange={(e) => set('country', e.target.value)}>{COUNTRIES.map((c) => <option key={c.name}>{c.name}</option>)}</select></Field>
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Region and formats</h2>
        <div className="grid sm:grid-cols-2 gap-5 pt-5">
          <Field label="Terminology" hint="How the product words things — for example “general contractor” and “certificate of insurance”, or “principal contractor” and “insurance certificate”. Neutral wording suits most countries."><select className="input" value={f.market} disabled={!editable} onChange={(e) => set('market', e.target.value)}>{MARKETS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
          <Field label="Timezone" hint="Defines “today” for expiry checks and when reminders go out."><select className="input" value={f.timezone} disabled={!editable} onChange={(e) => set('timezone', e.target.value)}>{zones.map((z) => <option key={z}>{z}</option>)}</select></Field>
          <Field label="Date format and spelling"><select className="input" value={f.locale} disabled={!editable} onChange={(e) => set('locale', e.target.value)}>{LOCALES.map((l) => <option key={l} value={l}>{l} — {new Date(Date.UTC(2026, 10, 11)).toLocaleDateString(l, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })} · {new Date(Date.UTC(2026, 10, 11)).toLocaleDateString(l, { timeZone: 'UTC' })}</option>)}</select></Field>
          <Field label="Currency" hint="Used for coverage limits. Subscriptions are billed in pounds sterling for GBP organisations and US dollars otherwise."><select className="input" value={f.currency} disabled={!editable} onChange={(e) => set('currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c} value={c}>{c} — {new Intl.DisplayNames(['en'], { type: 'currency' }).of(c)}</option>)}</select></Field>
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Compliance rules</h2>
        <div className="grid sm:grid-cols-2 gap-5 pt-5">
          <Field label="Expiring-soon window (days)" hint="Approved documents expiring within this many days mark a subcontractor as needing attention."><input className="input" type="number" min={0} max={180} value={f.expiringSoonDays} disabled={!editable} onChange={(e) => set('expiringSoonDays', e.target.value)} /></Field>
          <Field label="Escalate after (days)" hint="Tell the project manager when a mandatory item is still missing this long after assignment."><input className="input" type="number" min={1} max={120} value={f.escalationDays} disabled={!editable} onChange={(e) => set('escalationDays', e.target.value)} /></Field>
          <Field label="Reminder schedule" hint="Days before expiry, separated by commas. 0 means on the expiry date; negative numbers are days after. Each reminder is sent once." className="sm:col-span-2"><input className="input font-mono" value={f.reminderText} disabled={!editable} onChange={(e) => set('reminderText', e.target.value)} /></Field>
          <Field label="Upload links expire after (days)"><input className="input" type="number" min={1} max={30} value={f.defaultLinkExpiryDays} disabled={!editable} onChange={(e) => set('defaultLinkExpiryDays', e.target.value)} /></Field>
          <Field label="Keep superseded evidence for (years)"><input className="input" type="number" min={1} max={30} value={f.retentionYears} disabled={!editable} onChange={(e) => set('retentionYears', e.target.value)} /></Field>
          <div className="sm:col-span-2"><Checkbox checked={f.remindArchived} disabled={!editable} onChange={(v) => set('remindArchived', v)} label="Remind archived and inactive subcontractors too" hint="Off by default — no reminders for archived subcontractors, or for documents only needed on finished projects." /></div>
        </div>
      </section>
      {editable && <div className="flex justify-end items-center gap-4 border-t border-line pt-6"><FormError error={error} /><button className="btn-primary" disabled={busy} onClick={async () => {
        try {
          await run({ name: f.name, country: f.country, timezone: f.timezone, market: f.market, locale: f.locale, currency: f.currency, expiringSoonDays: Number(f.expiringSoonDays), escalationDays: Number(f.escalationDays), defaultLinkExpiryDays: Number(f.defaultLinkExpiryDays), retentionYears: Number(f.retentionYears), remindArchived: f.remindArchived, reminderSchedule: f.reminderText.split(',').map((x: string) => Number(x.trim())).filter((x: number) => !isNaN(x)) });
          setFormatting({ locale: f.locale, currency: f.currency });
          await refresh(); toast('Settings saved');
        } catch { /* shown */ }
      }}>{busy && <Spinner />}Save settings</button></div>}
    </div>
  );
}

const NOTIFS: [string, string][] = [
  ['awaiting_review', 'A document is submitted for review'], ['document_approved', 'A document is approved'], ['document_rejected', 'A document is rejected'], ['info_requested', 'More information is requested'],
  ['expiring', 'A document is approaching expiry'], ['expired', 'A document has expired'], ['became_non_compliant', 'A subcontractor stops being ready'], ['escalation', 'A mandatory item stays missing too long'], ['project_threshold', 'A project falls below 80% ready'],
];

function Profile() {
  const { me, refresh } = useSession();
  const [name, setName] = useState(me!.user.name);
  const [prefs, setPrefs] = useState<Record<string, { inApp: boolean; email: boolean }>>({});
  const save = useMutation('notifications.prefs');
  const profile = useMutation('me.update');
  const toast = useToast();
  useEffect(() => { const p: any = {}; const np: any = me!.member!.notificationPrefs ?? {}; for (const [k] of NOTIFS) p[k] = { inApp: np[k]?.inApp ?? true, email: np[k]?.email ?? false }; setPrefs(p); }, [me]);
  return (
    <div className="space-y-12">
      <section>
        <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Profile</h2>
        <div className="pt-5 flex flex-wrap gap-4 items-end">
          <Field label="Name" className="flex-1 min-w-[16rem]"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <button className="btn-secondary" disabled={profile.busy || !name.trim()} onClick={async () => { await profile.run({ name }); await refresh(); toast('Profile saved'); }}>Save name</button>
        </div>
        <p className="text-sm text-muted mt-3">Signed in as {me!.user.email}. Text size can be changed from the account menu at the top right.</p>
      </section>
      <section>
        <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Notifications</h2>
        <p className="text-sm text-muted mt-3">Choose how you hear about each event. In-app notifications appear under the bell.</p>
        <table className="table mt-4"><thead><tr><th className="th">When</th><th className="th w-24">In app</th><th className="th w-24">Email</th></tr></thead>
          <tbody>{NOTIFS.map(([k, l]) => (
            <tr key={k}><td className="td py-3">{l}</td>
              <td className="td py-3"><Checkbox checked={prefs[k]?.inApp ?? true} onChange={(v) => setPrefs({ ...prefs, [k]: { ...prefs[k], inApp: v } })} label={<span className="sr-only">In app: {l}</span>} /></td>
              <td className="td py-3"><Checkbox checked={prefs[k]?.email ?? false} onChange={(v) => setPrefs({ ...prefs, [k]: { ...prefs[k], email: v } })} label={<span className="sr-only">Email: {l}</span>} /></td></tr>
          ))}</tbody></table>
        <div className="pt-5 flex justify-end"><button className="btn-primary" disabled={save.busy} onClick={async () => { await save.run({ prefs }); await refresh(); toast('Preferences saved'); }}>{save.busy && <Spinner />}Save preferences</button></div>
      </section>
    </div>
  );
}

function Delivery() {
  const { data, error, loading, reload } = useApi<any>('deliveryLogs.list');
  const paged = usePaged(data?.items ?? [], 30);
  if (loading && !data) return <Skeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-line-strong"><div><h2 className="text-lg font-semibold">Email delivery</h2><p className="text-sm text-muted mt-0.5">Every email SubCleared tried to send. Failed reminders are retried automatically, up to three times.</p></div>
        <button className="btn-secondary btn-sm" onClick={() => exportCsv('Email delivery log', [{ key: 'updatedAt', label: 'Time' }, { key: 'to', label: 'To' }, { key: 'subject', label: 'Subject' }, { key: 'status', label: 'Status' }, { key: 'attempts', label: 'Attempts' }, { key: 'error', label: 'Error' }], data.items)}>Export CSV</button></div>
      {data.items.length === 0 ? <Empty title="No emails sent yet" /> : (
        <><div className="overflow-x-auto"><table className="table min-w-[720px]"><thead><tr><th className="th">Time</th><th className="th">To</th><th className="th">Subject</th><th className="th">Result</th><th className="th text-right">Attempts</th></tr></thead>
          <tbody>{paged.slice.map((l: any) => <tr key={l.id}><td className="td text-muted whitespace-nowrap text-sm">{formatDateTime(l.updatedAt)}</td><td className="td text-sm break-all">{l.to}</td><td className="td text-sm">{l.subject}</td><td className={cx('td text-sm', l.status === 'failed' && 'font-medium')}>{l.status === 'dev_logged' ? 'Captured (development)' : humanize(l.status)}{l.error && <div className="text-xs text-muted font-normal">{l.error}</div>}</td><td className="td text-right tnum">{l.attempts}</td></tr>)}</tbody></table></div>
          <Pagination {...paged} /></>
      )}
    </section>
  );
}

function Audit() {
  const [f, setF] = useState<any>({});
  const { data, error, loading, reload } = useApi<any>('audit.list', { ...f, limit: 2000 });
  const [open, setOpen] = useState<string | null>(null);
  const paged = usePaged(data?.items ?? [], 40);
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-line-strong"><div><h2 className="text-lg font-semibold">Audit log</h2><p className="text-sm text-muted mt-0.5">Append-only: no one, including owners, can edit or delete entries.</p></div>
        {data && <button className="btn-secondary btn-sm" onClick={() => exportCsv('Audit log', [{ key: 'at', label: 'Time (UTC)' }, { key: 'actorName', label: 'Who' }, { key: 'action', label: 'Action' }, { key: 'label', label: 'Record' }, { key: 'source', label: 'Source' }, { key: 'change', label: 'Change' }], data.items.map((e: any) => ({ ...e, actorName: e.actor.name, label: e.entity.label, change: JSON.stringify(e.after ?? '') })))}>Export CSV</button>}</div>
      <Toolbar>
        <input className="input w-full sm:w-64" placeholder="Search" value={f.q ?? ''} onChange={(e) => setF({ ...f, q: e.target.value || undefined })} aria-label="Search audit log" />
        <FilterSelect label="Area" value={f.action ?? ''} onChange={(v) => setF({ ...f, action: v || undefined })} options={['document', 'compliance', 'subcontractor', 'project', 'requirement', 'template', 'request', 'member', 'portal', 'notification', 'billing', 'organisation'].map((a) => ({ value: a, label: humanize(a) }))} />
        <input className="input w-auto" type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value || undefined })} aria-label="From date" />
        <input className="input w-auto" type="date" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value || undefined })} aria-label="To date" />
      </Toolbar>
      {loading && !data ? <Skeleton /> : error ? <ErrorState error={error} onRetry={reload} /> : data.items.length === 0 ? <Empty title="No entries match" /> : (
        <><ol className="border-t border-line">{paged.slice.map((e: any) => (
          <li key={e.id} className="border-b border-line">
            <button className="w-full text-left py-3 grid sm:grid-cols-[11rem_14rem_1fr] gap-x-4 gap-y-0.5 text-sm" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
              <span className="text-faint tnum">{formatDateTime(e.at)}</span><span className="font-mono text-xs text-accent pt-0.5">{e.action}</span><span>{e.entity.label} <span className="text-muted">· {e.actor.name} ({e.source})</span></span>
            </button>
            {open === e.id && <pre className="mb-3 text-xs bg-paper border border-line rounded p-3 overflow-x-auto">{JSON.stringify({ before: e.before, after: e.after, entity: e.entity, ip: e.ip }, null, 2)}</pre>}
          </li>
        ))}</ol><Pagination {...paged} /></>
      )}
    </section>
  );
}

function SampleData() {
  const { me, refresh } = useSession();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const has = !!me?.org?.hasSample;
  const market = me?.org?.settings.market;
  const act = async (action: string) => { setBusy(true); setErr(null); try { await api(action, {}); await refresh(); toast(action === 'org.loadSample' ? 'Sample data added' : 'Sample data removed'); setConfirm(false); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <section>
      <h2 className="text-lg font-semibold pb-3 border-b border-line-strong">Sample data</h2>
      <p className="text-muted mt-4 max-w-2xl leading-relaxed">Sample data adds three {market === 'US' ? 'projects in Austin, Dallas and Chicago' : 'projects in London, Manchester and Birmingham'} with five subcontractors in different states of readiness, sample documents and real review decisions. Every sample record is labelled “Sample”, sample contacts are never emailed, and everything can be removed in one step.</p>
      <div className="mt-6">{has
        ? <button className="btn-danger" onClick={() => setConfirm(true)}>Remove sample data</button>
        : <button className="btn-secondary" disabled={busy} onClick={() => act('org.loadSample')}>{busy && <Spinner />}Load sample data</button>}</div>
      <div className="mt-4"><FormError error={err} /></div>
      <Confirm open={confirm} onClose={() => setConfirm(false)} danger title="Remove all sample data?" confirmLabel="Remove" busy={busy} onConfirm={() => act('org.clearSample')}>
        Sample projects, subcontractors, documents and their readiness history are deleted. Your own records aren't touched. The audit log keeps a note that sample data existed.
      </Confirm>
    </section>
  );
}
